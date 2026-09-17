import { useCallback, useEffect, useRef, useState } from "react";
import { CastScreen, type CastResult } from "@/features/faces/CastScreen";
import { NoFacesScreen } from "@/features/faces/NoFacesScreen";
import { PublishScreen } from "@/features/publish/PublishScreen";
import { SetupGate } from "@/features/setup/SetupGate";
import { EditorView } from "@/features/timeline/EditorView";
import { suggestRegions } from "@/features/timeline/regions";
import type { FramingRegion } from "@/features/timeline/types";
import { ProcessingFailed } from "@/features/upload/ProcessingFailed";
import { ProcessingScreen } from "@/features/upload/ProcessingScreen";
import { UploadScreen } from "@/features/upload/UploadScreen";
import { getLocalPath } from "@/lib/electron";
import { fixtureCast, fixtureData, FIXTURE_FILE_NAME, FIXTURE_JOB_ID, isFixtureMode } from "@/lib/fixture";
import { useThemeMode } from "@/lib/theme";
import {
	deleteJob,
	getJob,
	getProgress,
	jobMediaUrl,
	listJobs,
	processVideo,
	processVideoAtPath,
	type DetectFacesResponse,
	type Health,
	type JobProgress,
	type MatchResult,
	type OverlapWindow,
	type SavedEpisode,
	type Turn,
	type Word,
} from "@/lib/api";

// Enough to reconnect a job in progress, or to know there's a finished one
// worth fetching, after a reload -- not a full "what screen were you on"
// record. A resumed job always lands back on Cast: cheap to redo, and one
// path serves both "you refreshed the tab" and "you reopened a saved
// episode from last week" instead of two.
const ACTIVE_JOB_KEY = "cutroom.activeJob";

interface ActiveJob {
	jobId: string;
	fileName: string;
	fileSizeBytes: number;
	startedAt: number;
}

/** Only asks once -- a browser remembers a permission decision permanently,
 * so calling this again after "denied" would be a silent no-op anyway; it's
 * a courtesy so a fresh install doesn't get the OS prompt before anyone has
 * chosen to start a job. */
function requestNotificationPermission() {
	if (typeof Notification === "undefined" || Notification.permission !== "default") return;
	void Notification.requestPermission();
}

/** Only worth interrupting someone for if they're not already looking at
 * it -- the tab itself already shows this the moment it's true. */
function notifyIfHidden(title: string, body: string) {
	if (typeof Notification === "undefined" || Notification.permission !== "granted" || !document.hidden) return;
	new Notification(title, { body });
}

function rememberActiveJob(job: ActiveJob | null) {
	if (job) localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
	else localStorage.removeItem(ACTIVE_JOB_KEY);
}

function readActiveJob(): ActiveJob | null {
	try {
		const raw = localStorage.getItem(ACTIVE_JOB_KEY);
		return raw ? (JSON.parse(raw) as ActiveJob) : null;
	} catch {
		return null;
	}
}

type Status =
	| { state: "checking" }
	| { state: "idle" }
	| { state: "processing"; jobId: string; fileName: string; fileSizeBytes: number; startedAt: number }
	// `file` is only here for "Try again" -- a resumed job that turns out to
	// have failed has no browser-held upload left to retry with, only to
	// discard.
	| { state: "failed"; file: File | null; fileName: string; message: string; reached: number }
	| {
			state: "noFaces";
			videoUrl: string;
			fileName: string;
			sessionId: string;
			turns: Turn[];
			overlapWindows: OverlapWindow[];
			words: Word[];
			faces: DetectFacesResponse;
	  }
	| {
			state: "cast";
			videoUrl: string;
			fileName: string;
			sessionId: string;
			turns: Turn[];
			overlapWindows: OverlapWindow[];
			words: Word[];
			faces: DetectFacesResponse;
			match: MatchResult;
	  }
	| {
			state: "editing";
			videoUrl: string;
			fileName: string;
			sessionId: string;
			turns: Turn[];
			overlapWindows: OverlapWindow[];
			words: Word[];
			faces: DetectFacesResponse;
			cast: CastResult;
	  }
	| {
			state: "publishing";
			// Carries everything "editing" needs too (not just what
			// PublishScreen itself reads) so "onBack" can spread straight back
			// into a valid editing state.
			videoUrl: string;
			fileName: string;
			sessionId: string;
			turns: Turn[];
			overlapWindows: OverlapWindow[];
			words: Word[];
			faces: DetectFacesResponse;
			cast: CastResult;
			/** Measured by the editor's video element: the recording's real length. */
			duration: number;
	  };

/** `?fixture` in the dev server's URL skips straight to this instead of
 * `checking` -- see src/lib/fixture.ts. */
function fixtureStatus(): Status {
	return {
		state: "editing",
		videoUrl: "",
		fileName: FIXTURE_FILE_NAME,
		sessionId: FIXTURE_JOB_ID,
		turns: fixtureData.turns,
		overlapWindows: fixtureData.overlapWindows,
		words: fixtureData.words,
		faces: fixtureData.faces,
		cast: fixtureCast,
	};
}

function App() {
	const [themeMode, setThemeMode] = useThemeMode();
	const [status, setStatus] = useState<Status>(() => (isFixtureMode() ? fixtureStatus() : { state: "checking" }));
	// What the local install can actually do, learned at the setup gate and
	// carried forward so later screens can say so before a render, not after.
	const [health, setHealth] = useState<Health | null>(null);
	// Edit decisions live here rather than in the editor, so going to the
	// publish screen and back doesn't throw them away.
	const [regions, setRegions] = useState<FramingRegion[]>(() =>
		isFixtureMode() ? suggestRegions(fixtureData.turns, fixtureData.overlapWindows, fixtureCast.speakerToPerson) : [],
	);
	const [captions, setCaptions] = useState(false);
	const [trimDeadAir, setTrimDeadAir] = useState(false);
	const [uploadFraction, setUploadFraction] = useState(0);
	const [progress, setProgress] = useState<JobProgress | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [savedEpisodes, setSavedEpisodes] = useState<SavedEpisode[] | undefined>(undefined);
	// Read from inside handleFile's catch, where the progress state would be
	// the stale value captured when the upload began.
	const lastPosition = useRef(0);

	const processingJobId = status.state === "processing" ? status.jobId : null;
	const processingStartedAt = status.state === "processing" ? status.startedAt : null;
	const processingFileName = status.state === "processing" ? status.fileName : null;

	function refreshSavedEpisodes() {
		listJobs()
			.then(setSavedEpisodes)
			.catch(() => setSavedEpisodes([]));
	}

	/** Everything that follows a finished job's result, whether it just
	 * finished, survived a reload, or is a saved episode from last week --
	 * one path for all three, since none of them keep the editor's edits. */
	function enterCast(jobId: string, fileName: string, result: {
		turns: Turn[];
		overlapWindows: OverlapWindow[];
		words: Word[];
		faces: DetectFacesResponse;
		match: MatchResult;
	}) {
		const videoUrl = jobMediaUrl(jobId);
		if (result.faces.people.length === 0) {
			setStatus({
				state: "noFaces",
				videoUrl,
				fileName,
				sessionId: jobId,
				turns: result.turns,
				overlapWindows: result.overlapWindows,
				words: result.words,
				faces: result.faces,
			});
			return;
		}
		setStatus({
			state: "cast",
			videoUrl,
			fileName,
			sessionId: jobId,
			turns: result.turns,
			overlapWindows: result.overlapWindows,
			words: result.words,
			faces: result.faces,
			match: result.match,
		});
	}

	// Poll the server for which stage it's on. Both requests run in parallel
	// and report under the same job id, so one poll covers both.
	useEffect(() => {
		if (!processingJobId) return;
		let cancelled = false;
		const tick = async () => {
			try {
				const p = await getProgress(processingJobId);
				if (cancelled) return;
				setProgress(p);
				lastPosition.current = p.position;
				if (p.error) {
					const fileName = processingFileName ?? "the recording";
					rememberActiveJob(null);
					notifyIfHidden("Cutroom hit a problem", `${fileName}: ${p.error}`);
					setStatus({ state: "failed", file: null, fileName, message: p.error, reached: p.position });
				} else if (p.match.done) {
					const fileName = processingFileName ?? "the recording";
					notifyIfHidden("Cutroom is ready", `${fileName} finished processing.`);
					const result = await getJob(processingJobId);
					enterCast(processingJobId, fileName, result);
				}
			} catch {
				// Transient -- the next poll will pick it up.
			}
		};
		void tick();
		const id = setInterval(tick, 700);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [processingJobId, processingFileName]);

	useEffect(() => {
		if (processingStartedAt === null) return;
		const id = setInterval(() => setElapsed((Date.now() - processingStartedAt) / 1000), 500);
		return () => clearInterval(id);
	}, [processingStartedAt]);

	// Identity-stable: SetupGate schedules its own advance off this prop, so a
	// new function every render would restart that timer on every poll.
	const handleReady = useCallback((result: Health) => {
		setHealth(result);
		refreshSavedEpisodes();

		// A job from before the tab closed or refreshed -- reconnect instead
		// of dropping back to the upload screen and losing track of it.
		const active = readActiveJob();
		if (!active) {
			setStatus({ state: "idle" });
			return;
		}
		getProgress(active.jobId)
			.then(async (p) => {
				if (p.error) {
					rememberActiveJob(null);
					setStatus({ state: "failed", file: null, fileName: active.fileName, message: p.error, reached: p.position });
				} else if (p.match.done) {
					const result = await getJob(active.jobId);
					enterCast(active.jobId, active.fileName, result);
				} else {
					setStatus({ state: "processing", ...active });
				}
			})
			.catch(() => {
				// The server has no memory of this job at all (a restart, or it
				// never really started) -- nothing to reconnect to.
				rememberActiveJob(null);
				setStatus({ state: "idle" });
			});
	}, []);

	async function handleFile(file: File) {
		const jobId = crypto.randomUUID();
		const active: ActiveJob = { jobId, fileName: file.name, fileSizeBytes: file.size, startedAt: Date.now() };
		requestNotificationPermission();
		setUploadFraction(0);
		setProgress(null);
		setElapsed(0);
		lastPosition.current = 0;
		rememberActiveJob(active);
		setStatus({ state: "processing", ...active });
		try {
			// The desktop app can read the recording where it already is; a
			// plain browser has no filesystem access and has to upload it.
			const localPath = getLocalPath(file);
			if (localPath) {
				setUploadFraction(1);
				await processVideoAtPath(localPath, jobId);
			} else {
				await processVideo(file, jobId, setUploadFraction);
			}
			// The rest happens in the poll above once the background job
			// reports done -- /process itself only confirms the upload landed.
		} catch (err) {
			rememberActiveJob(null);
			setStatus({
				state: "failed",
				file,
				fileName: file.name,
				message: err instanceof Error ? err.message : "Something went wrong.",
				reached: lastPosition.current,
			});
		}
	}

	function handleReopen(jobId: string) {
		const episode = savedEpisodes?.find((e) => e.jobId === jobId);
		getJob(jobId)
			.then((result) => {
				const fileName = result.filename ?? episode?.filename ?? "the recording";
				// Now the active job, the same as a fresh upload -- so a reload
				// while working on a reopened episode resumes it too, instead of
				// only a just-uploaded one.
				rememberActiveJob({ jobId, fileName, fileSizeBytes: 0, startedAt: Date.now() });
				enterCast(jobId, fileName, result);
			})
			.catch((err) => {
				setStatus({
					state: "failed",
					file: null,
					fileName: episode?.filename ?? "that episode",
					message: err instanceof Error ? err.message : "Could not reopen that episode.",
					reached: 0,
				});
			});
	}

	function handleDelete(jobId: string) {
		setSavedEpisodes((eps) => eps?.filter((e) => e.jobId !== jobId));
		void deleteJob(jobId).catch(() => refreshSavedEpisodes());
	}

	function startOver() {
		rememberActiveJob(null);
		refreshSavedEpisodes();
		setStatus({ state: "idle" });
	}

	if (status.state === "checking") {
		return <SetupGate onReady={handleReady} />;
	}

	if (status.state === "failed") {
		return (
			<ProcessingFailed
				fileName={status.fileName}
				message={status.message}
				reached={status.reached}
				onRetry={status.file ? () => void handleFile(status.file!) : startOver}
				onPickAnother={startOver}
			/>
		);
	}

	if (status.state === "noFaces") {
		return (
			<NoFacesScreen
				onKeepGoing={() => {
					// Nobody to frame, so no regions: the whole episode stays wide.
					setRegions([]);
					setCaptions(health?.captions ?? false);
					setTrimDeadAir(false);
					setStatus({
						state: "editing",
						videoUrl: status.videoUrl,
						fileName: status.fileName,
						sessionId: status.sessionId,
						turns: status.turns,
						overlapWindows: status.overlapWindows,
						words: status.words,
						faces: status.faces,
						cast: { names: {}, speakerToPerson: {}, voiceNames: {} },
					});
				}}
				onPickAnother={startOver}
			/>
		);
	}

	if (status.state === "processing") {
		return (
			<ProcessingScreen
				jobId={status.jobId}
				uploadFraction={uploadFraction}
				progress={progress}
				elapsedSeconds={elapsed}
				fileName={status.fileName}
				fileSizeBytes={status.fileSizeBytes}
			/>
		);
	}

	if (status.state === "cast") {
		return (
			<CastScreen
				videoUrl={status.videoUrl}
				people={status.faces.people}
				turns={status.turns}
				words={status.words}
				match={status.match}
				onComplete={(cast) => {
					setRegions(suggestRegions(status.turns, status.overlapWindows, cast.speakerToPerson));
					// On when this install can burn captions in; never requested when it
					// can't, since /export would refuse the whole job.
					setCaptions(health?.captions ?? false);
					// Off by default: it removes content rather than adding to it.
					setTrimDeadAir(false);
					setStatus({
						state: "editing",
						videoUrl: status.videoUrl,
						fileName: status.fileName,
						sessionId: status.sessionId,
						turns: status.turns,
						overlapWindows: status.overlapWindows,
						words: status.words,
						faces: status.faces,
						cast,
					});
				}}
			/>
		);
	}

	if (status.state === "editing") {
		return (
			<EditorView
				videoUrl={status.videoUrl}
				fileName={status.fileName}
				jobId={status.sessionId}
				turns={status.turns}
				words={status.words}
				overlapWindows={status.overlapWindows}
				faces={status.faces}
				cast={status.cast}
				health={health}
				regions={regions}
				onRegionsChange={setRegions}
				captionsEnabled={captions}
				trimDeadAirEnabled={trimDeadAir}
				onTrimDeadAirChange={setTrimDeadAir}
				onPublish={(duration) => setStatus({ ...status, state: "publishing", duration })}
				themeMode={themeMode}
				onThemeModeChange={setThemeMode}
			/>
		);
	}

	if (status.state === "publishing") {
		return (
			<PublishScreen
				fileName={status.fileName}
				sessionId={status.sessionId}
				turns={status.turns}
				words={status.words}
				faces={status.faces}
				regions={regions}
				duration={status.duration}
				health={health}
				captions={captions}
				onCaptionsChange={setCaptions}
				trimDeadAir={trimDeadAir}
				onBack={() => setStatus({ ...status, state: "editing" })}
				onNew={startOver}
			/>
		);
	}

	return (
		<UploadScreen
			onFileSelected={handleFile}
			savedEpisodes={savedEpisodes}
			onReopen={handleReopen}
			onDelete={handleDelete}
		/>
	);
}

export default App;

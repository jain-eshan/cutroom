import { useCallback, useEffect, useState } from "react";
import { CastScreen, type CastResult } from "@/features/faces/CastScreen";
import { PublishScreen } from "@/features/publish/PublishScreen";
import { SetupGate } from "@/features/setup/SetupGate";
import { EditorView } from "@/features/timeline/EditorView";
import { suggestRegions } from "@/features/timeline/regions";
import type { FramingRegion } from "@/features/timeline/types";
import { ProcessingScreen } from "@/features/upload/ProcessingScreen";
import { UploadScreen } from "@/features/upload/UploadScreen";
import { useThemeMode } from "@/lib/theme";
import {
	getProgress,
	processVideo,
	type DetectFacesResponse,
	type Health,
	type JobProgress,
	type MatchResult,
	type OverlapWindow,
	type Turn,
	type Word,
} from "@/lib/api";

type Status =
	| { state: "checking" }
	| { state: "idle" }
	| { state: "processing"; file: File; jobId: string; startedAt: number }
	| { state: "error"; message: string }
	| {
			state: "cast";
			file: File;
			sessionId: string;
			turns: Turn[];
			overlapWindows: OverlapWindow[];
			words: Word[];
			faces: DetectFacesResponse;
			match: MatchResult;
	  }
	| {
			state: "editing";
			file: File;
			sessionId: string;
			turns: Turn[];
			overlapWindows: OverlapWindow[];
			words: Word[];
			faces: DetectFacesResponse;
			cast: CastResult;
	  }
	| {
			state: "publishing";
			file: File;
			sessionId: string;
			turns: Turn[];
			overlapWindows: OverlapWindow[];
			words: Word[];
			faces: DetectFacesResponse;
			cast: CastResult;
			/** Measured by the editor's video element: the recording's real length. */
			duration: number;
	  };

function App() {
	const [themeMode, setThemeMode] = useThemeMode();
	const [status, setStatus] = useState<Status>({ state: "checking" });
	// What the local install can actually do, learned at the setup gate and
	// carried forward so later screens can say so before a render, not after.
	const [health, setHealth] = useState<Health | null>(null);
	// Edit decisions live here rather than in the editor, so going to the
	// publish screen and back doesn't throw them away.
	const [regions, setRegions] = useState<FramingRegion[]>([]);
	const [captions, setCaptions] = useState(false);
	const [trimDeadAir, setTrimDeadAir] = useState(false);
	const [uploadFraction, setUploadFraction] = useState(0);
	const [progress, setProgress] = useState<JobProgress | null>(null);
	const [elapsed, setElapsed] = useState(0);

	const processingJobId = status.state === "processing" ? status.jobId : null;
	const processingStartedAt = status.state === "processing" ? status.startedAt : null;

	// Poll the server for which stage it's on. Both requests run in parallel
	// and report under the same job id, so one poll covers both.
	useEffect(() => {
		if (!processingJobId) return;
		let cancelled = false;
		const tick = async () => {
			try {
				const p = await getProgress(processingJobId);
				if (!cancelled) setProgress(p);
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
	}, [processingJobId]);

	useEffect(() => {
		if (processingStartedAt === null) return;
		const id = setInterval(() => setElapsed((Date.now() - processingStartedAt) / 1000), 500);
		return () => clearInterval(id);
	}, [processingStartedAt]);

	// Identity-stable: SetupGate schedules its own advance off this prop, so a
	// new function every render would restart that timer on every poll.
	const handleReady = useCallback((result: Health) => {
		setHealth(result);
		setStatus({ state: "idle" });
	}, []);

	async function handleFile(file: File) {
		const jobId = crypto.randomUUID();
		setUploadFraction(0);
		setProgress(null);
		setElapsed(0);
		setStatus({ state: "processing", file, jobId, startedAt: Date.now() });
		try {
			const { turns, overlapWindows, words, faces, match } = await processVideo(
				file,
				jobId,
				setUploadFraction,
			);
			setStatus({
				state: "cast",
				file,
				sessionId: jobId,
				turns,
				overlapWindows,
				words,
				faces,
				match,
			});
		} catch (err) {
			setStatus({
				state: "error",
				message: err instanceof Error ? err.message : "Something went wrong.",
			});
		}
	}

	if (status.state === "checking") {
		return <SetupGate onReady={handleReady} />;
	}

	if (status.state === "processing") {
		return (
			<ProcessingScreen
				jobId={status.jobId}
				uploadFraction={uploadFraction}
				progress={progress}
				elapsedSeconds={elapsed}
				fileName={status.file.name}
				fileSizeBytes={status.file.size}
			/>
		);
	}

	if (status.state === "cast") {
		return (
			<CastScreen
				file={status.file}
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
						file: status.file,
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
				file={status.file}
				turns={status.turns}
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
				file={status.file}
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
				onNew={() => setStatus({ state: "idle" })}
			/>
		);
	}

	return (
		<UploadScreen
			onFileSelected={handleFile}
			error={status.state === "error" ? status.message : undefined}
		/>
	);
}

export default App;

import { useEffect, useState } from "react";
import { CastScreen, type CastResult } from "@/features/faces/CastScreen";
import { EditorView } from "@/features/timeline/EditorView";
import { ProcessingScreen } from "@/features/upload/ProcessingScreen";
import { UploadScreen } from "@/features/upload/UploadScreen";
import { useThemeMode } from "@/lib/theme";
import {
	getProgress,
	processVideo,
	type DetectFacesResponse,
	type JobProgress,
	type MatchResult,
	type OverlapWindow,
	type Turn,
	type Word,
} from "@/lib/api";

type Status =
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
	  };

function App() {
	const [themeMode, setThemeMode] = useThemeMode();
	const [status, setStatus] = useState<Status>({ state: "idle" });
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

	if (status.state === "processing") {
		return (
			<ProcessingScreen
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
				match={status.match}
				sampledFrames={Math.max(0, ...status.faces.people.map((p) => p.detectionCount))}
				onComplete={(cast) =>
					setStatus({
						state: "editing",
						file: status.file,
						sessionId: status.sessionId,
						turns: status.turns,
						overlapWindows: status.overlapWindows,
						words: status.words,
						faces: status.faces,
						cast,
					})
				}
			/>
		);
	}

	if (status.state === "editing") {
		return (
			<EditorView
				file={status.file}
				sessionId={status.sessionId}
				turns={status.turns}
				overlapWindows={status.overlapWindows}
				words={status.words}
				faces={status.faces}
				cast={status.cast}
				themeMode={themeMode}
				onThemeModeChange={setThemeMode}
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

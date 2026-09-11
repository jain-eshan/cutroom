import { useState } from "react";
import { SpeakerLabelingScreen } from "@/features/faces/SpeakerLabelingScreen";
import { EditorView } from "@/features/timeline/EditorView";
import { UploadScreen } from "@/features/upload/UploadScreen";
import { detectFaces, transcribe, type DetectFacesResponse, type Turn } from "@/lib/api";

type Status =
	| { state: "idle" }
	| { state: "processing" }
	| { state: "error"; message: string }
	| { state: "labeling"; file: File; turns: Turn[]; faces: DetectFacesResponse }
	| {
			state: "editing";
			file: File;
			turns: Turn[];
			faces: DetectFacesResponse;
			speakerToTrack: Record<number, number>;
	  };

function invertMapping(trackIdToSpeakerId: Record<number, number>): Record<number, number> {
	const speakerIdToTrackId: Record<number, number> = {};
	for (const [trackId, speakerId] of Object.entries(trackIdToSpeakerId)) {
		speakerIdToTrackId[speakerId] = Number(trackId);
	}
	return speakerIdToTrackId;
}

function App() {
	const [status, setStatus] = useState<Status>({ state: "idle" });

	async function handleFile(file: File) {
		setStatus({ state: "processing" });
		try {
			const [{ turns }, faces] = await Promise.all([transcribe(file), detectFaces(file)]);
			setStatus({ state: "labeling", file, turns, faces });
		} catch (err) {
			setStatus({
				state: "error",
				message: err instanceof Error ? err.message : "Something went wrong.",
			});
		}
	}

	if (status.state === "processing") {
		return (
			<div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-neutral-500">
				Transcribing, detecting speakers, and finding faces — this runs locally and can take
				a few minutes for longer recordings...
			</div>
		);
	}

	if (status.state === "labeling") {
		const speakerIds = [...new Set(status.turns.map((t) => t.speaker))].sort((a, b) => a - b);
		return (
			<SpeakerLabelingScreen
				tracks={status.faces.tracks}
				speakerIds={speakerIds}
				onComplete={(trackIdToSpeakerId) =>
					setStatus({
						state: "editing",
						file: status.file,
						turns: status.turns,
						faces: status.faces,
						speakerToTrack: invertMapping(trackIdToSpeakerId),
					})
				}
			/>
		);
	}

	if (status.state === "editing") {
		return (
			<EditorView
				file={status.file}
				turns={status.turns}
				faces={status.faces}
				speakerToTrack={status.speakerToTrack}
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

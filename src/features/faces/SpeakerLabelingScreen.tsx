import { useState } from "react";
import type { FaceTrack } from "@/lib/api";

export function SpeakerLabelingScreen({
	tracks,
	speakerIds,
	onComplete,
}: {
	tracks: FaceTrack[];
	speakerIds: number[];
	onComplete: (trackIdToSpeakerId: Record<number, number>) => void;
}) {
	const [mapping, setMapping] = useState<Record<number, number | "none">>({});

	function setTrackSpeaker(trackId: number, value: string) {
		setMapping((prev) => ({ ...prev, [trackId]: value === "none" ? "none" : Number(value) }));
	}

	function handleContinue() {
		const result: Record<number, number> = {};
		for (const [trackId, speaker] of Object.entries(mapping)) {
			if (speaker !== "none") result[Number(trackId)] = speaker;
		}
		onComplete(result);
	}

	return (
		<div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-10">
			<h2 className="text-lg font-semibold">Who's who?</h2>
			<p className="text-sm text-neutral-500">
				One-time step — match each detected face to a speaker from the transcript. This
				unlocks automatic zoom/crop for every turn. Faces left unmatched just won't get
				auto-framing.
			</p>
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
				{tracks.map((track) => (
					<div key={track.id} className="flex flex-col items-center gap-2">
						<img
							src={track.thumbnail}
							alt={`Detected face ${track.id + 1}`}
							className="h-28 w-28 rounded-lg border border-neutral-200 object-cover dark:border-neutral-700"
						/>
						<select
							className="w-full rounded border border-neutral-300 bg-transparent p-1 text-sm dark:border-neutral-700"
							value={mapping[track.id] ?? "none"}
							onChange={(e) => setTrackSpeaker(track.id, e.target.value)}
						>
							<option value="none">Not a speaker</option>
							{speakerIds.map((id) => (
								<option key={id} value={id}>
									Speaker {id + 1}
								</option>
							))}
						</select>
					</div>
				))}
			</div>
			<button
				type="button"
				onClick={handleContinue}
				className="mt-2 self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
			>
				Continue
			</button>
		</div>
	);
}

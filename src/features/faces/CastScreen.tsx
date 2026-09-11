import { useEffect, useRef, useState } from "react";
import type { Person, Turn } from "@/lib/api";

export interface CastResult {
	names: Record<number, string>;
	speakerToPerson: Record<number, number>;
	description: string;
}

function defaultName(index: number) {
	return `Person ${index + 1}`;
}

/** The longest thing a voice said -- the most useful sample to identify it by. */
function longestTurn(turns: Turn[], speaker: number): Turn | undefined {
	let best: Turn | undefined;
	for (const t of turns) {
		if (t.speaker !== speaker) continue;
		if (!best || t.end - t.start > best.end - best.start) best = t;
	}
	return best;
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CastScreen({
	file,
	people,
	turns,
	sampledFrames,
	onComplete,
}: {
	file: File;
	people: Person[];
	turns: Turn[];
	sampledFrames: number;
	onComplete: (result: CastResult) => void;
}) {
	const [names, setNames] = useState<Record<number, string>>(() =>
		Object.fromEntries(people.map((p, i) => [p.id, defaultName(i)])),
	);
	const [speakerToPerson, setSpeakerToPerson] = useState<Record<number, number>>({});
	const [description, setDescription] = useState("");
	const [playing, setPlaying] = useState<number | null>(null);

	const audioRef = useRef<HTMLVideoElement>(null);
	const stopAt = useRef<number | null>(null);
	const [mediaUrl, setMediaUrl] = useState<string | null>(null);

	useEffect(() => {
		const url = URL.createObjectURL(file);
		setMediaUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	// Stop the sample at the end of the turn instead of playing on into the
	// rest of the episode.
	useEffect(() => {
		const el = audioRef.current;
		if (!el) return;
		const onTime = () => {
			if (stopAt.current !== null && el.currentTime >= stopAt.current) {
				el.pause();
				setPlaying(null);
			}
		};
		el.addEventListener("timeupdate", onTime);
		return () => el.removeEventListener("timeupdate", onTime);
	}, [mediaUrl]);

	const speakers = [...new Set(turns.map((t) => t.speaker))].sort((a, b) => a - b);

	function playSample(speaker: number) {
		const turn = longestTurn(turns, speaker);
		const el = audioRef.current;
		if (!turn || !el) return;
		if (playing === speaker) {
			el.pause();
			setPlaying(null);
			return;
		}
		el.currentTime = turn.start;
		stopAt.current = Math.min(turn.end, turn.start + 8);
		void el.play();
		setPlaying(speaker);
	}

	const everyVoiceAssigned = speakers.every((s) => speakerToPerson[s] !== undefined);

	return (
		<div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
			{mediaUrl && <video ref={audioRef} src={mediaUrl} className="hidden" preload="auto" />}

			<div className="flex flex-col gap-2">
				<h2 className="text-lg font-semibold">Who's in this episode?</h2>
				<p className="text-sm text-neutral-500">
					Name everyone once. These names are used everywhere else, so you never have to work
					out which anonymous "Speaker 2" was which.
				</p>
			</div>

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				{people.map((person, i) => {
					const presence = sampledFrames > 0 ? person.detectionCount / sampledFrames : 0;
					return (
						<div key={person.id} className="flex flex-col items-center gap-2">
							<img
								src={person.thumbnail}
								alt={names[person.id] ?? defaultName(i)}
								className="h-24 w-24 rounded-lg border border-neutral-200 object-cover dark:border-neutral-700"
							/>
							<input
								value={names[person.id] ?? ""}
								onChange={(e) => setNames((prev) => ({ ...prev, [person.id]: e.target.value }))}
								placeholder={defaultName(i)}
								className="w-full rounded border border-neutral-300 bg-transparent p-1 text-center text-sm dark:border-neutral-700"
							/>
							<span className="text-[11px] text-neutral-400">
								{presence >= 0.5
									? "on screen throughout"
									: `on screen ${Math.round(presence * 100)}%`}
							</span>
						</div>
					);
				})}
			</div>

			<div className="flex flex-col gap-2">
				<h3 className="text-base font-semibold">Which voice is which?</h3>
				<p className="text-sm text-neutral-500">
					We found {speakers.length} distinct {speakers.length === 1 ? "voice" : "voices"}. Listen
					to each and pick who it is — this is what decides who the camera cuts to.
				</p>
			</div>

			<div className="flex flex-col gap-3">
				{speakers.map((speaker) => {
					const sample = longestTurn(turns, speaker);
					return (
						<div
							key={speaker}
							className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
						>
							<div className="flex items-center gap-3">
								<button
									type="button"
									onClick={() => playSample(speaker)}
									disabled={!sample}
									className="shrink-0 rounded-full bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
								>
									{playing === speaker ? "Stop" : "Play"}
								</button>
								<select
									value={speakerToPerson[speaker] ?? ""}
									onChange={(e) =>
										setSpeakerToPerson((prev) => {
											const next = { ...prev };
											if (e.target.value === "") delete next[speaker];
											else next[speaker] = Number(e.target.value);
											return next;
										})
									}
									className="flex-1 rounded border border-neutral-300 bg-transparent p-1.5 text-sm dark:border-neutral-700"
								>
									<option value="">Who is this? —</option>
									{people.map((p, i) => (
										<option key={p.id} value={p.id}>
											{names[p.id] || defaultName(i)}
										</option>
									))}
								</select>
							</div>
							{sample && (
								<p className="text-xs text-neutral-500">
									<span className="text-neutral-400">{formatTime(sample.start)}</span>{" "}
									&ldquo;{sample.text.slice(0, 160)}
									{sample.text.length > 160 ? "…" : ""}&rdquo;
								</p>
							)}
						</div>
					);
				})}
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="episode-description" className="text-base font-semibold">
					What's this episode about? <span className="text-neutral-400">(optional)</span>
				</label>
				<textarea
					id="episode-description"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					rows={2}
					placeholder="A sentence or two — kept with the edit for your own reference."
					className="rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
				/>
			</div>

			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={() => onComplete({ names, speakerToPerson, description })}
					className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
				>
					Continue
				</button>
				{!everyVoiceAssigned && (
					<span className="text-xs text-neutral-400">
						Unassigned voices just won't get a close-up — you can still fix any turn later.
					</span>
				)}
			</div>
		</div>
	);
}

import { useEffect, useRef, useState } from "react";
import type { MatchNote, MatchResult, Person, Turn } from "@/lib/api";

/** Below this, the automatic match is shown as a guess to check rather than an
 * answer. Matches pipeline/fuse.py's DOMINANT_SHARE. */
const CONFIDENT = 0.6;

const SPEAKER_TOKENS = ["bg-s1", "bg-s2", "bg-s3"];

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

function list(items: string[]): string {
	if (items.length <= 1) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Notes arrive as data. Naming the people here means they are called whatever
 * the editor just called them, two fields up the page, rather than "person 2". */
function noteText(
	note: MatchNote,
	nameOf: (personId: number) => string,
	voiceLabel: (speaker: number) => string,
): string {
	const people = list(note.personIds.map(nameOf));
	const voices = list(note.speakers.map(voiceLabel));
	switch (note.kind) {
		case "over_split":
			return `${voices} both sound like ${people} — one person was probably split into two voices. Pointing both at ${people} is usually right.`;
		case "voice_unmatched":
			return `${voices} never speaks while anyone's mouth is moving — they may be off camera, or the same person as another voice.`;
		case "low_confidence":
			return `${voices} is split across more than one face — two people may have been treated as one voice. Worth listening to.`;
		case "person_unmatched":
			return `No voice matched ${people} — they may not speak in this episode.`;
	}
}

export function CastScreen({
	file,
	people,
	turns,
	match,
	sampledFrames,
	onComplete,
}: {
	file: File;
	people: Person[];
	turns: Turn[];
	match: MatchResult;
	sampledFrames: number;
	onComplete: (result: CastResult) => void;
}) {
	const [names, setNames] = useState<Record<number, string>>(() =>
		Object.fromEntries(people.map((p, i) => [p.id, defaultName(i)])),
	);
	// Pre-filled from the lip-sync match rather than starting blank. It is
	// still the editor's call -- every one of these is a select they can change
	// -- but starting from evidence beats starting from nothing.
	const [speakerToPerson, setSpeakerToPerson] = useState<Record<number, number>>(
		() => ({ ...match.speakerToPerson }),
	);
	const confidenceFor = new Map(match.matches.map((m) => [m.speaker, m]));
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

	function nameOf(personId: number): string {
		const index = people.findIndex((p) => p.id === personId);
		return names[personId] || defaultName(index === -1 ? personId : index);
	}

	// Voices have no natural name, so they get a position. The same label is
	// printed on the row itself, otherwise a note naming one is unfindable.
	function voiceLabel(speaker: number): string {
		const index = speakers.indexOf(speaker);
		return `Voice ${(index === -1 ? speaker : index) + 1}`;
	}

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
		<div className="min-h-screen bg-bg px-6 py-10">
			<div className="mx-auto flex max-w-2xl flex-col gap-8">
				{mediaUrl && <video ref={audioRef} src={mediaUrl} className="hidden" preload="auto" />}

				<div className="flex flex-col gap-2">
					<h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text">
						Who's in this episode?
					</h2>
					<p className="text-[12.5px] leading-[1.6] text-text3">
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
									className="h-24 w-24 rounded-card border border-line object-cover"
								/>
								<input
									value={names[person.id] ?? ""}
									onChange={(e) => setNames((prev) => ({ ...prev, [person.id]: e.target.value }))}
									placeholder={defaultName(i)}
									className="w-full rounded-control border border-line bg-transparent p-1 text-center text-[13px] font-semibold text-text"
								/>
								<span className="font-mono text-[10px] text-text3">
									{presence >= 0.5
										? "on screen throughout"
										: `on screen ${Math.round(presence * 100)}%`}
								</span>
							</div>
						);
					})}
				</div>

				<div className="flex flex-col gap-2">
					<h3 className="text-[15px] font-semibold text-text">Which voice is which?</h3>
					<p className="text-[12.5px] leading-[1.6] text-text3">
						We found {speakers.length} distinct {speakers.length === 1 ? "voice" : "voices"} and
						matched {speakers.length === 1 ? "it" : "them"} to faces by watching whose mouth moves.
						Check the ones flagged below — this is what decides who the camera cuts to.
					</p>
					{match.notes.length > 0 && (
						<ul className="flex flex-col gap-1 rounded-card border border-warn/45 bg-warn-bg p-3 text-[11px] leading-[1.6] text-warn">
							{match.notes.map((note, i) => (
								<li key={i}>{noteText(note, nameOf, voiceLabel)}</li>
							))}
						</ul>
					)}
				</div>

				<div className="flex flex-col gap-3">
					{speakers.map((speaker, speakerIndex) => {
						const sample = longestTurn(turns, speaker);
						const matched = confidenceFor.get(speaker);
						const automatic =
							matched?.personId != null && speakerToPerson[speaker] === matched.personId;
						return (
							<div
								key={speaker}
								className="flex flex-col gap-3 rounded-card border border-line bg-raised p-[13px]"
							>
								<div className="flex items-center gap-3">
									<span
										className={`h-[7px] w-[7px] shrink-0 rounded-full ${SPEAKER_TOKENS[speakerIndex % SPEAKER_TOKENS.length]}`}
									/>
									<span className="w-14 shrink-0 text-[11.5px] font-semibold text-text">
										{voiceLabel(speaker)}
									</span>
									<button
										type="button"
										onClick={() => playSample(speaker)}
										disabled={!sample}
										className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-40"
									>
										{playing === speaker ? "❚❚" : "▶"}
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
										className="flex-1 rounded-control border border-line bg-control p-1.5 text-[13px] text-text"
									>
										<option value="">Who is this? —</option>
										{people.map((p, i) => (
											<option key={p.id} value={p.id}>
												{names[p.id] || defaultName(i)}
											</option>
										))}
									</select>
									{automatic && matched && (
										<span
											className={`shrink-0 rounded-chip px-1.5 py-0.5 font-mono text-[10px] ${
												matched.confidence >= CONFIDENT
													? "bg-ok/15 text-ok"
													: "bg-warn-bg text-warn"
											}`}
											title={`Agreed on ${Math.round(matched.confidence * 100)}% of the ${matched.judgedSeconds}s where this voice spoke and a face was visibly talking`}
										>
											Lips match {Math.round(matched.confidence * 100)}% of this clip
										</span>
									)}
								</div>
								{sample && (
									<p className="text-[12.5px] leading-[1.6] text-text3">
										<span className="font-mono text-[10px] text-text3">{formatTime(sample.start)}</span>{" "}
										&ldquo;{sample.text.slice(0, 160)}
										{sample.text.length > 160 ? "…" : ""}&rdquo;
									</p>
								)}
							</div>
						);
					})}
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="episode-description" className="text-[15px] font-semibold text-text">
						What's this episode about? <span className="font-normal text-text3">(optional)</span>
					</label>
					<textarea
						id="episode-description"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						rows={2}
						placeholder="A sentence or two — kept with the edit for your own reference."
						className="rounded-control border border-line bg-transparent p-2 text-[13px] text-text"
					/>
				</div>

				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={() => onComplete({ names, speakerToPerson, description })}
						className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
					>
						Continue
					</button>
					{!everyVoiceAssigned && (
						<span className="text-[11px] text-text3">
							Unassigned voices just won't get a close-up — you can still fix any turn later.
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

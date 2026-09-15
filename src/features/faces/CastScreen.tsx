import { useEffect, useRef, useState } from "react";
import type { MatchNote, MatchResult, Person, Turn, Word } from "@/lib/api";
import { formatDuration } from "@/lib/format";

/** Below this, the automatic match is shown as a guess to check rather than an
 * answer. Matches pipeline/fuse.py's DOMINANT_SHARE. */
const CONFIDENT = 0.6;

const SPEAKER_BORDER = ["border-s1", "border-s2", "border-s3"];
const WAVEFORM_BARS = 15;

export interface CastResult {
	names: Record<number, string>;
	speakerToPerson: Record<number, number>;
	/** Names given to voices we never saw on camera, keyed by speaker. Without
	 * these an off-camera guest reads as "Nobody" for the whole episode. */
	voiceNames: Record<number, string>;
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

function list(items: string[]): string {
	if (items.length <= 1) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Notes arrive as data. Naming the people here means they are called whatever
 * the editor just called them, rather than "person 2". */
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

/**
 * Bar heights are how much talking happens in each fifteenth of the clip,
 * from the word timings we already have -- not audio amplitude, which would
 * mean decoding a multi-GB file in the browser. It moves with the clip it
 * belongs to, which is the honest version of this affordance.
 */
function speechDensity(words: Word[], start: number, end: number): number[] {
	const span = Math.max(0.001, end - start);
	const slices = new Array<number>(WAVEFORM_BARS).fill(0);
	for (const w of words) {
		if (w.end <= start || w.start >= end) continue;
		const from = Math.max(w.start, start);
		const to = Math.min(w.end, end);
		const first = Math.floor(((from - start) / span) * WAVEFORM_BARS);
		const last = Math.min(WAVEFORM_BARS - 1, Math.floor(((to - start) / span) * WAVEFORM_BARS));
		for (let i = Math.max(0, first); i <= last; i++) slices[i] += to - from;
	}
	const peak = Math.max(...slices);
	// A clip with no word timings still needs to look like a clip, not a
	// flat line that reads as "broken".
	if (peak <= 0) return slices.map(() => 0.35);
	return slices.map((v) => 0.25 + 0.75 * (v / peak));
}

function Waveform({ heights }: { heights: number[] }) {
	return (
		<div className="flex h-6 items-center gap-[3px]" aria-hidden="true">
			{heights.map((h, i) => (
				<span
					key={i}
					className="w-[3px] rounded-full bg-[oklch(0.38_0.01_80)]"
					style={{ height: `${Math.round(h * 100)}%` }}
				/>
			))}
		</div>
	);
}

export function CastScreen({
	file,
	people,
	turns,
	words,
	match,
	onComplete,
}: {
	file: File;
	people: Person[];
	turns: Turn[];
	words: Word[];
	match: MatchResult;
	onComplete: (result: CastResult) => void;
}) {
	const [names, setNames] = useState<Record<number, string>>(() =>
		Object.fromEntries(people.map((p, i) => [p.id, defaultName(i)])),
	);
	// Pre-filled from the lip-sync match rather than starting blank. Still the
	// editor's call -- every one is changeable -- but starting from evidence
	// beats starting from nothing. `null` means "nobody we saw".
	const [choices, setChoices] = useState<Record<number, number | null>>(
		() => ({ ...match.speakerToPerson }),
	);
	const [index, setIndex] = useState(0);
	const [voiceNames, setVoiceNames] = useState<Record<number, string>>({});
	const [playing, setPlaying] = useState(false);

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
				setPlaying(false);
			}
		};
		el.addEventListener("timeupdate", onTime);
		return () => el.removeEventListener("timeupdate", onTime);
	}, [mediaUrl]);

	const speakers = [...new Set(turns.map((t) => t.speaker))].sort((a, b) => a - b);
	const speaker = speakers[index];
	const sample = longestTurn(turns, speaker);
	const guess = match.matches.find((m) => m.speaker === speaker);
	const selected = choices[speaker] ?? null;
	// The pipeline found no face that ever moves with this voice.
	const noFace = guess?.personId == null;
	const voiceTurns = turns.filter((t) => t.speaker === speaker);
	const voiceSeconds = voiceTurns.reduce((total, t) => total + (t.end - t.start), 0);
	const voiceName = voiceNames[speaker]?.trim() ?? "";

	function nameOf(personId: number): string {
		const position = people.findIndex((p) => p.id === personId);
		return names[personId] || defaultName(position === -1 ? personId : position);
	}

	// Voices have no natural name, so they get a position.
	function voiceLabel(target: number): string {
		const position = speakers.indexOf(target);
		return `Voice ${(position === -1 ? target : position) + 1}`;
	}

	function stop() {
		audioRef.current?.pause();
		setPlaying(false);
	}

	function togglePlay() {
		const el = audioRef.current;
		if (!sample || !el) return;
		if (playing) {
			stop();
			return;
		}
		el.currentTime = sample.start;
		stopAt.current = Math.min(sample.end, sample.start + 12);
		void el.play();
		setPlaying(true);
	}

	function confirm() {
		stop();
		if (index + 1 < speakers.length) {
			setIndex(index + 1);
			return;
		}
		const speakerToPerson: Record<number, number> = {};
		for (const s of speakers) {
			const choice = choices[s];
			if (choice !== null && choice !== undefined) speakerToPerson[s] = choice;
		}
		const namedVoices = Object.fromEntries(
			Object.entries(voiceNames)
				.filter(([, name]) => name.trim())
				.map(([voice, name]) => [voice, name.trim()]),
		);
		onComplete({ names, speakerToPerson, voiceNames: namedVoices });
	}

	// The no-face card below already says what a voice_unmatched note would.
	const notes = match.notes.filter(
		(n) => n.speakers.includes(speaker) && !(noFace && n.kind === "voice_unmatched"),
	);
	const confirmLabel =
		selected !== null
			? `Yes, that's ${nameOf(selected)}`
			: voiceName
				? `Yes, that's ${voiceName}`
				: "Nobody we saw";
	const guessedName =
		guess?.personId != null && selected === guess.personId ? nameOf(guess.personId) : null;

	return (
		<div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[540px] flex-col gap-5 rounded-panel border border-line bg-panel p-[26px]">
				{mediaUrl && <video ref={audioRef} src={mediaUrl} className="hidden" preload="auto" />}

				<div className="flex items-baseline justify-between gap-4">
					<h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text">
						Who is this?
					</h2>
					<span className="font-mono text-[10px] tracking-[0.08em] text-text3">
						VOICE {index + 1} OF {speakers.length}
					</span>
				</div>

				{sample && (
					<div className="flex flex-col gap-3 rounded-card bg-raised p-4">
						<p className="text-[16px] leading-[1.55] text-text">
							&ldquo;{sample.text.slice(0, 240)}
							{sample.text.length > 240 ? "…" : ""}&rdquo;
						</p>
						<div className="flex items-center gap-3">
							<button
								type="button"
								onClick={togglePlay}
								className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
								aria-label={playing ? "Stop the clip" : "Play the clip"}
							>
								{playing ? "❚❚" : "▶"}
							</button>
							<Waveform heights={speechDensity(words, sample.start, sample.end)} />
							<span className="font-mono text-[10px] text-text3">
								{formatDuration(sample.end - sample.start)}
							</span>
						</div>
					</div>
				)}

				{noFace && (
					<div className="flex flex-col gap-2 rounded-card border border-line bg-raised p-4">
						<span className="font-mono text-[9.5px] tracking-[0.08em] text-text3">VOICE WITH NO FACE</span>
						<span className="text-[15px] font-semibold text-text">Someone we never saw</span>
						<p className="text-[12.5px] leading-[1.6] text-text3">
							This voice never lines up with a face on screen — an off-camera guest, or someone
							behind the camera. Their turns stay wide, which is the honest choice.
						</p>
						<span className="font-mono text-[10px] text-text3">
							{voiceTurns.length} {voiceTurns.length === 1 ? "turn" : "turns"} ·{" "}
							{formatDuration(voiceSeconds)} total
						</span>
						<label className="mt-1 flex flex-col gap-1">
							<span className="text-[11px] text-text3">Give them a name anyway</span>
							<input
								value={voiceNames[speaker] ?? ""}
								onChange={(e) => setVoiceNames({ ...voiceNames, [speaker]: e.target.value })}
								placeholder={voiceLabel(speaker)}
								className="rounded-control border border-line bg-panel px-2 py-1.5 text-[13px] font-semibold text-text"
							/>
						</label>
					</div>
				)}

				{notes.length > 0 && (
					<ul className="flex flex-col gap-1 rounded-card border border-warn/45 bg-warn-bg p-3 text-[11px] leading-[1.6] text-warn">
						{notes.map((note, i) => (
							<li key={i}>{noteText(note, nameOf, voiceLabel)}</li>
						))}
					</ul>
				)}

				<div className="grid grid-cols-3 gap-3">
					{people.map((person, i) => {
						const isSelected = selected === person.id;
						const isGuess = guess?.personId === person.id;
						return (
							<button
								key={person.id}
								type="button"
								onClick={() => setChoices({ ...choices, [speaker]: person.id })}
								className={`flex h-full flex-col gap-1.5 rounded-card border-2 p-1.5 text-left ${
									isSelected ? SPEAKER_BORDER[i % SPEAKER_BORDER.length] : "border-line"
								}`}
							>
								<img
									src={person.thumbnail}
									alt=""
									className="w-full rounded-chip object-cover"
									style={{ aspectRatio: "1 / 1.2" }}
								/>
								<input
									value={names[person.id] ?? ""}
									onClick={(e) => e.stopPropagation()}
									onChange={(e) => setNames({ ...names, [person.id]: e.target.value })}
									placeholder={defaultName(i)}
									aria-label={`Name for ${defaultName(i)}`}
									className="w-full rounded-chip bg-transparent px-1 py-0.5 text-[13px] font-semibold text-text"
								/>
								<span className="px-1 pb-0.5 text-[11px] leading-[1.35] text-text3">
									{isGuess && guess
										? `Lips match ${Math.round(guess.confidence * 100)}% of this clip`
										: " "}
								</span>
							</button>
						);
					})}

					<button
						type="button"
						onClick={() => setChoices({ ...choices, [speaker]: null })}
						className={`flex h-full flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed p-3 text-center ${
							selected === null ? "border-accent" : "border-line"
						}`}
					>
						<span className="text-[12.5px] font-medium text-text2">Someone we didn't see</span>
						<span className="text-[11px] leading-[1.35] text-text3">They stay wide</span>
					</button>
				</div>

				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={confirm}
							className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
						>
							{confirmLabel}
						</button>
						{guessedName && (
							<span className="max-w-[200px] text-[11px] leading-[1.4] text-text3">
								We guessed {guessedName}. Play the clip if you're not sure.
							</span>
						)}
						{guess && guess.personId != null && guess.confidence < CONFIDENT && (
							<span className="max-w-[200px] text-[11px] leading-[1.4] text-warn">
								This one is a coin flip — worth listening to.
							</span>
						)}
					</div>
					{index > 0 && (
						<button
							type="button"
							onClick={() => {
								stop();
								setIndex(index - 1);
							}}
							className="text-[11px] text-text3 underline"
						>
							Previous voice
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

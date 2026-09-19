import { useEffect, useRef, useState } from "react";
import type { MatchNote, MatchResult, Person, Turn, Word } from "@/lib/api";
import { formatClock, formatDuration } from "@/lib/format";
import { Button, PlayButton, Screen } from "@/components/ui";

/** Below this, the automatic match is shown as a guess to check rather than an
 * answer. Matches pipeline/fuse.py's DOMINANT_SHARE. */
const CONFIDENT = 0.6;

const SPEAKER_BORDER = ["border-s1", "border-s2", "border-s3"];
const SPEAKER_TEXT = ["text-s1", "text-s2", "text-s3"];
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

/** Played bars in accent, the rest on the control token -- both flip with
 * the theme, unlike the literal grey this used to be. */
function Waveform({ heights, played }: { heights: number[]; played: number }) {
	return (
		<div className="flex h-[26px] flex-1 items-center gap-0.5" aria-hidden="true">
			{heights.map((h, i) => (
				<span
					key={i}
					className={`flex-1 rounded-[1px] ${i < Math.round(played * heights.length) ? "bg-accent" : "bg-control"}`}
					style={{ height: `${Math.round(h * 100)}%` }}
				/>
			))}
		</div>
	);
}

export function CastScreen({
	videoUrl,
	people,
	turns,
	words,
	match,
	onComplete,
}: {
	/** Playable directly -- a fresh upload's object URL, or a resumed
	 * session's `/jobs/{id}/media`. Owned by App. */
	videoUrl: string;
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
	// How far through the sample playback is, for the waveform.
	const [played, setPlayed] = useState(0);

	const audioRef = useRef<HTMLVideoElement>(null);
	const stopAt = useRef<number | null>(null);
	// The sample being played, so the waveform can show how far through it is.
	const clip = useRef<[number, number] | null>(null);
	// Same eviction risk as the editor's own video (server/jobs/ isn't kept
	// forever) -- without this, clicking play just silently does nothing.
	// Tracks *which* url errored, the same reason EditorView.tsx's mediaError
	// does: a new videoUrl clears it for free by no longer matching, instead
	// of resetting a plain boolean inside the effect (after render, for no
	// visible benefit) every time this runs.
	const [erroredUrl, setErroredUrl] = useState<string | null>(null);
	const audioError = erroredUrl !== null && erroredUrl === videoUrl;

	// Stop the sample at the end of the turn instead of playing on into the
	// rest of the episode.
	useEffect(() => {
		const el = audioRef.current;
		if (!el) return;
		const onTime = () => {
			if (clip.current) {
				const [from, to] = clip.current;
				setPlayed(Math.max(0, Math.min(1, (el.currentTime - from) / Math.max(0.001, to - from))));
			}
			if (stopAt.current !== null && el.currentTime >= stopAt.current) {
				el.pause();
				setPlaying(false);
			}
		};
		const onError = () => {
			setErroredUrl(videoUrl);
			setPlaying(false);
		};
		el.addEventListener("timeupdate", onTime);
		el.addEventListener("error", onError);
		return () => {
			el.removeEventListener("timeupdate", onTime);
			el.removeEventListener("error", onError);
		};
	}, [videoUrl]);

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
		if (!sample || !el || audioError) return;
		if (playing) {
			stop();
			return;
		}
		el.currentTime = sample.start;
		stopAt.current = Math.min(sample.end, sample.start + 12);
		clip.current = [sample.start, stopAt.current];
		void el.play();
		setPlaying(true);
	}

	function confirm() {
		stop();
		setPlayed(0);
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

	// The "someone we didn't see" cell already says what a voice_unmatched note would.
	const notes = match.notes.filter(
		(n) => n.speakers.includes(speaker) && !(noFace && n.kind === "voice_unmatched"),
	);
	const last = index + 1 >= speakers.length;
	const chosen = selected !== null ? nameOf(selected) : voiceName || null;
	const confirmLabel = chosen
		? `That's ${chosen}${last ? "" : " — next voice"}`
		: `They weren't on camera${last ? "" : " — next voice"}`;
	const guessedName =
		guess?.personId != null && selected === guess.personId ? nameOf(guess.personId) : null;
	const coinFlip = guess && guess.personId != null && guess.confidence < CONFIDENT;

	return (
		<Screen width={620}>
			<video ref={audioRef} src={videoUrl} className="hidden" preload="auto" />

			<div className="flex items-baseline gap-[11px]">
				<h1 className="text-title font-semibold tracking-[-0.01em] text-text">Who's speaking here?</h1>
				<span className="font-mono text-mono-sm leading-none text-text3">
					voice {index + 1} of {speakers.length}
				</span>
			</div>

			{sample && (
				<div className="flex flex-col gap-[14px] rounded-card-lg border border-line bg-chrome p-[18px]">
					<div className="flex items-center gap-[13px]">
						<PlayButton
							playing={playing}
							onClick={togglePlay}
							disabled={audioError}
							label={playing ? "Stop the clip" : "Play the clip"}
						/>
						{audioError ? (
							<span className="text-meta text-warn">Couldn't load the recording to play this clip.</span>
						) : (
							<>
								<Waveform heights={speechDensity(words, sample.start, sample.end)} played={played} />
								<span className="shrink-0 font-mono text-mono-sm leading-none text-text3">
									{formatClock(sample.start)} – {formatClock(sample.end)}
								</span>
							</>
						)}
					</div>
					<p className="text-evidence text-pretty text-text">
						&ldquo;{sample.text.slice(0, 240)}
						{sample.text.length > 240 ? "…" : ""}&rdquo;
					</p>
				</div>
			)}

			<div className="flex flex-wrap gap-[11px]">
				{people.map((person, i) => {
					const isSelected = selected === person.id;
					const isGuess = guess?.personId === person.id;
					const ring = SPEAKER_BORDER[i % SPEAKER_BORDER.length];
					return (
						<button
							key={person.id}
							type="button"
							onClick={() => setChoices({ ...choices, [speaker]: person.id })}
							aria-pressed={isSelected}
							className={`flex min-w-[130px] flex-1 flex-col gap-[9px] rounded-card-lg p-[13px] text-left ${
								isSelected ? `border-2 bg-sel ${ring}` : "border border-line bg-chrome"
							}`}
						>
							<img
								src={person.thumbnail}
								alt=""
								className={`w-full rounded-control-lg object-cover ${isSelected ? "" : "opacity-75"}`}
								style={{ aspectRatio: "1.2" }}
							/>
							<span className="flex flex-col gap-[3px]">
								<input
									value={names[person.id] ?? ""}
									onClick={(e) => e.stopPropagation()}
									onChange={(e) => setNames({ ...names, [person.id]: e.target.value })}
									placeholder={defaultName(i)}
									aria-label={`Name for ${defaultName(i)}`}
									className={`w-full rounded-chip bg-transparent text-ui leading-[1.3] font-semibold outline-none focus:bg-well ${
										isSelected ? "text-text" : "text-text2"
									}`}
								/>
								<span className={`text-mono-sm ${isSelected ? SPEAKER_TEXT[i % SPEAKER_TEXT.length] : "text-text3"}`}>
									{isGuess && guess ? `Lips match ${Math.round(guess.confidence * 100)}% of this clip` : "\u00a0"}
								</span>
							</span>
						</button>
					);
				})}

				<div
					role="button"
					tabIndex={0}
					onClick={() => setChoices({ ...choices, [speaker]: null })}
					onKeyDown={(e) => e.key === "Enter" && setChoices({ ...choices, [speaker]: null })}
					aria-pressed={selected === null}
					className={`flex w-[116px] shrink-0 cursor-pointer flex-col justify-center gap-[7px] rounded-card-lg border border-dashed p-[13px] text-center text-mono-sm text-text3 ${
						selected === null ? "border-accent bg-sel" : "border-text3/45"
					}`}
				>
					<span>Someone we didn't see — they stay wide</span>
					{noFace && (
						<span className="font-mono text-mono-xs text-text3">
							{voiceTurns.length} {voiceTurns.length === 1 ? "turn" : "turns"} · {formatDuration(voiceSeconds)}
						</span>
					)}
					{selected === null && (
						<input
							value={voiceNames[speaker] ?? ""}
							onClick={(e) => e.stopPropagation()}
							onChange={(e) => setVoiceNames({ ...voiceNames, [speaker]: e.target.value })}
							placeholder="Name them"
							aria-label="Give this voice a name anyway"
							className="w-full rounded-control border border-line bg-well px-1.5 py-1 text-center text-meta text-text outline-none focus:border-accent-edge"
						/>
					)}
				</div>
			</div>

			{notes.length > 0 && (
				<ul className="flex flex-col gap-1">
					{notes.map((note, i) => (
						<li key={i} className="flex gap-[7px] text-fine text-warn">
							<span className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full bg-warn" />
							{noteText(note, nameOf, voiceLabel)}
						</li>
					))}
				</ul>
			)}

			<div className="flex items-center gap-[14px] pt-0.5">
				<Button variant="primary" onClick={confirm}>
					{confirmLabel}
				</Button>
				{index > 0 && (
					<Button
						variant="ghost"
						onClick={() => {
							stop();
							setPlayed(0);
							setIndex(index - 1);
						}}
					>
						Previous voice
					</Button>
				)}
				<span className={`ml-auto max-w-[240px] text-right text-fine ${coinFlip ? "text-warn" : "text-text3"}`}>
					{coinFlip
						? "This one is a coin flip — worth listening to."
						: noFace
							? "This voice never lines up with a face on screen, so their turns stay wide."
							: guessedName
								? `We guessed ${guessedName}. Play the clip if you're not sure.`
								: null}
				</span>
			</div>
		</Screen>
	);
}

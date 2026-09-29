/**
 * What "Trim dead air" removes: long pauses and standalone filler words.
 *
 * Worked out here, in the editor, rather than at export, so the cuts can be
 * seen on the timeline, heard skipped in the preview and put back one at a
 * time before anything renders. The export receives this exact list and
 * cuts nothing else (see `/export` in `server/main.py`).
 *
 * Pauses come from `speech`: when anyone is audibly talking, measured from
 * the audio by the diarisation model. Turns can't stand in for it -- a turn
 * runs straight through a pause in the middle of an answer, which is where
 * most dead air is. A pause is a stretch where *nobody* is talking, so
 * speech from separate per-person tracks would simply be merged into the
 * same list first.
 *
 * Episodes processed before `speech` was saved fall back to word timings.
 * Those run slightly tighter than speech really does (Whisper reports words
 * shorter than the sound), which the air left around each cut absorbs.
 *
 * `Word` is imported type-only, so this module pulls in nothing at runtime
 * and Node's test runner can load it.
 */
import type { Word } from "@/lib/api";

export interface Span {
	start: number;
	end: number;
}

export interface Cut extends Span {
	/** "words" are the ones the editor struck out of the transcript. */
	kind: "pause" | "filler" | "words";
}

/** How tight to cut, named for the rule rather than a temperament -- the same
 * reasoning as `FRAMING_STYLE_LABELS`. */
export type CutStrength = "long" | "most" | "tight";

/** The shortest pause each strength cuts. Pauses in real conversation are
 * mostly short -- one multi-track show measured a 0.46s median and 1.39s at
 * the 95th percentile -- so 2s only catches the genuinely dead stretches,
 * and 0.5s tightens most of the conversation. Not yet measured against a
 * professional edit of a single-camera show. */
export const CUT_PAUSES_OVER_S: Record<CutStrength, number> = { long: 2, most: 1, tight: 0.5 };

export const CUT_STRENGTH_LABELS: Record<CutStrength, string> = {
	long: `Over ${CUT_PAUSES_OVER_S.long}s`,
	most: `Over ${CUT_PAUSES_OVER_S.most}s`,
	tight: `Over ${CUT_PAUSES_OVER_S.tight}s`,
};

/** Left on each side of a cut pause. A little air reads as a natural beat; a
 * hard cut to the next syllable reads as automated, and a clipped first
 * letter is worse than a pause that runs slightly long. */
const AIR_S = 0.25;
/** Capped as a share of the pause, per side, so a short pause at the tight
 * end still loses something rather than being swallowed by its own air. */
const AIR_MAX_SHARE = 0.35;

/** Words Whisper transcribes as a standalone disfluency. Deliberately
 * narrow: "like", "so", "actually" are sometimes filler and sometimes
 * meaning, and there's no telling which from the word alone. */
const FILLER_WORDS = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "hmm", "mhm"]);
/** Around a cut filler word, so the cut takes all of it. */
const FILLER_PAD_S = 0.05;

/** Between two cuts, anything shorter than this is dropped with them. It is
 * only ever the air left at their edges, and kept it would be two jump cuts
 * a blink apart in the picture. */
const MIN_KEEP_S = 0.3;

export function mergeSpans(spans: Span[], within = 0): Span[] {
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	const merged: Span[] = [];
	for (const { start, end } of sorted) {
		const last = merged[merged.length - 1];
		if (last && start - last.end <= within) last.end = Math.max(last.end, end);
		else merged.push({ start, end });
	}
	return merged;
}

/** Every pause and filler word the chosen strength removes, in time order,
 * before any are put back. */
export function findCuts(speech: Span[] | undefined, words: Word[], duration: number, strength: CutStrength): Cut[] {
	const minPause = CUT_PAUSES_OVER_S[strength];
	const talking = mergeSpans(speech && speech.length > 0 ? speech : words);
	const cuts: Cut[] = [];

	let cursor = 0;
	for (const span of [...talking, { start: duration, end: duration }]) {
		const gap = Math.min(span.start, duration) - cursor;
		if (gap >= minPause) {
			const air = Math.min(AIR_S, gap * AIR_MAX_SHARE);
			cuts.push({ start: cursor + air, end: cursor + gap - air, kind: "pause" });
		}
		cursor = Math.max(cursor, span.end);
	}

	for (const word of words) {
		const token = word.text.trim().toLowerCase().replace(/^[.,!?-]+|[.,!?-]+$/g, "");
		if (FILLER_WORDS.has(token)) {
			cuts.push({ start: Math.max(0, word.start - FILLER_PAD_S), end: Math.min(duration, word.end + FILLER_PAD_S), kind: "filler" });
		}
	}
	return cuts.sort((a, b) => a.start - b.start);
}

/** How far a cut of struck-out words reaches into the silence either side
 * of them, at most half of it. Enough to take the breath before a sentence
 * with it; the rest of each pause stays, so the words left either side meet
 * with about one natural pause between them rather than none. */
const WORD_EDGE_S = 0.15;

/** The words the editor struck out, as cuts: one per run of consecutive
 * word indices. `removed` holds indices into `words`, the same keys
 * `wordEdits` uses, so a correction and a cut can sit on the same word. */
export function wordCuts(words: Word[], removed: number[]): Cut[] {
	const indices = [...new Set(removed)].filter((i) => words[i]).sort((a, b) => a - b);
	const cuts: Cut[] = [];
	for (let i = 0; i < indices.length; i++) {
		const first = indices[i];
		while (indices[i + 1] === indices[i] + 1) i++;
		const last = indices[i];
		const before = words[first - 1];
		const after = words[last + 1];
		const start = words[first].start - Math.min(WORD_EDGE_S, before ? (words[first].start - before.end) / 2 : WORD_EDGE_S);
		const end = words[last].end + Math.min(WORD_EDGE_S, after ? (after.start - words[last].end) / 2 : WORD_EDGE_S);
		cuts.push({ start: Math.max(0, start), end, kind: "words" });
	}
	return cuts;
}

/** The words still in the edit, for captions and subtitle files: a word
 * whose middle falls inside a cut is gone from the picture, so it shouldn't
 * be on screen either. */
export function wordsLeft(words: Word[], drops: Span[]): Word[] {
	return words.filter((word) => skipTo((word.start + word.end) / 2, drops) === null);
}

/** Whether the editor put this cut back. Kept cuts are remembered as moments
 * rather than as the cuts themselves, so changing the strength -- which moves
 * every cut's edges -- still keeps the same pause. */
export function isKept(cut: Span, kept: number[]): boolean {
	return kept.some((t) => t >= cut.start && t < cut.end);
}

/** What the export removes: every cut not put back, plus the words struck
 * out of the transcript, merged so neighbouring ones (a filler at the edge of
 * a pause) become one. Struck-out words are never "kept" -- putting them back
 * means un-striking them -- so they're added after the kept filter. */
export function activeCuts(cuts: Cut[], kept: number[], struck: Span[] = []): Span[] {
	return mergeSpans(
		[...cuts.filter((cut) => !isKept(cut, kept)), ...struck],
		MIN_KEEP_S,
	);
}

/** Where a moment on the original recording lands once `drops` (sorted,
 * non-overlapping) are cut out. A port of `remap_time` in
 * `server/pipeline/trim.py`, used for subtitle files cut to the same edit. */
export function remapTime(t: number, drops: Span[]): number {
	let shift = 0;
	for (const { start, end } of drops) {
		if (end <= t) shift += end - start;
		else if (start < t) shift += t - start;
	}
	return t - shift;
}

/** Where playback should jump to if `t` is inside a cut, so the preview
 * sounds like the export; null when it isn't. */
export function skipTo(t: number, drops: Span[]): number | null {
	const cut = drops.find((d) => t >= d.start && t < d.end);
	return cut ? cut.end : null;
}

/** Seconds removed in total, for saying what the trim will do. */
export function totalCut(drops: Span[]): number {
	return drops.reduce((sum, d) => sum + (d.end - d.start), 0);
}

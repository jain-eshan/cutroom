/**
 * Finding your place in the transcript: which words belong to a line, and
 * which one is being said right now.
 *
 * Both are binary searches rather than scans. They run against every
 * `timeupdate` while an episode plays, and the reference episode's transcript
 * is 8,824 words -- a scan per frame is the kind of thing that only shows up
 * as jank on the longest recordings, which are exactly the ones this is for.
 *
 * `Word` is imported type-only, so this module pulls in nothing at runtime
 * and Node's test runner can load it.
 */
import type { Turn, Word } from "@/lib/api";

/** The first index whose word ends after `t`. */
function firstEndingAfter(words: Word[], t: number): number {
	let lo = 0;
	let hi = words.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (words[mid].end <= t) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * The half-open index range `[from, to)` of the words overlapping
 * `[start, end)` -- the words of one line.
 *
 * Overlapping, not contained: a word that straddles a turn boundary belongs
 * to the line it is mostly in as far as a reader is concerned, and dropping
 * it would leave a visible hole in the line's own text.
 */
export function wordSlice(words: Word[], start: number, end: number): [number, number] {
	const from = firstEndingAfter(words, start);
	let to = from;
	while (to < words.length && words[to].start < end) to++;
	return [from, to];
}

/**
 * The index of the word being said at `t`, or -1 between words.
 *
 * -1 is a real answer, not a failure: there is silence between sentences, and
 * holding the last word highlighted through a pause says someone is still
 * speaking when they aren't. Searching within `[from, to)` keeps a line's
 * highlight inside that line even where turns overlap.
 */
export function wordAt(words: Word[], t: number, from = 0, to = words.length): number {
	let lo = from;
	let hi = to;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (words[mid].end <= t) lo = mid + 1;
		else if (words[mid].start > t) hi = mid;
		else return mid;
	}
	return -1;
}

/**
 * Corrections the editor has made, as word index -> replacement text.
 *
 * Sparse and by index, rather than a copy of the transcript: the reference
 * episode's words are 550KB, and an autosave carrying all of them on every
 * keystroke would be most of a megabyte written for one fixed name. Indices
 * are stable because `words` comes from `result.json`, which a finished job
 * never rewrites.
 *
 * A replacement may contain spaces -- "Ihaveto" corrected to "I have to" --
 * and stays one entry. It is then highlighted and captioned as one token,
 * which is a fair trade for never having to re-time anything: the timings
 * are the part that was right.
 */
export type WordEdits = Record<number, string>;

/** A token split into the punctuation around it and the word itself:
 * `"Pacto,"` is `["", "Pacto", ","]`. An apostrophe inside a word stays part
 * of it, so `"Pacto's"` is one word and not a match for `"Pacto"` -- it needs
 * its own correction, and silently turning it into `"Practo"` would lose the
 * possessive. */
const AFFIXES = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;

function splitWord(text: string): [string, string, string] {
	const m = AFFIXES.exec(text.trim());
	return m ? [m[1], m[2], m[3]] : ["", text.trim(), ""];
}

/** The word inside a token, without the punctuation around it. */
export function wordCore(text: string): string {
	return splitWord(text)[1];
}

/**
 * Every index whose word is `text`, ignoring the punctuation around either.
 *
 * Transcription gets proper nouns wrong the same way every time. On the
 * reference episode "Practo" is heard as "Pacto" in all ten places it is
 * said -- but as four different tokens, because five of them end a clause or
 * a sentence. Matching the token exactly would fix half of them and leave
 * the rest, which is the kind of half-done that is worse than not offering
 * it at all.
 */
export function occurrencesOf(words: Word[], text: string): number[] {
	const wanted = wordCore(text);
	if (!wanted) return [];
	const found: number[] = [];
	for (let i = 0; i < words.length; i++) if (wordCore(words[i].text) === wanted) found.push(i);
	return found;
}

/** `replacement`'s word, wearing `original`'s punctuation: correcting
 * "Pacto" to "Practo" turns "Pacto." into "Practo.", not "Practo". */
export function recased(original: string, replacement: string): string {
	const [prefix, , suffix] = splitWord(original);
	return prefix + wordCore(replacement) + suffix;
}

/**
 * The transcript as the editor has corrected it: the words with their
 * replacements, and the text of any line containing one rebuilt from them.
 *
 * Returns the originals unchanged, by identity, when there are no edits --
 * the common case, and everything downstream memoises on these.
 */
export function applyWordEdits(
	turns: Turn[],
	words: Word[],
	edits: WordEdits,
): { turns: Turn[]; words: Word[] } {
	const indices = Object.keys(edits).map(Number).filter((i) => i >= 0 && i < words.length);
	if (indices.length === 0) return { turns, words };

	const nextWords = words.slice();
	for (const i of indices) nextWords[i] = { ...words[i], text: edits[i] };

	// Only lines that actually contain a correction are rebuilt. A line's
	// text and its words come from different stages and don't always agree
	// exactly, so rebuilding every line would quietly reword lines nobody
	// touched.
	const touched = new Set<number>();
	for (const i of indices) {
		const word = words[i];
		const turn = turns.findIndex((t) => word.start < t.end && word.end > t.start);
		if (turn >= 0) touched.add(turn);
	}
	const nextTurns = turns.map((turn, i) => {
		if (!touched.has(i)) return turn;
		const [from, to] = wordSlice(nextWords, turn.start, turn.end);
		const text = nextWords
			.slice(from, to)
			.map((w) => w.text.trim())
			.filter(Boolean)
			.join(" ");
		return text ? { ...turn, text } : turn;
	});
	return { turns: nextTurns, words: nextWords };
}

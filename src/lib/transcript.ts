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

/**
 * A token split into the four things a correction has to put back:
 * `"(Pacto's)"` is `["(", "Pacto", "'s", ")"]`.
 *
 * The possessive is separated because it is the same word wearing a suffix.
 * On the reference episode "Practo" is misheard ten times as four tokens --
 * `Pacto`, `Pacto,`, `Pacto.` and `Pacto's` -- and a correction that only
 * fixes the bare one fixes five of ten, which is the kind of half-done that
 * is worse than not offering it.
 */
const AFFIXES = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;
const POSSESSIVE = /['\u2019]s$/u;

function splitWord(text: string): [string, string, string, string] {
	const m = AFFIXES.exec(text.trim());
	const [prefix, whole, suffix] = m ? [m[1], m[2], m[3]] : ["", text.trim(), ""];
	const possessive = POSSESSIVE.exec(whole);
	return possessive
		? [prefix, whole.slice(0, -possessive[0].length), possessive[0], suffix]
		: [prefix, whole, "", suffix];
}

/** The word inside a token, without punctuation or a possessive. */
export function wordRoot(text: string): string {
	return splitWord(text)[1];
}

/**
 * Every index whose word is `text`, ignoring punctuation, a possessive, and
 * case.
 *
 * Case is ignored because it varies in real transcripts -- the reference
 * episode says "PRACTO" in one place and "Practo" in others -- and a word
 * that differs only in capitalisation is the same word misheard.
 *
 * Deliberately not phonetic. "Same sound" matching would reach words like
 * "factor" and "actor", which appear in this very transcript and are
 * correct; silently rewriting a correct word is a worse failure than
 * leaving a wrong one, because nobody goes looking for it.
 */
export function occurrencesOf(words: Word[], text: string): number[] {
	const wanted = wordRoot(text).toLocaleLowerCase();
	if (!wanted) return [];
	const found: number[] = [];
	for (let i = 0; i < words.length; i++) {
		if (wordRoot(words[i].text).toLocaleLowerCase() === wanted) found.push(i);
	}
	return found;
}

/** Only the first letter, and the all-capitals case, are copied. Anything
 * cleverer starts guessing at words like "iPhone". */
function matchCase(original: string, replacement: string): string {
	if (!original || !replacement) return replacement;
	if (original.length > 1 && original === original.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
	const first = original[0];
	if (first === first.toLocaleUpperCase() && first !== first.toLocaleLowerCase()) {
		return replacement[0].toLocaleUpperCase() + replacement.slice(1);
	}
	return replacement[0].toLocaleLowerCase() + replacement.slice(1);
}

/** `replacement`'s word wearing `original`'s punctuation, possessive and
 * capitalisation: correcting "Pacto" to "Practo" turns "Pacto's" into
 * "Practo's" and "PACTO." into "PRACTO.". */
export function recased(original: string, replacement: string): string {
	const [prefix, root, possessive, suffix] = splitWord(original);
	return prefix + matchCase(root, wordRoot(replacement)) + possessive + suffix;
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

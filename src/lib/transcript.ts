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
import type { Word } from "@/lib/api";

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

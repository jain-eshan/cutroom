import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWordEdits, occurrencesOf, recased, wordAt, wordSlice } from "./transcript.ts";
import type { Turn, Word } from "./api.ts";

/** "a" 0-1, "b" 1-2, "c" 2-3, ... with a gap: see SPACED below. */
const WORDS: Word[] = ["a", "b", "c", "d", "e"].map((text, i) => ({ text, start: i, end: i + 1 }));

test("a line's words are the ones overlapping it", () => {
	assert.deepEqual(wordSlice(WORDS, 1, 3), [1, 3]);
	assert.deepEqual(
		WORDS.slice(...wordSlice(WORDS, 1, 3)).map((w) => w.text),
		["b", "c"],
	);
});

test("a word straddling the boundary belongs to the line it starts in", () => {
	// Turn boundaries and word timings are produced by different models and
	// do not agree; dropping the straddler would leave a hole in the line.
	const straddling: Word[] = [
		{ text: "over", start: 0.8, end: 1.4 },
		{ text: "here", start: 1.4, end: 2.0 },
	];
	assert.deepEqual(
		straddling.slice(...wordSlice(straddling, 1.0, 3.0)).map((w) => w.text),
		["over", "here"],
	);
});

test("a line with no words is an empty range, not a crash", () => {
	assert.deepEqual(wordSlice(WORDS, 99, 100), [5, 5]);
	assert.deepEqual(wordSlice([], 0, 1), [0, 0]);
});

test("the word being said is found, inclusive of its start", () => {
	assert.equal(WORDS[wordAt(WORDS, 0)].text, "a");
	assert.equal(WORDS[wordAt(WORDS, 2.5)].text, "c");
	// A word's end is the next word's start; both must not match at once.
	assert.equal(WORDS[wordAt(WORDS, 3)].text, "d");
});

test("silence between words highlights nothing", () => {
	// Holding the last word lit through a pause says someone is still
	// speaking when they have stopped.
	const spaced: Word[] = [
		{ text: "hello", start: 0, end: 0.4 },
		{ text: "again", start: 3, end: 3.5 },
	];
	assert.equal(wordAt(spaced, 1.5), -1);
	assert.equal(wordAt(spaced, 0.2), 0);
	assert.equal(wordAt(spaced, 3.2), 1);
});

test("before the first word and after the last, nothing is highlighted", () => {
	assert.equal(wordAt(WORDS, -1), -1);
	assert.equal(wordAt(WORDS, 99), -1);
	assert.equal(wordAt([], 0), -1);
});

test("the search stays inside the line it was given", () => {
	// Where two turns overlap, a line must not light up a word belonging to
	// the other speaker's line.
	assert.equal(wordAt(WORDS, 0.5, 2, 4), -1);
	assert.equal(WORDS[wordAt(WORDS, 2.5, 2, 4)].text, "c");
});

// --- Corrections ---------------------------------------------------------

const LINE: Turn[] = [{ speaker: 0, start: 0, end: 5, text: "a b c d e" }];

test("no edits returns the originals unchanged, by identity", () => {
	// Everything downstream memoises on these; a fresh array every render
	// would re-render the transcript and the timeline for nothing.
	const out = applyWordEdits(LINE, WORDS, {});
	assert.equal(out.words, WORDS);
	assert.equal(out.turns, LINE);
});

test("a correction changes the word and rebuilds its line", () => {
	const out = applyWordEdits(LINE, WORDS, { 2: "see" });
	assert.equal(out.words[2].text, "see");
	assert.equal(out.turns[0].text, "a b see d e");
	// The timings are the part that was right; they must not move.
	assert.equal(out.words[2].start, WORDS[2].start);
	assert.equal(out.words[2].end, WORDS[2].end);
});

test("lines without a correction are left exactly as they were", () => {
	// A line's text and its words come from different stages and don't always
	// agree, so rebuilding untouched lines would silently reword them.
	const two: Turn[] = [
		{ speaker: 0, start: 0, end: 2, text: "originally written this way" },
		{ speaker: 1, start: 2, end: 5, text: "c d e" },
	];
	const out = applyWordEdits(two, WORDS, { 3: "dee" });
	assert.equal(out.turns[0].text, "originally written this way");
	assert.equal(out.turns[1].text, "c dee e");
});

test("a correction may be several words and stays one token", () => {
	// Splitting would mean re-timing, and the timings were not the problem.
	const out = applyWordEdits(LINE, WORDS, { 0: "I have to" });
	assert.equal(out.words.length, WORDS.length);
	assert.equal(out.words[0].text, "I have to");
	assert.equal(out.turns[0].text, "I have to b c d e");
});

test("an index that isn't a word is ignored rather than crashing", () => {
	// Edits come off disk, where an older or hand-edited file can name one.
	assert.equal(applyWordEdits(LINE, WORDS, { 99: "x" }).words, WORDS);
	assert.equal(applyWordEdits(LINE, WORDS, { [-1]: "x" }).words, WORDS);
});

test("every occurrence of a word is found", () => {
	// The real case: "Practo" is transcribed "Pacto" in all ten places it is
	// said, so correcting one is almost always correcting all of them.
	const repeated: Word[] = ["Pacto", "and", "Pacto", "again", "pacto"].map((text, i) => ({
		text,
		start: i,
		end: i + 1,
	}));
	assert.deepEqual(occurrencesOf(repeated, "Pacto"), [0, 2]);
	// Case matters: "pacto" mid-sentence is a different correction from the
	// capitalised one that starts a sentence.
	assert.deepEqual(occurrencesOf(repeated, "pacto"), [4]);
	assert.deepEqual(occurrencesOf(repeated, "  Pacto "), [0, 2]);
	assert.deepEqual(occurrencesOf(repeated, "   "), []);
});

test("occurrences ignore the punctuation around a word", () => {
	// The real shape of the problem: ten mishearings of one name, spread over
	// four tokens because five of them end a clause or a sentence. Matching
	// the token exactly fixes half and leaves the rest.
	const spread: Word[] = ["Pacto", "Pacto,", "Pacto.", "Pacto's", "factor"].map((text, i) => ({
		text,
		start: i,
		end: i + 1,
	}));
	assert.deepEqual(occurrencesOf(spread, "Pacto"), [0, 1, 2]);
	// A possessive is its own word and needs its own correction; turning it
	// into "Practo" would drop the "'s".
	assert.deepEqual(occurrencesOf(spread, "Pacto's"), [3]);
});

test("a corrected word keeps the punctuation it had", () => {
	assert.equal(recased("Pacto.", "Practo"), "Practo.");
	assert.equal(recased("Pacto,", "Practo"), "Practo,");
	assert.equal(recased("Pacto", "Practo."), "Practo");
	assert.equal(recased("(Pacto)", "Practo"), "(Practo)");
});

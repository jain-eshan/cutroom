import { test } from "node:test";
import assert from "node:assert/strict";
import { wordAt, wordSlice } from "./transcript.ts";
import type { Word } from "./api.ts";

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

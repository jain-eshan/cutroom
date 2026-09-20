/**
 * The same cases as `server/tests/test_captions.py`, against the TypeScript
 * port the preview uses. Two implementations of one rule set; asserting both
 * against the same inputs is what keeps "the captions I saw" and "the
 * captions I got" the same sentence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptionCues, cueAt } from "./captions.ts";
import type { Word } from "./api.ts";

const word = (text: string, start: number, end: number): Word => ({ text, start, end });

test("a short phrase becomes one cue", () => {
	const cues = buildCaptionCues([word("hello", 0, 0.3), word("there", 0.3, 0.6)]);
	assert.deepEqual(cues, [{ start: 0, end: 0.6, text: "hello there" }]);
});

test("a long pause breaks the cue", () => {
	const cues = buildCaptionCues([word("hello", 0, 0.3), word("there", 5, 5.3)], undefined, undefined, 0.6);
	assert.deepEqual(
		cues.map((c) => c.text),
		["hello", "there"],
	);
});

test("a line that gets too long breaks", () => {
	const words = ["one", "two", "three", "four", "five", "six", "seven", "eight"].map((w, i) =>
		word(w, i * 0.3, i * 0.3 + 0.2),
	);
	const cues = buildCaptionCues(words, 15);
	assert.ok(cues.length > 1);
	for (const cue of cues) assert.ok(cue.text.length <= 15, `"${cue.text}" is ${cue.text.length} chars`);
});

test("a cue that would sit on screen too long breaks", () => {
	const words = Array.from({ length: 10 }, (_, i) => word("word", i, i + 0.5));
	const cues = buildCaptionCues(words, 1000, 3.0);
	assert.ok(cues.length > 1);
	for (const cue of cues) assert.ok(cue.end - cue.start <= 3.0 + 1e-6);
});

test("blank words are skipped rather than becoming gaps in the text", () => {
	const cues = buildCaptionCues([word("hello", 0, 0.3), word("  ", 0.3, 0.4), word("there", 0.4, 0.7)]);
	assert.deepEqual(
		cues.map((c) => c.text),
		["hello there"],
	);
});

test("no words gives no cues", () => {
	assert.deepEqual(buildCaptionCues([]), []);
});

test("braces are stripped, so the preview shows what the export shows", () => {
	// The export strips them because `{`/`}` delimit ASS override blocks. The
	// preview has no such constraint and strips them anyway: showing a brace
	// the burned-in caption won't have is the same bug in the other direction.
	assert.equal(buildCaptionCues([word("{hi}", 0, 0.3)])[0].text, "hi");
});

test("cueAt finds the cue on screen, and nothing between cues", () => {
	const cues = buildCaptionCues([word("hello", 0, 0.3), word("there", 5, 5.3)], undefined, undefined, 0.6);
	assert.equal(cueAt(cues, 0.1)?.text, "hello");
	assert.equal(cueAt(cues, 5.2)?.text, "there");
	// The gap between them is silence; a caption left hanging there would be
	// on screen while nobody is speaking.
	assert.equal(cueAt(cues, 2.5), null);
	assert.equal(cueAt(cues, 99), null);
});

test("cueAt treats a cue as inclusive of its start and exclusive of its end", () => {
	// Matters at a boundary: two cues that touch must never both be on screen.
	const cues = buildCaptionCues([word("aa", 0, 1), word("bb", 1, 2)], 2);
	assert.equal(cues.length, 2);
	assert.equal(cueAt(cues, 0)?.text, "aa");
	assert.equal(cueAt(cues, 1)?.text, "bb");
});

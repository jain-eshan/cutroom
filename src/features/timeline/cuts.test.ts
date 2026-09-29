import { test } from "node:test";
import assert from "node:assert/strict";
import { activeCuts, findCuts, isKept, remapTime, skipTo, totalCut, wordCuts, wordsLeft } from "./cuts.ts";

const word = (start: number, end: number, text: string) => ({ start, end, text });

test("a pause inside one person's answer is cut, not just gaps between people", () => {
	// One speaker, one turn, a 3-second pause in the middle of it -- what
	// cutting from turn boundaries never found.
	const speech = [
		{ start: 0, end: 10 },
		{ start: 13, end: 20 },
	];
	const cuts = findCuts(speech, [], 20, "most");
	assert.deepEqual(cuts, [{ start: 10.25, end: 12.75, kind: "pause" }]);
});

test("pauses shorter than the chosen strength stay", () => {
	const speech = [
		{ start: 0, end: 10 },
		{ start: 11.5, end: 20 },
	];
	assert.equal(findCuts(speech, [], 20, "long").length, 0);
	assert.equal(findCuts(speech, [], 20, "most").length, 1);
});

test("a short pause keeps a share of itself as air rather than all of it", () => {
	// 0.6s pause at the tight end: 0.25s of air each side would leave only
	// 0.1s to cut; capped at 35% per side it still loses 0.18s.
	const speech = [
		{ start: 0, end: 5 },
		{ start: 5.6, end: 9 },
	];
	const [cut] = findCuts(speech, [], 9, "tight");
	assert.ok(Math.abs(cut.start - 5.21) < 1e-9);
	assert.ok(Math.abs(cut.end - 5.39) < 1e-9);
});

test("silence before the first word and after the last is dead air too", () => {
	const cuts = findCuts([{ start: 4, end: 8 }], [], 12, "most");
	assert.deepEqual(
		cuts.map((c) => [c.start, c.end]),
		[
			[0.25, 3.75],
			[8.25, 11.75],
		],
	);
});

test("overlapping speech from two people is one stretch of talking", () => {
	const speech = [
		{ start: 0, end: 6 },
		{ start: 5, end: 9 },
	];
	assert.equal(findCuts(speech, [], 9, "tight").length, 0);
});

test("without measured speech, word timings stand in", () => {
	const words = [word(0, 0.4, "so"), word(0.5, 1, "yes"), word(4, 4.5, "right")];
	assert.deepEqual(
		findCuts(undefined, words, 4.5, "most").map((c) => [c.start, c.end]),
		[[1.25, 3.75]],
	);
});

test("standalone filler words are cut, words that are only sometimes filler are not", () => {
	const words = [word(1, 1.3, "Um,"), word(1.4, 1.7, "like"), word(1.8, 2, "uh")];
	const cuts = findCuts([{ start: 0, end: 3 }], words, 3, "long").filter((c) => c.kind === "filler");
	assert.equal(cuts.length, 2);
	assert.ok(Math.abs(cuts[0].start - 0.95) < 1e-9);
});

test("a cut put back stays put back when the strength changes its edges", () => {
	const speech = [
		{ start: 0, end: 10 },
		{ start: 13, end: 20 },
	];
	const kept = [11.5];
	const most = findCuts(speech, [], 20, "most");
	const tight = findCuts(speech, [], 20, "tight");
	assert.ok(isKept(most[0], kept));
	assert.ok(isKept(tight[0], kept));
	assert.deepEqual(activeCuts(most, kept), []);
});

test("a filler at the edge of a pause becomes one cut for the export", () => {
	const speech = [
		{ start: 0, end: 10.4 },
		{ start: 14, end: 20 },
	];
	const words = [word(10, 10.4, "um")];
	const drops = activeCuts(findCuts(speech, words, 20, "most"), []);
	assert.equal(drops.length, 1);
	assert.ok(Math.abs(drops[0].start - 9.95) < 1e-9);
});

test("times after a cut move earlier by what was cut before them", () => {
	const drops = [
		{ start: 2, end: 4 },
		{ start: 10, end: 11 },
	];
	assert.equal(remapTime(1, drops), 1);
	assert.equal(remapTime(3, drops), 2);
	assert.equal(remapTime(12, drops), 9);
	assert.equal(totalCut(drops), 3);
});

test("playback inside a cut jumps to its end", () => {
	const drops = [{ start: 2, end: 4 }];
	assert.equal(skipTo(3, drops), 4);
	assert.equal(skipTo(4, drops), null);
	assert.equal(skipTo(1, drops), null);
});

// --- Words struck out of the transcript ------------------------------------

/** "we went there and it was great", one word a second, 0.2s between words
 * except a 1s pause before "and". */
const SENTENCE = [
	word(0, 0.8, "we"),
	word(1, 1.8, "went"),
	word(2, 2.8, "there."),
	word(3.8, 4.6, "and"),
	word(4.8, 5.6, "it"),
	word(5.8, 6.6, "was"),
	word(6.8, 7.6, "great."),
];

test("a run of struck-out words is one cut, reaching halfway into the gap either side at most", () => {
	// "it was": 0.2s gaps either side, so 0.1s of each.
	const cuts = wordCuts(SENTENCE, [4, 5]);
	assert.equal(cuts.length, 1);
	assert.ok(Math.abs(cuts[0].start - 4.7) < 1e-9 && Math.abs(cuts[0].end - 6.7) < 1e-9, `${cuts[0].start}-${cuts[0].end}`);
	assert.equal(cuts[0].kind, "words");
});

test("a struck-out word after a long pause takes a breath of it, not the whole pause", () => {
	const [cut] = wordCuts(SENTENCE, [3]); // "and", 1s of silence before it
	assert.ok(Math.abs(cut.start - 3.65) < 1e-9, `${cut.start}`);
});

test("words struck out apart are separate cuts, and duplicates or unknown indices change nothing", () => {
	assert.equal(wordCuts(SENTENCE, [0, 6, 6, 42]).length, 2);
	assert.deepEqual(wordCuts(SENTENCE, []), []);
});

test("the first word of the episode can't be cut from before zero", () => {
	assert.equal(wordCuts(SENTENCE, [0])[0].start, 0);
});

test("struck-out words are cut whatever was put back from the dead-air trim", () => {
	const struck = wordCuts(SENTENCE, [4]);
	const pause = { start: 2.9, end: 3.7, kind: "pause" as const };
	// The pause was put back; the struck word still goes.
	const drops = activeCuts([pause], [3.3], struck);
	assert.equal(drops.length, 1);
	assert.ok(drops[0].start > 4 && drops[0].end < 6);
});

test("captions leave out the words that were cut", () => {
	const drops = activeCuts([], [], wordCuts(SENTENCE, [4, 5]));
	assert.deepEqual(
		wordsLeft(SENTENCE, drops).map((w) => w.text),
		["we", "went", "there.", "and", "great."],
	);
});

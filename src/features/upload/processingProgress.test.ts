import { test } from "node:test";
import assert from "node:assert/strict";
import { ESTIMATE_FLOOR, overallProgress, remainingLabel } from "./processingProgress.ts";

test("upload alone counts for a third of the job, not a quarter of one stage among four", () => {
	assert.equal(overallProgress(1, undefined, undefined, undefined), 1 / 3);
});

test("transcribe and faces are treated as one concurrent phase, not summed", () => {
	// Faces finishes early, transcribe is still the long pole -- the wall
	// clock has only moved as far as transcribe has, not their average.
	const transcribe = { fraction: 0.5, done: false };
	const faces = { fraction: 0.1, done: true }; // done, so counts as 1 regardless of fraction
	assert.equal(overallProgress(1, transcribe, faces, undefined), (1 + 1 + 0) / 3);
});

test("a slow transcribe with faces still running is not hidden by an early faces finish", () => {
	const transcribe = { fraction: 0.5, done: false };
	const faces = { fraction: 0.1, done: false };
	assert.equal(overallProgress(1, transcribe, faces, undefined), (1 + 0.5 + 0) / 3);
});

test("match only starts counting once transcribe and faces are both done in practice, but the formula itself just takes what it's given", () => {
	const done = { fraction: 1, done: true };
	assert.equal(overallProgress(1, done, done, { fraction: 0.4, done: false }), (1 + 1 + 0.4) / 3);
});

test("a finished job is fully done", () => {
	const done = { fraction: 1, done: true };
	assert.equal(overallProgress(1, done, done, done), 1);
});

test("no estimate below the noise floor", () => {
	assert.equal(remainingLabel(10, ESTIMATE_FLOOR - 0.001), null);
});

test("no estimate once finished -- there's nothing left to predict", () => {
	assert.equal(remainingLabel(100, 1), null);
});

test("extrapolates linearly from elapsed time and how far along the job is", () => {
	// A fifth of the way in after 10s implies 40s left.
	assert.equal(remainingLabel(10, 0.2), "under a minute left");
	// A tenth of the way in after 600s implies 5400s (90 min) left.
	assert.equal(remainingLabel(600, 0.1), "about 90 min left");
});

test("under a minute reads as such rather than '0 min left'", () => {
	assert.equal(remainingLabel(10, 0.5), "under a minute left");
});

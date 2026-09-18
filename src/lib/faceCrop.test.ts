import { test } from "node:test";
import assert from "node:assert/strict";
import { bboxAtTime, isVisibleAt, personCrop } from "./faceCrop.ts";
import type { Person } from "./api.ts";

const FRAME_W = 1920;
const FRAME_H = 1080;
const BBOX = { x: 900, y: 400, width: 80, height: 110 };

test("a crop with no nudge is centred on the face horizontally", () => {
	const crop = personCrop(BBOX, FRAME_W, FRAME_H, FRAME_W, FRAME_H);
	const faceCx = BBOX.x + BBOX.width / 2;
	assert.ok(Math.abs(crop.x + crop.width / 2 - faceCx) < 1e-6);
});

test("a positive x nudge shifts the crop right by that fraction of its own width", () => {
	const plain = personCrop(BBOX, FRAME_W, FRAME_H, FRAME_W, FRAME_H);
	const nudged = personCrop(BBOX, FRAME_W, FRAME_H, FRAME_W, FRAME_H, undefined, { x: 0.1, y: 0 });
	assert.ok(Math.abs(nudged.x - plain.x - 0.1 * plain.width) < 1e-6);
	// Only x moved -- a nudge on one axis shouldn't touch the other, or the
	// crop's size.
	assert.equal(nudged.y, plain.y);
	assert.equal(nudged.width, plain.width);
	assert.equal(nudged.height, plain.height);
});

test("a nudge can't push the crop off the source frame", () => {
	// A face right at the edge, nudged further toward it: the clamp has to win.
	const edgeBbox = { x: 0, y: 0, width: 80, height: 110 };
	const nudged = personCrop(edgeBbox, FRAME_W, FRAME_H, FRAME_W, FRAME_H, undefined, { x: -1, y: -1 });
	assert.ok(nudged.x >= 0);
	assert.ok(nudged.y >= 0);
});

test("bboxAtTime picks the nearest keyframe, no interpolation", () => {
	const person: Person = {
		id: 0,
		thumbnail: "",
		detectionCount: 2,
		keyframes: [
			{ t: 0, bbox: { x: 0, y: 0, width: 10, height: 10 } },
			{ t: 10, bbox: { x: 100, y: 100, width: 10, height: 10 } },
		],
	};
	assert.deepEqual(bboxAtTime(person, 3), person.keyframes[0].bbox);
	assert.deepEqual(bboxAtTime(person, 8), person.keyframes[1].bbox);
});

test("a person with no keyframes raises a clear error rather than crashing on undefined", () => {
	const person: Person = { id: 3, thumbnail: "", detectionCount: 0, keyframes: [] };
	assert.throws(() => bboxAtTime(person, 5), /person 3 has no keyframes/);
});

// EDGE_CASES.md B7: bboxAtTime finds the nearest keyframe however far away
// it is, which used to mean a close-up could show an empty chair for
// someone who left minutes ago. isVisibleAt is the check regions.ts's
// resolveFraming now runs first.
test("isVisibleAt is true right at a keyframe, and within the visibility window either side", () => {
	const person: Person = {
		id: 0,
		thumbnail: "",
		detectionCount: 1,
		keyframes: [{ t: 10, bbox: { x: 0, y: 0, width: 10, height: 10 } }],
	};
	assert.ok(isVisibleAt(person, 10));
	assert.ok(isVisibleAt(person, 8), "2s before, still within the window");
	assert.ok(isVisibleAt(person, 12), "2s after, still within the window");
});

test("isVisibleAt is false once the nearest sighting is further away than the window", () => {
	const person: Person = {
		id: 0,
		thumbnail: "",
		detectionCount: 1,
		keyframes: [{ t: 10, bbox: { x: 0, y: 0, width: 10, height: 10 } }],
	};
	assert.equal(isVisibleAt(person, 7), false);
	assert.equal(isVisibleAt(person, 13), false);
});

test("isVisibleAt is false for a person with no keyframes at all", () => {
	const person: Person = { id: 0, thumbnail: "", detectionCount: 0, keyframes: [] };
	assert.equal(isVisibleAt(person, 5), false);
});

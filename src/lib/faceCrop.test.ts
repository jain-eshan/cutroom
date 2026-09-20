import { test } from "node:test";
import assert from "node:assert/strict";
import { bboxAtTime, exportPanes, fitBox, isVisibleAt, personCrop } from "./faceCrop.ts";
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

// --- Pane geometry: the preview has to crop against the export's panes ---
//
// These numbers are the ones `_segment_filter` in server/pipeline/render.py
// computes, restated here as literals rather than recomputed from the same
// formula -- a test that re-derives the answer the same way the code does
// cannot catch the code being wrong. `server/tests/test_render.py` asserts
// the same literals from the Python side, so drift on either side fails a
// test on that side.

test("one person renders into the whole frame", () => {
	assert.deepEqual(exportPanes(1, FRAME_W, FRAME_H), [{ width: 1920, height: 1080 }]);
});

test("two people split the frame into equal columns", () => {
	assert.deepEqual(exportPanes(2, FRAME_W, FRAME_H), [
		{ width: 960, height: 1080 },
		{ width: 960, height: 1080 },
	]);
});

test("three people get the speaker-focus layout, sides stacked", () => {
	// side_w = 1920 - int(1920 * 0.68) = 1920 - 1305 = 615
	// side_h = 1080 // 2 = 540; column_h = 540 * 2 = 1080
	assert.deepEqual(exportPanes(3, FRAME_W, FRAME_H), [
		{ width: 1305, height: 1080 },
		{ width: 615, height: 540 },
		{ width: 615, height: 540 },
	]);
});

test("four people: the side column's height rounds down so the panes stack exactly", () => {
	// side_h = 1080 // 3 = 360, and 360 * 3 == 1080 exactly here.
	const panes = exportPanes(4, FRAME_W, FRAME_H);
	assert.deepEqual(panes[0], { width: 1305, height: 1080 });
	assert.deepEqual(panes.slice(1), [
		{ width: 615, height: 360 },
		{ width: 615, height: 360 },
		{ width: 615, height: 360 },
	]);
	// The main pane must equal the stacked total, or ffmpeg's hstack refuses.
	assert.equal(
		panes[0].height,
		panes.slice(1).reduce((total, p) => total + p.height, 0),
	);
});

test("a frame height that doesn't divide evenly still stacks exactly", () => {
	// 1079 // 3 = 359, so the column is 1077 tall, not 1079.
	const panes = exportPanes(4, FRAME_W, 1079);
	assert.equal(panes[0].height, 1077);
	assert.equal(
		panes[0].height,
		panes.slice(1).reduce((total, p) => total + p.height, 0),
	);
});

test("the crop depends on the pane it renders into, not the window", () => {
	// The regression this pair exists for: the preview used to pass its own
	// on-screen pane size to personCrop. A stage stretched wider than the
	// source gave a wider crop than ffmpeg produces, so what the editor
	// framed was not what rendered.
	const exportCrop = personCrop(BBOX, FRAME_W, FRAME_H, FRAME_W, FRAME_H);
	const onScreenCrop = personCrop(BBOX, FRAME_W, FRAME_H, 1100, 540);
	assert.notDeepEqual(exportCrop, onScreenCrop);

	// Passing the export's pane gives the export's crop at any window size.
	const [pane] = exportPanes(1, FRAME_W, FRAME_H);
	assert.deepEqual(personCrop(BBOX, FRAME_W, FRAME_H, pane.width, pane.height), exportCrop);
});

test("fitBox keeps the aspect ratio and touches the limiting edge", () => {
	// Wider box than the video: height fills, width is letterboxed.
	const wide = fitBox(16 / 9, 1000, 400);
	assert.equal(wide.height, 400);
	assert.ok(Math.abs(wide.width / wide.height - 16 / 9) < 1e-9);
	assert.ok(wide.width <= 1000);

	// Taller box: width fills instead.
	const tall = fitBox(16 / 9, 800, 900);
	assert.equal(tall.width, 800);
	assert.ok(Math.abs(tall.width / tall.height - 16 / 9) < 1e-9);
	assert.ok(tall.height <= 900);
});

test("fitBox returns nothing to draw before the container has been measured", () => {
	assert.deepEqual(fitBox(16 / 9, 0, 0), { width: 0, height: 0 });
	// An audio-only file reports a 0x0 frame, so the aspect is NaN.
	assert.deepEqual(fitBox(NaN, 800, 600), { width: 0, height: 0 });
});

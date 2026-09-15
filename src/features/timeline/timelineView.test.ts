import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MIN_VIEW_S,
	clampView,
	formatTimecode,
	reveal,
	rulerStep,
	snapTime,
	stepToEdge,
	zoomView,
} from "./timelineView.ts";

// The 47-minute recording the editor was measured against.
const EPISODE = 2816;

test("a view can't run past either end of the episode", () => {
	assert.deepEqual(clampView(-30, 60, EPISODE), { start: 0, end: 60 });
	assert.deepEqual(clampView(2800, 60, EPISODE), { start: 2756, end: EPISODE });
});

test("a view can't zoom in past the minimum or out past the whole episode", () => {
	assert.equal(clampView(100, 0.1, EPISODE).end - 100, MIN_VIEW_S);
	assert.deepEqual(clampView(100, 99_999, EPISODE), { start: 0, end: EPISODE });
});

test("zooming keeps the anchor under the same spot on screen", () => {
	const view = { start: 1000, end: 1100 };
	const zoomed = zoomView(view, 0.5, 1025, EPISODE);
	assert.equal(zoomed.end - zoomed.start, 50);
	// 1025 was a quarter of the way across, and still is.
	assert.equal((1025 - zoomed.start) / (zoomed.end - zoomed.start), 0.25);
});

test("zooming out from the whole episode stays on the whole episode", () => {
	assert.deepEqual(zoomView({ start: 0, end: EPISODE }, 2, 1400, EPISODE), { start: 0, end: EPISODE });
});

test("revealing a moment already on screen leaves the view alone", () => {
	const view = { start: 100, end: 200 };
	assert.equal(reveal(view, 150, EPISODE), view);
});

test("revealing a moment off screen pages to it with a short lead-in", () => {
	assert.deepEqual(reveal({ start: 100, end: 200 }, 500, EPISODE), { start: 490, end: 590 });
});

test("ruler labels on the whole episode are minutes apart", () => {
	// 2,816 seconds across a 1,250px timeline.
	assert.deepEqual(rulerStep(EPISODE / 1250), { major: 300, minor: 60 });
});

test("zoomed right in, the ruler is labelled every half second", () => {
	assert.deepEqual(rulerStep(MIN_VIEW_S / 1250), { major: 0.5, minor: 0.1 });
});

test("every ruler step's labels are a whole number of ticks apart", () => {
	for (let px = 0.0001; px < 100; px *= 1.7) {
		const { major, minor } = rulerStep(px);
		assert.equal(Math.abs(major / minor - Math.round(major / minor)) < 1e-9, true);
	}
});

test("timecodes", () => {
	assert.equal(formatTimecode(0), "0:00");
	assert.equal(formatTimecode(2816), "46:56");
	assert.equal(formatTimecode(3725), "1:02:05");
	assert.equal(formatTimecode(723.46, true), "12:03.4");
	assert.equal(formatTimecode(3.05, true), "0:03.0");
});

test("an edge snaps to the nearest boundary within reach", () => {
	const words = [10, 10.4, 11.2, 12];
	assert.equal(snapTime(10.3, words, 0.2), 10.4);
	assert.equal(snapTime(11.1, words, 0.2), 11.2);
});

test("an edge with nothing in reach stays where it was dropped", () => {
	assert.equal(snapTime(10.8, [10, 10.4, 11.2, 12], 0.2), 10.8);
});

test("snapping past the first or last boundary still works", () => {
	assert.equal(snapTime(9.9, [10, 12], 0.2), 10);
	assert.equal(snapTime(12.1, [10, 12], 0.2), 12);
	assert.equal(snapTime(5, [], 0.2), 5);
});

test("stepping between shots finds the next and previous edge", () => {
	const edges = [0, 12, 30, 45, EPISODE];
	assert.equal(stepToEdge(edges, 20, 1), 30);
	assert.equal(stepToEdge(edges, 20, -1), 12);
});

test("a playhead parked on an edge steps past it, not onto it again", () => {
	const edges = [0, 12, 30];
	assert.equal(stepToEdge(edges, 12, 1), 30);
	assert.equal(stepToEdge(edges, 12.01, -1), 0);
	assert.equal(stepToEdge(edges, 30, 1), undefined);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { addRegion, regionAt, resizeRegion, splitRegion, wideGaps } from "./regions.ts";
import type { FramingRegion } from "./types.ts";

const EPISODE = 600;

function region(overrides: Partial<FramingRegion> = {}): FramingRegion {
	return {
		id: "r1",
		start: 10,
		end: 20,
		layout: "zoom",
		personIds: [0],
		source: "suggested",
		...overrides,
	};
}

test("regionAt finds the region covering a moment, or null for wide", () => {
	const regions = [region({ id: "a", start: 0, end: 10 }), region({ id: "b", start: 10, end: 20 })];
	assert.equal(regionAt(regions, 5)?.id, "a");
	assert.equal(regionAt(regions, 10)?.id, "b"); // end-exclusive on the earlier one
	assert.equal(regionAt(regions, 25), null);
});

test("adding a region clears whatever it lands on top of", () => {
	const before = [region({ id: "a", start: 0, end: 30 })];
	const after = addRegion(before, 10, 20, "split", [0, 1]);
	// The new region, plus what's left of the old one on either side of it.
	const sorted = [...after].sort((a, b) => a.start - b.start);
	assert.deepEqual(
		sorted.map((r) => [r.start, r.end]),
		[
			[0, 10],
			[10, 20],
			[20, 30],
		],
	);
	assert.equal(sorted[1].source, "user");
});

test("resizing an edge overwrites a neighbour it's dragged over, rather than stopping at it", () => {
	const before = [region({ id: "a", start: 0, end: 10 }), region({ id: "b", start: 10, end: 20 })];
	const after = resizeRegion(before, "a", "end", 15, EPISODE);
	assert.equal(after.find((r) => r.id === "a")?.end, 15);
	// b's start moved out from under a, rather than blocking the resize.
	assert.equal(after.find((r) => r.id === "b")?.start, 15);
});

test("resizing can't cross a region's own other edge", () => {
	const before = [region({ id: "a", start: 10, end: 20 })];
	const after = resizeRegion(before, "a", "end", 5, EPISODE);
	assert.ok(after[0].end > after[0].start);
});

test("wideGaps covers the stretches no region touches", () => {
	const regions = [region({ id: "a", start: 10, end: 20 }), region({ id: "b", start: 25, end: 30 })];
	assert.deepEqual(wideGaps(regions, 40), [
		{ start: 0, end: 10 },
		{ start: 20, end: 25 },
		{ start: 30, end: 40 },
	]);
});

test("splitting a region produces two shots meeting at the split point, same layout and people", () => {
	const before = [region({ id: "a", start: 10, end: 20, layout: "split", personIds: [0, 1] })];
	const after = splitRegion(before, "a", 14);
	const sorted = [...after].sort((x, y) => x.start - y.start);
	assert.equal(sorted.length, 2);
	assert.equal(sorted[0].id, "a"); // the first half keeps the id a selection is holding
	assert.deepEqual([sorted[0].start, sorted[0].end], [10, 14]);
	assert.deepEqual([sorted[1].start, sorted[1].end], [14, 20]);
	for (const r of sorted) {
		assert.equal(r.layout, "split");
		assert.deepEqual(r.personIds, [0, 1]);
		assert.equal(r.source, "user");
	}
});

test("splitting too close to either edge is a no-op -- there's nothing useful to cut off", () => {
	const before = [region({ id: "a", start: 10, end: 20 })];
	assert.equal(splitRegion(before, "a", 10.1), before);
	assert.equal(splitRegion(before, "a", 19.9), before);
});

test("splitting at a point outside the region, or a region that doesn't exist, is a no-op", () => {
	const before = [region({ id: "a", start: 10, end: 20 })];
	assert.equal(splitRegion(before, "a", 25), before);
	assert.equal(splitRegion(before, "nope", 15), before);
});

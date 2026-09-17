import { test } from "node:test";
import assert from "node:assert/strict";
import { addRegion, regionAt, resizeRegion, splitRegion, suggestRegions, wideGaps } from "./regions.ts";
import type { FramingRegion } from "./types.ts";
import type { Turn } from "../../lib/api.ts";

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

// --- Shot rules (EDGE_CASES.md section 2) --------------------------------
//
// The table in EDGE_CASES.md section 1 is the founder's reported case, written
// out as a conversation. These run it through suggestRegions and check the
// shots that come out, the way section 5 asks for.

/** A and B are speakers 0 and 1, mapped to persons 10 and 11; C is speaker 2
 * as person 12. */
const CAST = { 0: 10, 1: 11, 2: 12 };

function turn(speaker: number, start: number, end: number, text = "a real contribution here"): Turn {
	return { speaker, start, end, text };
}

test("a one-word interjection doesn't take the shot from whoever is holding forth", () => {
	// A talks, C says "right", A carries on. EDGE_CASES.md A2.
	const turns = [
		turn(0, 0, 20),
		turn(2, 20.3, 20.9, "right"),
		turn(0, 21, 40),
	];
	const regions = suggestRegions(turns, [], CAST);
	assert.equal(regions.length, 1, "one held shot, not three shots and two wide flashes");
	assert.deepEqual(regions[0].personIds, [10]);
	assert.deepEqual([regions[0].start, regions[0].end], [0, 40]);
});

test("a hand-off between speakers doesn't flash wide in the gap", () => {
	// EDGE_CASES.md A11: any gap used to render wide, even a 0.5s one.
	const turns = [turn(0, 0, 20), turn(1, 20.5, 40)];
	const regions = suggestRegions(turns, [], CAST);
	assert.equal(regions.length, 2);
	assert.equal(regions[0].end, regions[1].start, "the outgoing shot holds until the next one starts");
	assert.equal(wideGaps(regions, 40).length, 0);
});

test("a real silence still goes wide", () => {
	// Rule 6 only holds through hand-offs, not through someone leaving the room.
	const turns = [turn(0, 0, 20), turn(1, 30, 50)];
	const regions = suggestRegions(turns, [], CAST);
	assert.deepEqual(
		wideGaps(regions, 50).map((g) => [g.start, g.end]),
		[[20, 30]],
	);
});

test("a short line in a clean gap doesn't earn a shot", () => {
	// Nobody holds the floor across it, so length decides: under the cutoff.
	const turns = [turn(0, 0, 20), turn(1, 21, 22.5, "I agree with that"), turn(2, 30, 50)];
	const regions = suggestRegions(turns, [], CAST);
	assert.ok(
		regions.every((r) => !r.personIds.includes(11)),
		"the 1.5s line gets no shot of its own",
	);
});

test("a line long enough to say something does earn a shot", () => {
	const turns = [turn(0, 0, 20), turn(1, 21, 30), turn(2, 40, 60)];
	const regions = suggestRegions(turns, [], CAST);
	assert.ok(regions.some((r) => r.personIds.includes(11)));
});

test("a long line still loses the shot if the other speaker was holding the floor and carried on", () => {
	// The product call: the floor comes first, length second. B talks for 6s,
	// but A was already going and then runs for another 30.
	const turns = [turn(0, 0, 20), turn(1, 20.5, 26.5), turn(0, 27, 57)];
	const regions = suggestRegions(turns, [], CAST);
	assert.equal(regions.length, 1);
	assert.deepEqual(regions[0].personIds, [10]);
});

test("the floor changes hands when the interruption outlasts the resumption", () => {
	// Same shape, but B talks for 30s and A only manages 3 afterwards -- B took
	// the floor, so B gets the shot.
	const turns = [turn(0, 0, 20), turn(1, 20.5, 50.5), turn(0, 51, 54)];
	const regions = suggestRegions(turns, [], CAST);
	assert.ok(regions.some((r) => r.personIds.includes(11)));
});

test("a line that is only acknowledgement earns no shot however long it runs", () => {
	const turns = [turn(0, 0, 20), turn(1, 25, 35, "yeah yeah right okay"), turn(2, 40, 60)];
	const regions = suggestRegions(turns, [], CAST);
	assert.ok(regions.every((r) => !r.personIds.includes(11)));
});

test("a short answer that means something is not treated as acknowledgement", () => {
	// "No." is a real answer -- the document makes this exact point.
	const turns = [turn(0, 0, 20), turn(1, 25, 35, "No."), turn(2, 40, 60)];
	const regions = suggestRegions(turns, [], CAST);
	assert.ok(regions.some((r) => r.personIds.includes(11)));
});

test("talking over each other still wins over a held shot", () => {
	const turns = [turn(0, 0, 20), turn(1, 20.5, 40)];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1] }];
	const regions = suggestRegions(turns, overlaps, CAST);
	const split = regions.find((r) => r.layout === "split");
	assert.ok(split, "the overlap window is still a both-on-screen shot");
	assert.deepEqual([split.start, split.end], [19, 21]);
});

test("the founder's case: four cuts around one word become none", () => {
	// The table from EDGE_CASES.md section 1, end to end.
	const turns = [
		turn(0, 0, 20),
		turn(2, 20.3, 20.9, "right"),
		turn(0, 21, 40),
		turn(1, 40.5, 55),
		turn(1, 57, 60),
		turn(1, 62.5, 70),
	];
	const regions = suggestRegions(turns, [], CAST);
	// A holds 0-40, then B from 40.5 to the end: two shots, one cut.
	assert.equal(regions.length, 2);
	assert.deepEqual(regions[0].personIds, [10]);
	assert.deepEqual(regions[1].personIds, [11]);
	assert.equal(wideGaps(regions, 70).length, 0, "no wide flashes anywhere");
});

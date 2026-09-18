import { test } from "node:test";
import assert from "node:assert/strict";
import {
	addRegion,
	orderBySeat,
	reconcileWithStyle,
	regionAt,
	resizeRegion,
	resolveFraming,
	splitRegion,
	suggestRegions,
	wideGaps,
} from "./regions.ts";
import type { FramingRegion } from "./types.ts";
import type { Person, Turn } from "../../lib/api.ts";

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

function personAt(id: number, x: number): Person {
	return { id, thumbnail: "", detectionCount: 1, keyframes: [{ t: 0, bbox: { x, y: 0, width: 10, height: 10 } }] };
}

/** Seated left to right in id order -- 10, then 11, then 12 -- so any test
 * that doesn't care about seating can ignore it, and one that does can flip
 * the expectation to prove ordering isn't just coincidentally matching id
 * order. */
const PEOPLE = [personAt(10, 0), personAt(11, 100), personAt(12, 200)];

test("a one-word interjection doesn't take the shot from whoever is holding forth", () => {
	// A talks, C says "right", A carries on. EDGE_CASES.md A2.
	const turns = [
		turn(0, 0, 20),
		turn(2, 20.3, 20.9, "right"),
		turn(0, 21, 40),
	];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 1, "one held shot, not three shots and two wide flashes");
	assert.deepEqual(regions[0].personIds, [10]);
	assert.deepEqual([regions[0].start, regions[0].end], [0, 40]);
});

test("a hand-off between speakers doesn't flash wide in the gap", () => {
	// EDGE_CASES.md A11: any gap used to render wide, even a 0.5s one.
	const turns = [turn(0, 0, 20), turn(1, 20.5, 40)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 2);
	assert.equal(regions[0].end, regions[1].start, "the outgoing shot holds until the next one starts");
	assert.equal(wideGaps(regions, 40).length, 0);
});

test("a real silence still goes wide", () => {
	// Rule 6 only holds through hand-offs, not through someone leaving the room.
	const turns = [turn(0, 0, 20), turn(1, 30, 50)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.deepEqual(
		wideGaps(regions, 50).map((g) => [g.start, g.end]),
		[[20, 30]],
	);
});

test("an off-camera voice holds the current shot rather than cutting to wide", () => {
	// EDGE_CASES.md B3, decided 2026-09-18: hold, not wide -- cutting wide for
	// an off-camera question reads as a mistake. Speaker 9 has no entry in
	// CAST, the same as a producer or phone-in guest nobody ever saw on camera.
	const turns = [turn(0, 0, 5), turn(9, 5, 9, "an off camera question here"), turn(0, 9, 14)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 1, "one held shot straight through the off-camera line, not three with a wide gap");
	assert.deepEqual(regions[0].personIds, [10]);
	assert.deepEqual([regions[0].start, regions[0].end], [0, 14]);
});

test("an off-camera voice still cedes to a real silence around it", () => {
	// Holding through a hand-off (B3) is rule 6's existing behaviour, not a
	// special case for off-camera speakers -- a genuine gap still goes wide.
	const turns = [turn(0, 0, 5), turn(9, 9, 13, "an off camera question here"), turn(0, 17, 22)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 2);
	assert.deepEqual(
		wideGaps(regions, 22).map((g) => [g.start, g.end]),
		[[5, 17]],
	);
});

test("an off-camera voice at the very start of the episode is wide, with nothing to hold", () => {
	const turns = [turn(9, 0, 5, "an off camera question opens the show"), turn(0, 5, 12)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 1);
	assert.deepEqual([regions[0].start, regions[0].end], [5, 12]);
	assert.deepEqual(wideGaps(regions, 12), [{ start: 0, end: 5 }]);
});

test("a short line in a clean gap doesn't earn a shot", () => {
	// Nobody holds the floor across it, so length decides: under the cutoff.
	const turns = [turn(0, 0, 20), turn(1, 21, 22.5, "I agree with that"), turn(2, 30, 50)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.ok(
		regions.every((r) => !r.personIds.includes(11)),
		"the 1.5s line gets no shot of its own",
	);
});

test("a line long enough to say something does earn a shot", () => {
	const turns = [turn(0, 0, 20), turn(1, 21, 30), turn(2, 40, 60)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.ok(regions.some((r) => r.personIds.includes(11)));
});

test("a long line still loses the shot if the other speaker was holding the floor and carried on", () => {
	// The product call: the floor comes first, length second. B talks for 6s,
	// but A was already going and then runs for another 30.
	const turns = [turn(0, 0, 20), turn(1, 20.5, 26.5), turn(0, 27, 57)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 1);
	assert.deepEqual(regions[0].personIds, [10]);
});

test("the floor changes hands when the interruption outlasts the resumption", () => {
	// Same shape, but B talks for 30s and A only manages 3 afterwards -- B took
	// the floor, so B gets the shot.
	const turns = [turn(0, 0, 20), turn(1, 20.5, 50.5), turn(0, 51, 54)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.ok(regions.some((r) => r.personIds.includes(11)));
});

test("a line that is only acknowledgement earns no shot however long it runs", () => {
	const turns = [turn(0, 0, 20), turn(1, 25, 35, "yeah yeah right okay"), turn(2, 40, 60)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.ok(regions.every((r) => !r.personIds.includes(11)));
});

test("a short answer that means something is not treated as acknowledgement", () => {
	// "No." is a real answer -- the document makes this exact point.
	const turns = [turn(0, 0, 20), turn(1, 25, 35, "No."), turn(2, 40, 60)];
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	assert.ok(regions.some((r) => r.personIds.includes(11)));
});

test("a genuine, ongoing overlap still wins over a held shot -- when it isn't a clean handoff", () => {
	// B's own turn after the overlap (19.5-20.5, one second) is too short to
	// earn a shot on its own -- this is A4's brief double-talk, not A5's
	// takeover -- so the composite still shows, same as before rule 4.
	const turns = [turn(0, 0, 20), turn(1, 19.5, 20.5)];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	const split = regions.find((r) => r.layout === "split");
	assert.ok(split, "the overlap window is still a both-on-screen shot");
	assert.deepEqual([split.start, split.end], [19, 21]);
});

// --- Rule 3/A3: a brief interjection doesn't earn a composite ---

test("a brief interjection during someone else's turn doesn't flash a composite (A3, rule 3)", () => {
	// C interjects for 1.2s while B is mid-turn -- under rule 3's ~2s
	// threshold, so B just keeps the shot. Before this, any overlap past
	// MIN_REGION_S (0.25s) got a composite, which is exactly what A3
	// describes as wrong ("all three on screen if the line overlaps for 1s
	// or more").
	const turns = [turn(0, 0, 10), turn(1, 10, 25), turn(2, 15, 16.2, "not backchannel at all")];
	const overlaps = [{ start: 15, end: 16.2, speakers: [1, 2] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	assert.ok(
		regions.every((r) => r.layout !== "split"),
		"no composite for a 1.2s interjection",
	);
	const holding = regions.find((r) => r.start <= 15.5 && 15.5 < r.end);
	assert.deepEqual(holding?.personIds, [11], "B (11) keeps the shot straight through the brief interjection");
});

test("an overlap right at the two-second threshold still earns a composite", () => {
	const turns = [turn(0, 0, 10), turn(1, 10, 25), turn(2, 15, 17, "still not backchannel words")];
	const overlaps = [{ start: 15, end: 17, speakers: [1, 2] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	const split = regions.find((r) => r.layout === "split");
	assert.ok(split, "exactly 2s clears the threshold");
	assert.deepEqual([split.start, split.end], [15, 17]);
});

// --- C3: four or more people at once suggests wide, not a composite ---

const PERSON_13 = personAt(13, 300);
const PEOPLE4 = [...PEOPLE, PERSON_13];
const CAST4 = { ...CAST, 3: 13 };

test("three people at once still gets the both-on-screen composite", () => {
	const turns = [turn(0, 0, 20), turn(1, 19.5, 20.5, "short")];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1, 2] }];
	const regions = suggestRegions(turns, overlaps, CAST4, PEOPLE4, "dynamic");
	const split = regions.find((r) => r.layout === "split");
	assert.ok(split, "three people is still a composite, not wide");
	assert.deepEqual(split.personIds, [10, 11, 12]);
});

test("four people at once suggests wide, not a wall of narrow panes", () => {
	// EDGE_CASES.md C3, decided 2026-09-18. Same shape as the three-person
	// case above, one more speaker in the overlap window.
	const turns = [turn(0, 0, 20), turn(1, 19.5, 20.5, "short")];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1, 2, 3] }];
	const regions = suggestRegions(turns, overlaps, CAST4, PEOPLE4, "dynamic");
	assert.ok(
		regions.every((r) => r.layout !== "split"),
		"no composite suggested for four people at once",
	);
	assert.deepEqual(
		wideGaps(regions, 21).map((g) => [g.start, g.end]),
		[[19, 21]],
		"the overlap window is a genuine hole, not silently absorbed into an adjacent close-up",
	);
});

test("an editor can still add a four-person composite by hand -- C3 only governs suggestions", () => {
	const regions = addRegion([], 19, 21, "split", [10, 11, 12, 13]);
	assert.equal(regions.length, 1);
	assert.equal(regions[0].layout, "split");
	assert.deepEqual(regions[0].personIds, [10, 11, 12, 13]);
});

// --- Rule 4: a takeover is one cut, not the composite (EDGE_CASES.md A5) --

test("a takeover -- B interrupts and keeps going -- is one cut to B, not a flash through both-on-screen", () => {
	// The exact shape EDGE_CASES.md section 1 and A5 describe: A talks, B
	// interrupts and keeps talking, A never comes back.
	const turns = [turn(0, 0, 20), turn(1, 19, 40)];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 2, "one cut: A's shot, then B's -- no third, composite shot in between");
	assert.equal(regions.filter((r) => r.layout === "split").length, 0, "no both-on-screen shot for a takeover");
	assert.deepEqual(regions[0].personIds, [10]);
	assert.deepEqual(regions[1].personIds, [11]);
});

test("a takeover cuts on the new speaker's first word -- where the overlap starts, not where the old turn's own words end", () => {
	// Product call, 2026-09-17: cut on B's first word. window.start (19) is
	// what stands in for that, and it lands before B's own transcribed turn
	// start (20) -- Whisper's word-level boundary and pyannote's overlap
	// detector don't have to agree to the frame.
	const turns = [turn(0, 0, 20), turn(1, 20, 40)];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 2);
	assert.equal(regions[0].end, 19, "A's shot ends where B's overlap-detected start is, not at 20");
	assert.equal(regions[1].start, 19, "B's shot starts there too -- the cut is at exactly one point");
});

test("a takeover never cuts later than the incoming turn's own transcribed start", () => {
	// Defensive direction on the Math.min: if the overlap detector's start
	// somehow lands after the turn's own start (the two signals disagreeing
	// the other way), the cut must not be pushed later than the turn itself
	// starts -- that would show the outgoing speaker a beat into what's
	// already B's turn.
	const turns = [turn(0, 0, 20), turn(1, 18, 40)];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1] }]; // starts after turns[1].start (18)
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	assert.equal(regions[0].end, 18);
	assert.equal(regions[1].start, 18);
});

test("a floor-held interjection is never mistaken for a takeover, even though a real overlap sits right where one would look for one", () => {
	// takeoverAt looks at the turn right after the overlap starts (B's brief
	// "yeah") to decide if the floor changed hands. It didn't: rule 1's own
	// floor-holding says B's interjection doesn't earn a shot of its own,
	// because A's resumption afterward is both longer and the real point of
	// the sentence -- earnsItsOwnShot is the single source of truth both
	// rules share, so takeoverAt can't disagree with it.
	//
	// The 2s overlap window is still real, detected audio, though, and A4
	// says exactly this length is enough to show both people even while A
	// keeps editorial "credit" for the line -- so the composite still
	// appears, splitting A's hold into two shots around it. That's A4
	// working correctly, not a bug: floor-holding decides who's *credited*
	// with the close-up, not whether the audio genuinely overlapped.
	const turns = [turn(0, 0, 20), turn(1, 19, 21, "yeah"), turn(0, 21, 45)];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	assert.equal(regions.length, 3, "A's hold, split around the genuine 2s overlap, then A's hold again");
	assert.deepEqual(
		regions.map((r) => r.layout),
		["zoom", "split", "zoom"],
	);
	assert.deepEqual(regions[1].personIds, [10, 11], "both shown for the real overlap, despite A holding the floor");
});

test("gentle's higher cutoff also governs whether an overlap counts as a takeover", () => {
	// B's post-overlap turn (9s) clears dynamic's 4s bar but not gentle's 12s
	// one -- so the same recording is a takeover under one style and a
	// genuine overlap under the other.
	const turns = [turn(0, 0, 20), turn(1, 19, 28)];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1] }];
	const dynamic = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	const gentle = suggestRegions(turns, overlaps, CAST, PEOPLE, "gentle");
	assert.equal(dynamic.filter((r) => r.layout === "split").length, 0, "dynamic: 9s clears its cutoff -- a takeover");
	assert.equal(gentle.filter((r) => r.layout === "split").length, 1, "gentle: 9s doesn't clear its cutoff -- not one");
});

// --- Rule 7: panes follow seating, not speaker or person id (EDGE_CASES.md C1) --

test("orderBySeat sorts by where people actually sit, not by id", () => {
	// 12 sits left of 10 in this fixture -- the opposite of id order -- so a
	// fix that happened to just sort ids ascending would still pass every
	// other test in this file without actually reading a seat position.
	const seatedRightToLeft = [personAt(10, 200), personAt(11, 100), personAt(12, 0)];
	assert.deepEqual(orderBySeat([10, 11, 12], seatedRightToLeft), [12, 11, 10]);
});

test("orderBySeat puts a person with no keyframes last, not first", () => {
	const neverLocated: Person = { id: 99, thumbnail: "", detectionCount: 0, keyframes: [] };
	assert.deepEqual(orderBySeat([99, 10], [...PEOPLE, neverLocated]), [10, 99]);
});

test("a both-on-screen shot orders its panes left to right by seat, regardless of the overlap window's own speaker order", () => {
	// The overlap window lists speaker 1 (person 11, seated middle) before
	// speaker 0 (person 10, seated left) -- the old code just mapped over
	// window.speakers in listed order, so this exact case used to put 11 in
	// the left pane. 10 sits left of 11, so 10 has to lead regardless.
	//
	// B's interjection (19-21) is deliberately too short to earn a shot on
	// its own, so this is a brief double-talk (A4), not a takeover (A5) --
	// see the takeover tests below for that case. Kept as a genuine
	// composite here on purpose, to isolate what this test is actually
	// about: pane order.
	const turns = [turn(0, 0, 20), turn(1, 19, 21)];
	const overlaps = [{ start: 19, end: 21, speakers: [1, 0] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	const split = regions.find((r) => r.layout === "split");
	assert.ok(split);
	assert.deepEqual(split.personIds, [10, 11], "10 sits left of 11, so 10 leads despite being listed second");
});

test("with three people, the large pane goes to whoever was already holding the floor (C2)", () => {
	// Person 12 sits rightmost but has been talking for 19s already when 10
	// and 11 join in for a genuine two-second overlap -- the large pane
	// (personIds[0]) has to be 12, not 10 just because 10 sits leftmost.
	const turns = [turn(2, 0, 21), turn(0, 19, 20.5, "brief"), turn(1, 19.2, 20.8, "brief")];
	const overlaps = [{ start: 19, end: 21, speakers: [0, 1, 2] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	const split = regions.find((r) => r.layout === "split");
	assert.ok(split);
	assert.deepEqual(split.personIds, [12, 10, 11], "12 holds the floor and leads; 10 and 11 keep seat order behind it");
});

test("with two people, there's no large pane to reassign -- seat order alone still governs", () => {
	// C2 only applies once a shot has a distinguished large pane, which
	// render.py only draws from three people up (DUO_SPLIT_MAX). This is the
	// same case as the seat-order test above, just confirming C2's holder
	// logic doesn't also fire here and disagree with it.
	const turns = [turn(1, 0, 20), turn(0, 19, 21)];
	const overlaps = [{ start: 19, end: 21, speakers: [1, 0] }];
	const regions = suggestRegions(turns, overlaps, CAST, PEOPLE, "dynamic");
	const split = regions.find((r) => r.layout === "split");
	assert.ok(split);
	assert.deepEqual(split.personIds, [10, 11], "still seat order, even though 11 (speaker 1) is the one holding the floor");
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
	const regions = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	// A holds 0-40, then B from 40.5 to the end: two shots, one cut.
	assert.equal(regions.length, 2);
	assert.deepEqual(regions[0].personIds, [10]);
	assert.deepEqual(regions[1].personIds, [11]);
	assert.equal(wideGaps(regions, 70).length, 0, "no wide flashes anywhere");
});

// --- Rule 8: framing styles (EDGE_CASES.md rule 8, C5, D2) ----------------

test("wideOnly suggests nothing at all, not even a both-on-screen composite", () => {
	const turns = [turn(0, 0, 20), turn(1, 20.5, 60)];
	const overlaps = [{ start: 19, end: 30, speakers: [0, 1] }]; // would easily earn a split otherwise
	assert.deepEqual(suggestRegions(turns, overlaps, CAST, PEOPLE, "wideOnly"), []);
});

test("gentle needs a longer stretch than dynamic before a line earns its own shot", () => {
	// 8 seconds: below dynamic's 4s cutoff? No -- above it, so dynamic cuts to
	// it. Below gentle's 12s cutoff, so gentle leaves it wide.
	const turns = [turn(0, 0, 20), turn(1, 21, 29), turn(2, 40, 60)];
	const dynamic = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	const gentle = suggestRegions(turns, [], CAST, PEOPLE, "gentle");
	assert.ok(dynamic.some((r) => r.personIds.includes(11)), "dynamic cuts to an 8s line");
	assert.ok(!gentle.some((r) => r.personIds.includes(11)), "gentle stays wide through the same 8s line");
});

test("gentle still cuts to a genuinely long stretch", () => {
	const turns = [turn(0, 0, 20), turn(1, 21, 40), turn(2, 50, 70)];
	const gentle = suggestRegions(turns, [], CAST, PEOPLE, "gentle");
	assert.ok(gentle.some((r) => r.personIds.includes(11)), "19s is well past gentle's cutoff too");
});

test("reconcileWithStyle keeps a shot the editor made and only replaces suggested ones around it", () => {
	const turns = [turn(0, 0, 20), turn(1, 21, 40), turn(2, 50, 70)];
	const dynamic = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	// The editor manually reframes the middle of B's shot onto C instead.
	const withUserEdit = addRegion(dynamic, 25, 30, "zoom", [12]);
	const userShot = withUserEdit.find((r) => r.source === "user");
	assert.ok(userShot);

	const reconciled = reconcileWithStyle(withUserEdit, turns, [], CAST, PEOPLE, "wideOnly");
	// wideOnly suggests nothing, so every *suggested* shot is gone --
	assert.ok(reconciled.every((r) => r.source !== "suggested"));
	// -- but the editor's own shot survives untouched, exactly where it was.
	assert.deepEqual(
		reconciled.find((r) => r.id === userShot.id),
		userShot,
	);
});

test("reset to suggested (a full edit(suggested)) is deliberately different from reconcileWithStyle: it does discard user shots", () => {
	// Documents the distinction the two exist for -- not a bug if this ever
	// looks like it "should" preserve user edits too. "Reset to suggested" in
	// EditorView.tsx calls suggestRegions directly for exactly this reason.
	const turns = [turn(0, 0, 20), turn(1, 21, 40)];
	const dynamic = suggestRegions(turns, [], CAST, PEOPLE, "dynamic");
	const withUserEdit = addRegion(dynamic, 5, 10, "zoom", [11]);
	assert.ok(withUserEdit.some((r) => r.source === "user"));
	assert.ok(suggestRegions(turns, [], CAST, PEOPLE, "dynamic").every((r) => r.source === "suggested"));
});

// --- resolveFraming: B7, per-instant visibility (EDGE_CASES.md) ---

function personSeenAt(id: number, x: number, t: number): Person {
	return { id, thumbnail: "", detectionCount: 1, keyframes: [{ t, bbox: { x, y: 0, width: 10, height: 10 } }] };
}

test("resolveFraming crops to the named person when they're visible at the region's start", () => {
	const region: FramingRegion = { id: "r", start: 10, end: 20, layout: "zoom", personIds: [0], source: "suggested" };
	const people = [personSeenAt(0, 0, 10)];
	const framing = resolveFraming([region], people, 15);
	assert.equal(framing.kind, "zoom");
});

test("a close-up on someone who left minutes ago goes wide, not a shot of an empty chair", () => {
	// Same shape as the founder-facing bug this fixes: a sighting exists, but
	// nowhere near this region -- bboxAtTime alone would have used it anyway.
	const region: FramingRegion = { id: "r", start: 60, end: 70, layout: "zoom", personIds: [0], source: "suggested" };
	const people = [personSeenAt(0, 0, 0)];
	const framing = resolveFraming([region], people, 65);
	assert.equal(framing.kind, "wide");
});

test("a both-on-screen shot falls back to a close-up on whoever is actually still visible", () => {
	const region: FramingRegion = {
		id: "r",
		start: 60,
		end: 70,
		layout: "split",
		personIds: [0, 1],
		source: "suggested",
	};
	const people = [personSeenAt(0, 0, 0), personSeenAt(1, 100, 60)];
	const framing = resolveFraming([region], people, 65);
	assert.equal(framing.kind, "zoom");
	assert.equal(framing.subjects[0]?.personId, 1);
});

test("a both-on-screen shot goes wide when nobody named is actually visible any more", () => {
	const region: FramingRegion = {
		id: "r",
		start: 60,
		end: 70,
		layout: "split",
		personIds: [0, 1],
		source: "suggested",
	};
	const people = [personSeenAt(0, 0, 0), personSeenAt(1, 100, 5)];
	const framing = resolveFraming([region], people, 65);
	assert.equal(framing.kind, "wide");
});

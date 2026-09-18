import type { BBox, OverlapWindow, Person, Turn } from "@/lib/api";
// Relative, not the `@/` alias used everywhere else: this file's tests run
// under Node's own module resolution (see regions.test.ts), which can't
// follow the Vite-only alias. faceCrop.ts has no other runtime imports of
// its own, so this is the one import in the module graph that has to be
// resolvable without Vite.
import { bboxAtTime, isVisibleAt } from "../../lib/faceCrop.ts";
import type { FramingRegion, FramingStyle, RegionLayout } from "@/features/timeline/types";

/** Shorter than this and a region is a flash rather than a shot, and the drag
 * handles have nothing left to grab. */
export const MIN_REGION_S = 0.25;

/** Gap below which two same-subject regions are treated as touching. Turn
 * boundaries land on transcription timings, which are not exact to the frame. */
const JOIN_EPSILON_S = 0.05;

/** A line said in a gap, with nobody else holding the floor, needs to be at
 * least this long to earn a shot of its own. Anything shorter is a "right" or
 * a one-word answer, and cutting to it costs two cuts to show half a second of
 * someone (EDGE_CASES.md A2, the case the founder reported). This is the
 * `dynamic` style's threshold; `gentle` uses a higher one below.
 *
 * Product call, 2026-09-17, from a range of 3-5s. The 1.5s the document
 * originally proposed was judged too low. Not measured against a professional
 * edit yet, unlike framing.py's crop sizes -- see EDGE_CASES.md section 5 for
 * what measuring it would look like. */
const MIN_LINE_FOR_SHOT_S = 4;

/** `gentle`'s threshold: "close-ups only for longer stretches, and wide
 * through quick exchanges" (EDGE_CASES.md rule 8). Roughly 3x dynamic's
 * cutoff -- high enough that a normal back-and-forth exchange stays wide and
 * only a genuinely substantial turn earns a close-up, without being so high
 * that gentle just becomes wideOnly in practice. Product call, 2026-09-17,
 * same caveat as MIN_LINE_FOR_SHOT_S: a starting point, not a measurement. */
const GENTLE_MIN_LINE_FOR_SHOT_S = 12;

/** More people talking at once than this, and the suggestion is wide rather
 * than a composite (EDGE_CASES.md C3, decided 2026-09-18) -- past three, a
 * speaker-focus layout is one large pane next to a wall of narrow slivers,
 * not a conversation. An editor who wants the composite anyway can still add
 * one by hand; this only governs what's *suggested*, the same way rule 8's
 * `wideOnly` style does. */
const MAX_SUGGESTED_COMPOSITE = 3;

/** Silence longer than this cuts to wide. Below it the shot simply holds until
 * whoever speaks next starts, instead of flashing wide in the hand-off gap
 * (EDGE_CASES.md A11, rule 6). */
const WIDE_AFTER_SILENCE_S = 3;

/** Words that carry nothing on their own, so a line made only of them is an
 * acknowledgement rather than a contribution. Deliberately excludes "no" and
 * "yes": those are real answers, and the document makes exactly that point
 * about "No." versus "Absolutely not, that's wrong". */
const BACKCHANNEL_WORDS = new Set([
	"um", "umm", "uh", "uhh", "uhm", "erm", "er", "hmm", "mhm", "mm", "mmm",
	"yeah", "yep", "yup", "ok", "okay", "right", "sure", "ha", "haha",
]);

function isAcknowledgementOnly(text: string): boolean {
	const words = text.toLowerCase().match(/[a-z']+/g);
	return words !== null && words.length > 0 && words.every((word) => BACKCHANNEL_WORDS.has(word));
}

/**
 * Whether someone else held the floor across this line and carried on after it.
 *
 * The transcript has no overlapping lines to test against -- `build_turns`
 * gives every word to exactly one speaker, and when two people talk at once
 * Whisper mostly writes only the louder one (EDGE_CASES.md A13). So "they were
 * already talking and kept going" shows up as the same other speaker on both
 * sides of this line, close enough either side to read as one continuous
 * stretch of them talking rather than two separate exchanges.
 *
 * Bounded by length: if the interjection outlasts the speaker's own
 * resumption, the floor changed hands and it was never an interjection.
 */
function floorHeldAcross(turns: Turn[], index: number): boolean {
	const turn = turns[index];
	const before = turns[index - 1];
	const after = turns[index + 1];
	if (!before || !after) return false;
	if (before.speaker !== after.speaker || before.speaker === turn.speaker) return false;
	if (turn.start - before.end >= WIDE_AFTER_SILENCE_S) return false;
	if (after.start - turn.end >= WIDE_AFTER_SILENCE_S) return false;
	return turn.end - turn.start < after.end - after.start;
}

/**
 * Whether this line should get a shot of its own.
 *
 * Product call, 2026-09-17: the floor comes first. If someone else was already
 * talking and carried on afterwards, the shot stays with them however long the
 * interjection was. Only when nobody holds the floor does length decide, and
 * then a line also has to say something -- four seconds of "yeah, yeah, right"
 * is still an acknowledgement.
 */
function earnsItsOwnShot(turns: Turn[], index: number, minLineForShot: number): boolean {
	const turn = turns[index];
	if (floorHeldAcross(turns, index)) return false;
	if (turn.end - turn.start < minLineForShot) return false;
	return !isAcknowledgementOnly(turn.text);
}

/**
 * How long a shot holds: until the next shot starts, or until the room
 * actually goes quiet, whichever comes first.
 *
 * Walks every turn in between rather than just the two shots either side. The
 * lines that didn't earn a shot are still someone speaking, so measuring shot
 * to shot both reads an interjection as silence and, at the other end, drops
 * the shot while its own speaker is still finishing.
 */
function holdUntil(turns: Turn[], from: number, nextShot: number | undefined): number {
	const limit = nextShot ?? turns.length - 1;
	for (let i = from; i < limit; i++) {
		if (turns[i + 1].start - turns[i].end >= WIDE_AFTER_SILENCE_S) return turns[i].end;
	}
	return nextShot === undefined ? turns[limit].end : turns[nextShot].start;
}

/**
 * Whether an overlap window is a takeover -- B interrupts and A gives up --
 * rather than a moment to genuinely show both people (EDGE_CASES.md A5 vs
 * A4/A6). Today's code gave every overlap the same both-on-screen treatment,
 * which for a takeover means two cuts (close on A, both on screen, close on
 * B) where an editor would make one, straight to B.
 *
 * Detected from the turn immediately either side of the overlap: if they
 * belong to different people and the one after earns a shot on its own
 * merits (not a fleeting interjection), the floor changed hands here. If the
 * same person's turn spans both sides, nobody gave up anything -- that's
 * A4's territory (hold if short, show both if it goes on), untouched by this.
 * A6 (three or more people, or a real back-and-forth argument) isn't this
 * shape either: this only fires on a clean two-turn handoff.
 *
 * Product call, 2026-09-17, per EDGE_CASES.md section 4 question 2: cuts on
 * the new speaker's first word, which `window.start` stands in for -- that's
 * the moment pyannote's overlap detector says the second voice began, as
 * close to "B's first word" as the data this runs on actually has.
 */
function takeoverAt(
	window: OverlapWindow,
	turns: Turn[],
	minLineForShot: number,
): { outgoingIndex: number; incomingIndex: number } | null {
	const incomingIndex = turns.findIndex((t) => t.start >= window.start);
	if (incomingIndex <= 0) return null;
	const outgoingIndex = incomingIndex - 1;
	if (turns[outgoingIndex].speaker === turns[incomingIndex].speaker) return null;
	if (!earnsItsOwnShot(turns, incomingIndex, minLineForShot)) return null;
	return { outgoingIndex, incomingIndex };
}

let nextId = 0;
function makeId(): string {
	nextId += 1;
	return `r${nextId}`;
}

/** The region covering a moment, or null for wide. Regions are kept disjoint;
 * if two ever overlap, the later one wins -- the same rule render.py applies,
 * so the preview cannot disagree with the export. */
export function regionAt(regions: FramingRegion[], t: number): FramingRegion | null {
	let found: FramingRegion | null = null;
	for (const region of regions) {
		if (region.start <= t && t < region.end && (!found || region.start > found.start)) {
			found = region;
		}
	}
	return found;
}

/** What's left of `region` once `holes` are taken out of it. A hole landing in
 * the middle splits it in two; one that covers it removes it entirely.
 *
 * The first surviving piece keeps the original id so that trimming a region
 * during a drag doesn't churn React keys (or invalidate a selection) sixty
 * times a second. Holes only need a time range -- a plain `{start, end}`
 * covers both an actual `FramingRegion` (a composite carving a close-up in
 * two) and a window that should force wide without becoming a region of its
 * own (C3: four or more people at once). */
function subtract(region: FramingRegion, holes: { start: number; end: number }[]): FramingRegion[] {
	let pieces: FramingRegion[] = [region];
	for (const hole of holes) {
		const next: FramingRegion[] = [];
		for (const piece of pieces) {
			if (hole.end <= piece.start || hole.start >= piece.end) {
				next.push(piece);
				continue;
			}
			if (hole.start - piece.start > MIN_REGION_S) {
				next.push({ ...piece, end: hole.start });
			}
			if (piece.end - hole.end > MIN_REGION_S) {
				next.push({ ...piece, id: next.length ? makeId() : piece.id, start: hole.end });
			}
		}
		pieces = next;
	}
	return pieces;
}

function sameSubjects(a: FramingRegion, b: FramingRegion): boolean {
	return (
		a.layout === b.layout &&
		a.personIds.length === b.personIds.length &&
		a.personIds.every((id, i) => b.personIds[i] === id)
	);
}

/** Join regions that touch and say the same thing. Two consecutive turns by
 * one person are one shot, not two identical ones back to back. */
function mergeTouching(regions: FramingRegion[]): FramingRegion[] {
	const sorted = [...regions].sort((a, b) => a.start - b.start);
	const merged: FramingRegion[] = [];
	for (const region of sorted) {
		const last = merged[merged.length - 1];
		if (last && sameSubjects(last, region) && region.start - last.end <= JOIN_EPSILON_S) {
			last.end = Math.max(last.end, region.end);
			continue;
		}
		merged.push({ ...region });
	}
	return merged;
}

/**
 * The framing the pipeline proposes, as regions: close on whoever is speaking,
 * both on screen wherever people genuinely talk over each other, and wide
 * wherever we don't know who is talking.
 *
 * This is where the old per-turn defaults went. Expressing them as regions
 * up front means every automatic decision is visible on the timeline and
 * draggable, instead of being policy buried in the renderer.
 */

/** Each person's typical horizontal position, as the median centre-x of every
 * keyframe's bbox -- median rather than mean so someone leaning across frame
 * for one moment doesn't shift where they're considered to sit. A person with
 * no keyframes (never actually located) sorts last: there's no seat to place
 * them at, so they shouldn't jump ahead of people we do know the position of. */
function seatPosition(personId: number, people: Person[]): number {
	const person = people.find((p) => p.id === personId);
	if (!person || person.keyframes.length === 0) return Infinity;
	const centres = person.keyframes.map((kf) => kf.bbox.x + kf.bbox.width / 2).sort((a, b) => a - b);
	return centres[Math.floor(centres.length / 2)];
}

/** Rule 7: whoever sits on the left of the frame is in the left pane, every
 * time, so a multi-person shot doesn't swap sides from one cut to the next
 * the way ordering by speaker or person id happened to (EDGE_CASES.md C1).
 * `personIds` order is what both the live preview (resolveFraming) and the
 * export (render.py's build_render_segments, reading person_ids in the same
 * order) lay panes out in, so sorting it here is the one place this needs
 * deciding. */
export function orderBySeat(personIds: number[], people: Person[]): number[] {
	return [...personIds].sort((a, b) => seatPosition(a, people) - seatPosition(b, people));
}

/** Rule 3/C2: with three or more people on screen, the large pane goes to
 * whoever was already holding the floor, not whoever happens to sit
 * leftmost. Read as whichever of the window's speakers has a turn already
 * under way when the overlap starts -- "overlap favours whoever started
 * first" is rule 3's own description of this. A composite where the floor
 * genuinely changes hands partway through (rule 5 would apply, since the
 * new holder needs a moment worth its own shot) keeps one holder for the
 * whole region rather than splitting it -- not built; overlaps this
 * genuinely long and contested haven't shown up in a measured episode yet
 * (see STATUS.md). Returns `undefined` when no turn from a window speaker
 * actually covers its start (shouldn't happen for a real overlap window,
 * but `orderBySeat`'s existing order is a safe fallback either way). */
function floorHolderPersonId(
	window: OverlapWindow,
	turns: Turn[],
	speakerToPerson: Record<number, number>,
): number | undefined {
	const holding = turns
		.filter((t) => window.speakers.includes(t.speaker) && t.start < window.end && t.end > window.start)
		.sort((a, b) => a.start - b.start)[0];
	return holding ? speakerToPerson[holding.speaker] : undefined;
}

export function suggestRegions(
	turns: Turn[],
	overlapWindows: OverlapWindow[],
	speakerToPerson: Record<number, number>,
	people: Person[],
	style: FramingStyle,
): FramingRegion[] {
	// Rule 8: no automatic framing at all -- not even the both-on-screen
	// composite for a genuine overlap. The same result as an editor deleting
	// every suggested shot by hand; a manual "+ Close-up" or "+ Both on
	// screen" still works, since this only ever governs what's *suggested*.
	if (style === "wideOnly") return [];
	const minLineForShot = style === "gentle" ? GENTLE_MIN_LINE_FOR_SHOT_S : MIN_LINE_FOR_SHOT_S;

	// Rule 4/A5: a takeover is one cut, on the new speaker's first word, not
	// the both-on-screen composite -- classified up front, per window, so it
	// can both keep the window out of `splits` and pull the incoming shot's
	// start back to where the handoff actually began.
	const takeoverCutAt = new Map<number, number>(); // incoming turn index -> cut point
	const genuineOverlaps: OverlapWindow[] = [];
	for (const window of overlapWindows) {
		const takeover = takeoverAt(window, turns, minLineForShot);
		if (takeover) {
			takeoverCutAt.set(takeover.incomingIndex, Math.min(window.start, turns[takeover.incomingIndex].start));
		} else {
			genuineOverlaps.push(window);
		}
	}

	const splits: FramingRegion[] = [];
	// C3: four or more people at once suggests wide, not a composite -- a
	// speaker-focus layout past three is one large pane next to a wall of
	// narrow slivers. Still has to punch a hole in whichever close-up would
	// otherwise cover the moment, or the group talking over each other would
	// silently read as whoever's shot the boundary happened to land on.
	const forcedWide: { start: number; end: number }[] = [];
	for (const window of genuineOverlaps) {
		const personIds = orderBySeat(
			[
				...new Set(
					window.speakers
						.map((speaker) => speakerToPerson[speaker])
						.filter((id): id is number => id !== undefined),
				),
			],
			people,
		);
		if (personIds.length < 2 || window.end - window.start < MIN_REGION_S) continue;
		if (personIds.length > MAX_SUGGESTED_COMPOSITE) {
			forcedWide.push({ start: window.start, end: window.end });
			continue;
		}
		// C2: with three or more, the large pane (render.py's speaker_bboxes[0])
		// goes to whoever was already holding the floor -- two-person splits
		// have no large pane, just a symmetric side-by-side, so seat order alone
		// (already rule 7/C1's territory) is left as-is for those.
		const holder = personIds.length >= 3 ? floorHolderPersonId(window, turns, speakerToPerson) : undefined;
		const ordered = holder !== undefined ? [holder, ...personIds.filter((id) => id !== holder)] : personIds;
		splits.push({
			id: makeId(),
			start: window.start,
			end: window.end,
			layout: "split",
			personIds: ordered,
			source: "suggested",
		});
	}
	const holes = [...splits, ...forcedWide];

	// Only the lines that earn a shot. A line that doesn't isn't left to render
	// wide -- it falls inside whichever shot is held across it below, which is
	// the whole point: the camera stays on whoever is actually holding forth.
	const shots: { turn: Turn; personId: number; index: number }[] = [];
	turns.forEach((turn, index) => {
		const personId = speakerToPerson[turn.speaker];
		if (personId === undefined) return; // nobody to close in on
		if (!earnsItsOwnShot(turns, index, minLineForShot)) return;
		shots.push({ turn, personId, index });
	});

	const closeUps: FramingRegion[] = [];
	shots.forEach(({ turn, personId, index }, i) => {
		// Rule 6: a shot runs until the next one starts, and only a real
		// silence goes wide -- otherwise every hand-off flashed the wide shot
		// for the tenth of a second between two turns. A takeover overrides
		// this with an earlier cut, never a later one -- Math.min guards that.
		const nextIndex = shots[i + 1]?.index;
		const naturalEnd = holdUntil(turns, index, nextIndex);
		const takeoverEnd = nextIndex !== undefined ? takeoverCutAt.get(nextIndex) : undefined;
		const end = takeoverEnd !== undefined ? Math.min(takeoverEnd, naturalEnd) : naturalEnd;
		const region: FramingRegion = {
			id: makeId(),
			start: takeoverCutAt.get(index) ?? turn.start,
			end,
			layout: "zoom",
			personIds: [personId],
			source: "suggested",
		};
		// Talking over each other wins over either person's close-up.
		closeUps.push(...subtract(region, holes));
	});

	return mergeTouching([...splits, ...closeUps]);
}

/**
 * Re-suggests regions under a new style without touching what the editor
 * made by hand (EDGE_CASES.md D2: "only shots marked suggested are
 * replaced. Shots marked yours always survive.") -- what the framing-style
 * control uses when the episode already has edits, as opposed to "Reset to
 * suggested", which is a deliberate full reset the editor explicitly asks
 * for and discards user shots on purpose.
 *
 * Same fold `addRegion` already uses for one region, generalised to every
 * user region at once: start from a fresh suggestion, then punch each user
 * region's hole into it and drop the region back in, so a user shot always
 * wins wherever it sits.
 */
export function reconcileWithStyle(
	regions: FramingRegion[],
	turns: Turn[],
	overlapWindows: OverlapWindow[],
	speakerToPerson: Record<number, number>,
	people: Person[],
	style: FramingStyle,
): FramingRegion[] {
	const userRegions = regions.filter((r) => r.source === "user");
	let result = suggestRegions(turns, overlapWindows, speakerToPerson, people, style);
	for (const userRegion of userRegions) {
		result = [...result.flatMap((existing) => subtract(existing, [userRegion])), userRegion];
	}
	return result.sort((a, b) => a.start - b.start);
}

export interface Subject {
	personId: number;
	bbox: BBox;
}

export type Framing =
	| { kind: "wide"; region: FramingRegion | null }
	| { kind: "zoom"; region: FramingRegion; subjects: Subject[] }
	| { kind: "split"; region: FramingRegion; subjects: Subject[] };

/**
 * What the export will actually show at this moment.
 *
 * This is the same resolution `build_render_segments` in server/pipeline/
 * render.py performs, deliberately step for step: region or wide, drop
 * anyone we can't find a face for, fall back to a close-up when "both on
 * screen" only has one findable person, wide when it has none. A preview
 * that disagrees with the export is worse than no preview, so these two must
 * change together.
 *
 * Crops are taken at the region's start, not at `t`: the renderer cuts one
 * segment per region and fixes that segment's crop at its start, so sampling
 * the live playhead here would drift away from the exported frame.
 */
export function resolveFraming(regions: FramingRegion[], people: Person[], t: number): Framing {
	const region = regionAt(regions, t);
	if (!region) return { kind: "wide", region: null };

	const subjects = region.personIds
		.map((personId) => {
			const person = people.find((p) => p.id === personId);
			// No keyframes means we never actually located them, and not being
			// visible right now (B7) is the same situation for framing purposes
			// -- either way there's no current sighting to crop to.
			if (!person || person.keyframes.length === 0 || !isVisibleAt(person, region.start)) return null;
			return { personId, bbox: bboxAtTime(person, region.start) };
		})
		.filter((s): s is Subject => s !== null);

	if (subjects.length === 0) return { kind: "wide", region };
	if (region.layout === "split" && subjects.length >= 2) return { kind: "split", region, subjects };
	return { kind: "zoom", region, subjects: subjects.slice(0, 1) };
}

/** Whoever most recently spoke before this point, other than `exclude`. Used
 * to fill in the second person when the editor asks for "both on screen". */
export function otherSpeakerNear(
	turns: Turn[],
	speakerToPerson: Record<number, number>,
	at: number,
	exclude: number | undefined,
): number | undefined {
	let best: { id: number; distance: number } | undefined;
	for (const turn of turns) {
		const personId = speakerToPerson[turn.speaker];
		if (personId === undefined || personId === exclude) continue;
		const distance = turn.start > at ? turn.start - at : at - turn.end;
		if (!best || distance < best.distance) best = { id: personId, distance };
	}
	return best?.id;
}

/** Insert a region, clearing whatever it covers. The new one is the decision;
 * anything it lands on top of gives way rather than fighting it. */
export function addRegion(
	regions: FramingRegion[],
	start: number,
	end: number,
	layout: RegionLayout,
	personIds: number[],
): FramingRegion[] {
	const region: FramingRegion = {
		id: makeId(),
		start,
		end,
		layout,
		personIds,
		source: "user",
	};
	const kept = regions.flatMap((existing) => subtract(existing, [region]));
	return [...kept, region].sort((a, b) => a.start - b.start);
}

/**
 * Move one edge of a region. It is stopped only by its own other edge and by
 * the ends of the timeline; a neighbour it is dragged over gives way.
 *
 * That is the whole point of the model rather than an accident of it: holding
 * a close-up *through* a short interjection means growing over the region that
 * covers the interjection. Clamping at the neighbour would make the one move
 * the design exists for impossible. What's overwritten is gone from the
 * regions; undo, or "Reset to suggested", is the way back.
 */
export function resizeRegion(
	regions: FramingRegion[],
	id: string,
	edge: "start" | "end",
	to: number,
	duration: number,
): FramingRegion[] {
	const region = regions.find((r) => r.id === id);
	if (!region) return regions;

	const resized: FramingRegion =
		edge === "start"
			? { ...region, start: Math.max(0, Math.min(to, region.end - MIN_REGION_S)), source: "user" }
			: {
					...region,
					end: Math.min(duration, Math.max(to, region.start + MIN_REGION_S)),
					source: "user",
				};

	const kept = regions.filter((r) => r.id !== id).flatMap((r) => subtract(r, [resized]));
	return [...kept, resized].sort((a, b) => a.start - b.start);
}

/**
 * Split a region into two at `at`, keeping the same layout and people on
 * both sides. The first half keeps the original id, for the same reason
 * `subtract` does: it's what a selection is holding onto.
 *
 * A no-op (returns `regions` unchanged) if `id` doesn't exist or `at` isn't
 * far enough from either edge to leave two real shots -- there is nothing
 * useful to split at the very edge of a region.
 */
export function splitRegion(regions: FramingRegion[], id: string, at: number): FramingRegion[] {
	const region = regions.find((r) => r.id === id);
	if (!region || at - region.start < MIN_REGION_S || region.end - at < MIN_REGION_S) return regions;

	const first: FramingRegion = { ...region, end: at, source: "user" };
	const second: FramingRegion = { ...region, id: makeId(), start: at, source: "user" };
	return regions.map((r) => (r.id === id ? first : r)).concat(second).sort((a, b) => a.start - b.start);
}

/** The stretches no region covers. Rendered wide, and drawn on the timeline
 * so the lane reads as a decision everywhere rather than going blank. */
export function wideGaps(regions: FramingRegion[], duration: number): { start: number; end: number }[] {
	const sorted = [...regions].sort((a, b) => a.start - b.start);
	const gaps: { start: number; end: number }[] = [];
	let cursor = 0;
	for (const region of sorted) {
		if (region.start - cursor > JOIN_EPSILON_S) gaps.push({ start: cursor, end: region.start });
		cursor = Math.max(cursor, region.end);
	}
	if (duration - cursor > JOIN_EPSILON_S) gaps.push({ start: cursor, end: duration });
	return gaps;
}

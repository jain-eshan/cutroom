import type { BBox, OverlapWindow, Person, Turn } from "@/lib/api";
import { bboxAtTime } from "@/lib/faceCrop";
import type { FramingRegion, RegionLayout } from "@/features/timeline/types";

/** Shorter than this and a region is a flash rather than a shot, and the drag
 * handles have nothing left to grab. */
export const MIN_REGION_S = 0.25;

/** Gap below which two same-subject regions are treated as touching. Turn
 * boundaries land on transcription timings, which are not exact to the frame. */
const JOIN_EPSILON_S = 0.05;

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
 * times a second. */
function subtract(region: FramingRegion, holes: FramingRegion[]): FramingRegion[] {
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
export function suggestRegions(
	turns: Turn[],
	overlapWindows: OverlapWindow[],
	speakerToPerson: Record<number, number>,
): FramingRegion[] {
	const splits: FramingRegion[] = [];
	for (const window of overlapWindows) {
		const personIds = [
			...new Set(
				window.speakers
					.map((speaker) => speakerToPerson[speaker])
					.filter((id): id is number => id !== undefined),
			),
		];
		if (personIds.length < 2 || window.end - window.start < MIN_REGION_S) continue;
		splits.push({
			id: makeId(),
			start: window.start,
			end: window.end,
			layout: "split",
			personIds,
			source: "suggested",
		});
	}

	const closeUps: FramingRegion[] = [];
	for (const turn of turns) {
		const personId = speakerToPerson[turn.speaker];
		if (personId === undefined) continue; // nobody to close in on -- stays wide
		const region: FramingRegion = {
			id: makeId(),
			start: turn.start,
			end: turn.end,
			layout: "zoom",
			personIds: [personId],
			source: "suggested",
		};
		// Talking over each other wins over either person's close-up.
		closeUps.push(...subtract(region, splits));
	}

	return mergeTouching([...splits, ...closeUps]);
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
			// No keyframes means we never actually located them, which is the
			// same situation as not knowing about them at all.
			if (!person || person.keyframes.length === 0) return null;
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

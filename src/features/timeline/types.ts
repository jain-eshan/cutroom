/** What a region does with the people it names. Wide is the absence of a
 * region, not a third value -- see `FramingRegion`. */
export type RegionLayout = "zoom" | "split";

/**
 * One framing decision over a stretch of the timeline.
 *
 * Regions do not have to agree with turn boundaries, and that is the point:
 * it is what lets an editor hold a close-up through a short interjection,
 * which is what a human editor does and what a per-turn model cannot express.
 * Anything no region covers renders wide.
 *
 * Times are seconds, like turns, words and keyframes everywhere else in the
 * app and in the pipeline. (The design handoff writes these as `startMs`;
 * using milliseconds here alone would add a conversion seam to every
 * comparison against a turn, which is where the bugs would live.)
 */
export interface FramingRegion {
	id: string;
	start: number;
	end: number;
	layout: RegionLayout;
	/** Who this region is about, as person ids. */
	personIds: number[];
	/** `suggested` is what the pipeline proposed; `user` is what the editor
	 * made it. The difference is the only signal we have about where the
	 * automatic framing is wrong, so it is carried through to the export. */
	source: "suggested" | "user";
	/** Manual offset from the computed crop, as a fraction of the crop's own
	 * width/height (so it means the same thing at any pane size). Absent or
	 * `{x:0,y:0}` is "trust the automatic framing" -- most regions never set
	 * this. See `personCrop` in `src/lib/faceCrop.ts` and `person_crop` in
	 * `server/pipeline/framing.py`, which must apply it identically. */
	cropNudge?: { x: number; y: number };
}

/** A nudge small enough to correct the automatic crop without being able to
 * frame something else entirely -- that's still what dragging a region or
 * picking a different person is for. */
export const MAX_CROP_NUDGE = 0.3;

// Plain-English shot names, not pipeline/technical terms -- see docs/design/
// handoff README, "Voice & copy rules": "Close on Maya", not "Zoom".
export const LAYOUT_LABELS: Record<RegionLayout, string> = {
	zoom: "Close-up",
	split: "Both on screen",
};

export const WIDE_LABEL = "Wide";

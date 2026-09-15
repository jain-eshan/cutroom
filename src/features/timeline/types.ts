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
}

// Plain-English shot names, not pipeline/technical terms -- see docs/design/
// handoff README, "Voice & copy rules": "Close on Maya", not "Zoom".
export const LAYOUT_LABELS: Record<RegionLayout, string> = {
	zoom: "Close-up",
	split: "Both on screen",
};

export const WIDE_LABEL = "Wide";

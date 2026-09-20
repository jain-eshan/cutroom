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

/** How much automatic framing an episode gets (EDGE_CASES.md rule 8).
 * `wideOnly` suggests nothing at all -- the whole episode stays wide, the
 * same result as deleting every shot by hand; `gentle` (the default for a
 * new episode) only cuts to a close-up for a stretch long enough to be a
 * real contribution; `dynamic` is every shot rule at its normal sensitivity.
 * Always about what gets *suggested* -- a manual "+ Close-up" or "+ Both on
 * screen" works under any style, and changing style never touches a shot the
 * editor made (`source: "user"`), only ones still marked `"suggested"`. */
export type FramingStyle = "wideOnly" | "gentle" | "dynamic";

/**
 * What each style actually is: the number of seconds someone has to be
 * talking before the camera cuts in on them. `null` never cuts in.
 *
 * These live here rather than in `regions.ts` because they are the whole
 * definition of a style, and the labels below are written from them. A
 * threshold the interface claims and the suggestions don't use is exactly
 * the kind of drift that made "Gentle" and "Dynamic" indistinguishable.
 *
 * Product call, 2026-09-17, from a range of 3-5s for `dynamic`; the 1.5s
 * originally proposed was judged too low. `gentle` is roughly 3x that, high
 * enough that a normal back-and-forth stays wide. Neither is measured
 * against a professional edit -- see EDGE_CASES.md section 5 for what
 * measuring them would look like, and docs/STATUS.md for what measuring the
 * *result* on a real episode showed.
 */
export const FRAMING_STYLE_MIN_LINE_S: Record<FramingStyle, number | null> = {
	wideOnly: null,
	gentle: 12,
	dynamic: 4,
};

/**
 * Named for what you get, not for a temperament.
 *
 * "Gentle" and "Dynamic" said nothing about the result and, measured on a
 * real episode, barely differed from each other -- 33 shots against 37, and
 * 93% of the episode on a face against 95%. A name that describes a mood
 * cannot be checked against the edit; a name that describes the rule can.
 */
export const FRAMING_STYLE_LABELS: Record<FramingStyle, string> = {
	wideOnly: "Stay wide",
	gentle: "Long answers",
	dynamic: "Most answers",
};

/** The rule in a sentence, built from the number the suggestions really use. */
export function framingStyleRule(style: FramingStyle): string {
	const seconds = FRAMING_STYLE_MIN_LINE_S[style];
	return seconds === null
		? "Everyone stays in frame. No close-ups suggested."
		: `Cut to a close-up when someone has been talking for ${seconds} seconds.`;
}

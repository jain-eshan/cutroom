export type Layout = "original" | "zoom" | "split";

// Plain-English shot names, not pipeline/technical terms -- see docs/design/
// handoff README, "Voice & copy rules": "Close on Maya", not "Zoom".
export const LAYOUT_LABELS: Record<Layout, string> = {
	original: "Wide",
	zoom: "Close-up",
	split: "Both on screen",
};

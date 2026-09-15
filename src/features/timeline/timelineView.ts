/**
 * The maths behind the zoomable timeline: which stretch of the episode is on
 * screen, where the ruler's ticks go, and where a dragged edge snaps. No React
 * in here, so `npm test` runs it under Node directly.
 */

export interface TimeSpan {
	start: number;
	end: number;
}

/** Zoomed all the way in, this much of the episode fills the timeline --
 * close enough to put an edge between two words. */
export const MIN_VIEW_S = 2;

function clampSpan(length: number, duration: number): number {
	return Math.min(duration, Math.max(Math.min(MIN_VIEW_S, duration), length));
}

/** A window `length` seconds long starting near `start`, kept inside the episode. */
export function clampView(start: number, length: number, duration: number): TimeSpan {
	const span = clampSpan(length, duration);
	const from = Math.max(0, Math.min(duration - span, start));
	return { start: from, end: from + span };
}

/** Zoom by `factor` (below 1 zooms in), keeping `anchor` under the same spot on screen. */
export function zoomView(view: TimeSpan, factor: number, anchor: number, duration: number): TimeSpan {
	const span = view.end - view.start;
	const ratio = span > 0 ? (anchor - view.start) / span : 0;
	const next = clampSpan(span * factor, duration);
	return clampView(anchor - ratio * next, next, duration);
}

/** The view paged so `t` is on screen, or the same object if it already is. */
export function reveal(view: TimeSpan, t: number, duration: number): TimeSpan {
	if (t >= view.start && t <= view.end) return view;
	const span = view.end - view.start;
	// A little lead-in, so what comes just before is visible too.
	return clampView(t - span * 0.1, span, duration);
}

// [labelled tick, unlabelled tick] in seconds. Each major is a whole number of
// minors, so a tick's index alone says whether it's labelled.
const RULER_STEPS: [number, number][] = [
	[0.5, 0.1],
	[1, 0.2],
	[2, 0.5],
	[5, 1],
	[10, 2],
	[15, 5],
	[30, 5],
	[60, 10],
	[120, 30],
	[300, 60],
	[600, 120],
	[900, 300],
	[1800, 300],
	[3600, 600],
];

/** The finest tick spacing whose labels land at least `minLabelPx` apart. */
export function rulerStep(secondsPerPx: number, minLabelPx = 70): { major: number; minor: number } {
	const [major, minor] =
		RULER_STEPS.find(([step]) => step / secondsPerPx >= minLabelPx) ?? RULER_STEPS[RULER_STEPS.length - 1];
	return { major, minor };
}

/** m:ss, or h:mm:ss past the hour; `tenths` adds one decimal to the seconds. */
export function formatTimecode(seconds: number, tenths = false): string {
	const whole = tenths ? Math.floor(seconds * 10) / 10 : Math.floor(seconds);
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = whole % 60;
	const sec = tenths ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** `t` moved onto the nearest of `targets` (sorted ascending) when one is
 * within `threshold` seconds, otherwise `t` unchanged. */
export function snapTime(t: number, targets: number[], threshold: number): number {
	let lo = 0;
	let hi = targets.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (targets[mid] < t) lo = mid + 1;
		else hi = mid;
	}
	// targets[lo] is the first at or after t, so the nearest is it or the one before.
	let best = t;
	let bestDistance = threshold;
	for (const candidate of [targets[lo - 1], targets[lo]]) {
		if (candidate === undefined) continue;
		const distance = Math.abs(candidate - t);
		if (distance <= bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

/** The next of `edges` (sorted ascending) after `t`, or the previous one before
 * it. The margin stops a playhead parked on an edge from finding that same edge. */
export function stepToEdge(edges: number[], t: number, direction: 1 | -1): number | undefined {
	const margin = 0.05;
	return direction > 0 ? edges.find((e) => e > t + margin) : edges.findLast((e) => e < t - margin);
}

import type { BBox, Person } from "@/lib/api";

// Keep in sync with server/pipeline/render.py's VISIBLE_WITHIN_S -- both read
// the same keyframes and must agree on who's on screen, or the preview and
// the export disagree about it.
const VISIBLE_WITHIN_S = 2.0;

/** EDGE_CASES.md B7: whether a person has an actual sighting near `t`, not
 * just a sighting *somewhere* -- `bboxAtTime` finds the nearest keyframe
 * however far away it is, which used to mean a close-up could show an empty
 * chair for someone who left minutes ago. Only the region-start sampling
 * point this and `bboxAtTime` are both called at is covered; a person who
 * leaves partway through an already-showing region isn't caught until the
 * region ends (DESIGN_SYSTEM.md item 6b's "segment boundaries where
 * visibility changes" is the rest of that fix, deferred with the rest of the
 * per-instant work -- see STATUS.md). */
export function isVisibleAt(person: Person, t: number): boolean {
	return person.keyframes.some((kf) => Math.abs(kf.t - t) <= VISIBLE_WITHIN_S);
}

/** Nearest keyframe's bbox to a given time -- no interpolation, matching
 * server/pipeline/render.py's bbox_at_time. Call `isVisibleAt` first; this
 * returns the nearest keyframe unconditionally, however far away it is. */
export function bboxAtTime(person: Person, t: number): BBox {
	if (person.keyframes.length === 0) {
		// Not reachable today -- regions.ts only ever calls this for a person
		// with at least one sighting -- but person.keyframes[0] on an empty
		// array is undefined, and undefined.t is a crash with no indication
		// which person or why. An explicit error here is a debugging aid if
		// that invariant is ever broken by a future change, not a case this
		// is expected to hit.
		throw new Error(`bboxAtTime: person ${person.id} has no keyframes`);
	}
	let nearest = person.keyframes[0];
	let bestDist = Math.abs(nearest.t - t);
	for (const kf of person.keyframes) {
		const d = Math.abs(kf.t - t);
		if (d < bestDist) {
			nearest = kf;
			bestDist = d;
		}
	}
	return nearest.bbox;
}

export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

// Keep these in sync with server/pipeline/framing.py -- they're the same
// numbers, measured from professional podcast edits. There's no shared-code
// mechanism between the TypeScript and Python runtimes, so drift here shows
// up as "the preview doesn't match the export".
const FRAMING_RATIO_WIDE = 3.5;
const FRAMING_RATIO_TALL = 6.0;
const FACE_VERTICAL_POSITION = 0.35;
export const MAX_UPSCALE = 2.6;

function framingRatio(aspect: number): number {
	const lo = 1.0;
	const hi = 16 / 9;
	const a = Math.max(lo, Math.min(hi, aspect));
	const t = (a - lo) / (hi - lo);
	return FRAMING_RATIO_TALL + t * (FRAMING_RATIO_WIDE - FRAMING_RATIO_TALL);
}

/**
 * Crop rect framing one person for a target pane. Direct port of
 * framing.py's person_crop: height from face size and the measured framing
 * ratio, width from the pane aspect, face placed in the upper third so
 * there's headroom above and body below.
 *
 * `nudge` is the region's manual override (see `FramingRegion.cropNudge`),
 * as a fraction of the crop's own width/height -- applied after the
 * automatic position, before the same edge clamp, so a nudge can't push the
 * crop off the source frame. `framing.py`'s `person_crop` must do the same.
 */
export function personCrop(
	bbox: BBox,
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
	maxUpscale = MAX_UPSCALE,
	nudge?: { x: number; y: number },
): CropRect {
	const aspect = targetWidth / targetHeight;

	let cropHeight = Math.max(bbox.height * framingRatio(aspect), targetHeight / maxUpscale);
	let cropWidth = cropHeight * aspect;

	if (cropWidth > sourceWidth) {
		cropWidth = sourceWidth;
		cropHeight = cropWidth / aspect;
	}
	if (cropHeight > sourceHeight) {
		cropHeight = sourceHeight;
		cropWidth = cropHeight * aspect;
	}

	const faceCx = bbox.x + bbox.width / 2;
	const faceCy = bbox.y + bbox.height / 2;

	const left = faceCx - cropWidth / 2 + (nudge?.x ?? 0) * cropWidth;
	const top = faceCy - cropHeight * FACE_VERTICAL_POSITION + (nudge?.y ?? 0) * cropHeight;

	const x = Math.max(0, Math.min(sourceWidth - cropWidth, left));
	const y = Math.max(0, Math.min(sourceHeight - cropHeight, top));
	return { x, y, width: cropWidth, height: cropHeight };
}

import type { BBox, Person } from "@/lib/api";

/** Nearest keyframe's bbox to a given time -- no interpolation, matching
 * server/pipeline/render.py's bbox_at_time. */
export function bboxAtTime(person: Person, t: number): BBox {
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

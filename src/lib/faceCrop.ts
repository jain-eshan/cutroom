import type { BBox, FaceTrack } from "@/lib/api";

/** Nearest keyframe's bbox to a given time — no interpolation yet, fine for a mostly-static shot. */
export function bboxAtTime(track: FaceTrack, t: number): BBox {
	let nearest = track.keyframes[0];
	let bestDist = Math.abs(nearest.t - t);
	for (const kf of track.keyframes) {
		const d = Math.abs(kf.t - t);
		if (d < bestDist) {
			nearest = kf;
			bestDist = d;
		}
	}
	return nearest.bbox;
}

/**
 * CSS transform that zooms a full-frame <video> in on a face bbox, "cover"-style
 * (fills the viewport, crops any excess rather than letterboxing).
 */
export function computeZoomStyle(
	bbox: BBox,
	frameWidth: number,
	frameHeight: number,
	pad = 0.8,
): React.CSSProperties {
	const cx = bbox.x + bbox.width / 2;
	const cy = bbox.y + bbox.height / 2;
	const paddedW = bbox.width * (1 + pad * 2);
	const paddedH = bbox.height * (1 + pad * 2);
	const scale = Math.min(3.5, Math.max(1, frameWidth / paddedW, frameHeight / paddedH));

	const cxPercent = (cx / frameWidth) * 100;
	const cyPercent = (cy / frameHeight) * 100;

	return {
		transformOrigin: `${cxPercent}% ${cyPercent}%`,
		transform: `translate(${50 - cxPercent}%, ${50 - cyPercent}%) scale(${scale})`,
	};
}

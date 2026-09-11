"""How to frame a person inside a pane.

The numbers here are measured, not guessed. Frames were pulled from three
professional podcast edits and run through the same face detector this
project uses:

    shot type                 pane height / face height   face centre (y)
    single speaker                     3.5x                  0.32 - 0.39
    wide / establishing               ~10x                   0.42 - 0.46

Two things follow, and the old implementation got both wrong:

1. It cropped at ~2.5x face height -- roughly 40% tighter than professionals
   frame a single speaker. That is what made zoomed shots read as "a super
   zoomed-in facial part", especially for seated subjects where the body and
   chair are part of the composition.
2. It centred the face vertically (0.50). Real edits put the face in the
   upper third and leave the body below it. Centring is the giveaway of an
   automated crop.

Looser framing also happens to fix sharpness: a 3.5x-face-height crop of a
1080p wide shot needs ~2.6x upscale instead of the ~3.5x the old cap forced,
so there is simply more real detail per output pixel. The two complaints had
one cause.
"""

from dataclasses import dataclass

FRAMING_RATIO_WIDE = 3.5
FRAMING_RATIO_TALL = 6.0
FACE_VERTICAL_POSITION = 0.35

# Never crop a region so small that filling the output means inventing most
# of the pixels. 2.6x is about where a 1080p source still holds up; beyond
# that the softness is obvious no matter what the encoder does.
MAX_UPSCALE = 2.6


@dataclass
class BBoxLike:
	x: float
	y: float
	width: float
	height: float


@dataclass
class CropRect:
	x: float
	y: float
	width: float
	height: float


def framing_ratio(aspect: float) -> float:
	"""Pane height as a multiple of face height.

	A narrow pane needs to show more of the body than a wide one or the
	subject looks cramped -- interpolate between the two measured anchors.
	"""
	lo, hi = 1.0, 16 / 9
	a = max(lo, min(hi, aspect))
	t = (a - lo) / (hi - lo)
	return FRAMING_RATIO_TALL + t * (FRAMING_RATIO_WIDE - FRAMING_RATIO_TALL)


def person_crop(
	bbox: BBoxLike,
	source_w: float,
	source_h: float,
	target_w: float,
	target_h: float,
	max_upscale: float = MAX_UPSCALE,
) -> CropRect:
	"""Crop rect framing one person for a target_w x target_h pane.

	Height comes from the face size and the measured framing ratio; width
	follows from the pane's aspect. The face is placed `FACE_VERTICAL_POSITION`
	down the crop so there is headroom above and body below.
	"""
	aspect = target_w / target_h

	crop_h = bbox.height * framing_ratio(aspect)
	crop_h = max(crop_h, target_h / max_upscale)
	crop_w = crop_h * aspect

	# Can't crop more than exists.
	if crop_w > source_w:
		crop_w = source_w
		crop_h = crop_w / aspect
	if crop_h > source_h:
		crop_h = source_h
		crop_w = crop_h * aspect

	face_cx = bbox.x + bbox.width / 2
	face_cy = bbox.y + bbox.height / 2

	left = face_cx - crop_w / 2
	top = face_cy - crop_h * FACE_VERTICAL_POSITION

	left = max(0.0, min(source_w - crop_w, left))
	top = max(0.0, min(source_h - crop_h, top))
	return CropRect(x=left, y=top, width=crop_w, height=crop_h)

import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from .faces import BBox
from .ffmpeg import FFMPEG, FFPROBE
from .framing import CropRect, person_crop

Layout = Literal["original", "zoom", "split"]

# No cap on how many people a composite can show. A four-person podcast is a
# normal case, not an edge case. What changes with speaker count is the
# *layout*, not whether they're allowed on screen: two people get a
# side-by-side split, three or more get a speaker-focus layout (the current
# speaker large, everyone else down the side).
DUO_SPLIT_MAX = 2
SPEAKER_FOCUS_MAIN_FRACTION = 0.68


@dataclass
class Keyframe:
	t: float
	bbox: BBox


@dataclass
class Track:
	id: int
	keyframes: list[Keyframe]


@dataclass
class Region:
	"""One framing decision over a stretch of the timeline.

	Deliberately *not* tied to turn boundaries. A region can start mid-turn
	and run through several, which is what lets an editor hold a close-up
	through a short interjection -- a human editor does that constantly and a
	per-turn model cannot express it at all.

	Time not covered by any region renders as the untouched wide shot, so
	"go wide here" is the absence of a region rather than a third kind of one.

	`person_ids` is who the region is about, already resolved to people by the
	UI, so the renderer never reasons about anonymous diarisation clusters.
	`source` records whether this is what the pipeline proposed or what the
	editor made it -- the difference is the only signal we have about where
	the automatic decisions are wrong.
	"""

	start: float
	end: float
	layout: Literal["zoom", "split"]
	person_ids: list[int]
	source: Literal["suggested", "user"] = "suggested"
	# Manual override from the editor's inspector; see framing.py's person_crop.
	crop_nudge: tuple[float, float] = (0.0, 0.0)


@dataclass
class RenderSegment:
	start: float
	end: float
	layout: Layout
	speaker_bboxes: list[tuple[int, BBox]]  # empty for "original"
	crop_nudge: tuple[float, float] = (0.0, 0.0)


def bust_shot_crop(
	bbox: BBox,
	source_w: float,
	source_h: float,
	target_w: float | None = None,
	target_h: float | None = None,
) -> CropRect:
	"""Crop framing one person for a target pane.

	Framing lives in framing.py now -- the numbers there were measured from
	professional podcast edits rather than guessed. The old implementation
	here cropped ~40% tighter than professionals do and centred the face
	vertically, which is what made zoomed shots look wrong on seated
	subjects.
	"""
	return person_crop(
		bbox,
		source_w,
		source_h,
		target_w if target_w is not None else source_w,
		target_h if target_h is not None else source_h,
	)


def bbox_at_time(track: Track, t: float) -> BBox:
	"""Nearest keyframe's bbox to a given time -- no interpolation, same as
	the frontend's bboxAtTime in faceCrop.ts."""
	nearest = track.keyframes[0]
	best_dist = abs(nearest.t - t)
	for kf in track.keyframes:
		d = abs(kf.t - t)
		if d < best_dist:
			nearest = kf
			best_dist = d
	return nearest.bbox


def _person(person_id: int | None, people: list[Track]) -> Track | None:
	if person_id is None:
		return None
	return next((p for p in people if p.id == person_id), None)


def build_render_segments(
	duration: float,
	regions: list[Region],
	people: list[Track],
	drop_ranges: list[tuple[float, float]] | None = None,
) -> list[RenderSegment]:
	"""Build a duration-complete list of segments covering [0, duration] minus
	any `drop_ranges` -- one per stretch of time with a single layout decision.

	With no `drop_ranges` (the default), this is gapless: the exported video
	has to stay time-aligned with the source's untouched audio track, so every
	second of the timeline needs a segment, including the stretches no region
	covers (rendered as the untouched wide shot). Dropping that time here
	would silently shorten the video relative to the audio.

	`drop_ranges` (dead air / filler words -- see pipeline/trim.py) is the one
	deliberate exception: time inside those ranges is skipped entirely rather
	than kept as an "original" filler segment. `render_export` detects the
	resulting non-contiguous segment list and builds a matching audio edit
	instead of assuming the source audio can be used untouched.
	"""
	drop_ranges = drop_ranges or []
	boundaries = {0.0, duration}
	for region in regions:
		boundaries.add(max(0.0, min(duration, region.start)))
		boundaries.add(max(0.0, min(duration, region.end)))
	for d0, d1 in drop_ranges:
		boundaries.add(max(0.0, min(duration, d0)))
		boundaries.add(max(0.0, min(duration, d1)))
	sorted_boundaries = sorted(boundaries)

	def wide(b0: float, b1: float) -> RenderSegment:
		return RenderSegment(start=b0, end=b1, layout="original", speaker_bboxes=[])

	segments: list[RenderSegment] = []
	for b0, b1 in zip(sorted_boundaries, sorted_boundaries[1:]):
		if b1 - b0 <= 1e-6:
			continue
		mid = (b0 + b1) / 2

		if any(d0 <= mid < d1 for d0, d1 in drop_ranges):
			continue  # inside a cut range -- not part of the output at all

		# Regions are not supposed to overlap -- the editor keeps them
		# disjoint -- but if two ever do, the later one wins rather than the
		# result depending on list order.
		covering = [r for r in regions if r.start <= mid < r.end]
		region = max(covering, key=lambda r: r.start) if covering else None

		if region is None:
			segments.append(wide(b0, b1))
			continue

		bboxes = [
			(person_id, bbox_at_time(person, b0))
			for person_id in region.person_ids
			if (person := _person(person_id, people)) is not None
		]

		if not bboxes:
			# The region names nobody we can actually find a face for. Wide is
			# the honest result: a close-up on a person we can't locate isn't
			# available at any price.
			segments.append(wide(b0, b1))
			continue

		if region.layout == "split" and len(bboxes) >= 2:
			segments.append(
				RenderSegment(start=b0, end=b1, layout="split", speaker_bboxes=bboxes, crop_nudge=region.crop_nudge)
			)
			continue

		# Either a close-up, or a "both on screen" with only one person
		# findable -- close on whoever that is, rather than refusing.
		segments.append(
			RenderSegment(start=b0, end=b1, layout="zoom", speaker_bboxes=bboxes[:1], crop_nudge=region.crop_nudge)
		)

	return _merge_adjacent(segments)


def _merge_adjacent(segments: list[RenderSegment]) -> list[RenderSegment]:
	"""Merge consecutive segments with an identical layout decision -- avoids
	pointless re-encode boundaries. Mostly not a correctness requirement, just
	fewer filter-graph nodes for ffmpeg to chew through -- except the adjacency
	check below, which is: without `drop_ranges` two segments in this list are
	always time-adjacent already (the boundary-pair loop above guarantees it),
	but a dropped range can leave two same-layout segments in the list with a
	real gap between them. Merging those on layout equality alone would splice
	across the cut, silently keeping the dropped time in the output -- exactly
	the bug this exists to avoid."""
	if not segments:
		return []
	merged = [segments[0]]
	for seg in segments[1:]:
		last = merged[-1]
		if (
			last.layout == seg.layout
			and last.speaker_bboxes == seg.speaker_bboxes
			and last.crop_nudge == seg.crop_nudge
			and abs(last.end - seg.start) <= 1e-6
		):
			merged[-1] = RenderSegment(
				start=last.start,
				end=seg.end,
				layout=last.layout,
				speaker_bboxes=last.speaker_bboxes,
				crop_nudge=last.crop_nudge,
			)
		else:
			merged.append(seg)
	return merged


def _fmt(x: float) -> str:
	return f"{x:.3f}"


def _crop_scale(src_label: str, crop: CropRect, out_w: int, out_h: int, out_label: str, sharpen: bool) -> str:
	"""crop -> scale -> (optional) mild sharpen. Lanczos is noticeably crisper
	than the default bicubic when upscaling, which every cropped layout does."""
	chain = (
		f"[{src_label}]crop={round(crop.width)}:{round(crop.height)}:{round(crop.x)}:{round(crop.y)},"
		f"scale={out_w}:{out_h}:flags=lanczos"
	)
	if sharpen:
		chain += f",{SHARPEN_FILTER}"
	return f"{chain},setsar=1[{out_label}]"


def _segment_filter(i: int, seg: RenderSegment, frame_w: int, frame_h: int) -> str:
	trim = f"[0:v]trim=start={_fmt(seg.start)}:end={_fmt(seg.end)},setpts=PTS-STARTPTS"

	if seg.layout == "original" or not seg.speaker_bboxes:
		# Untouched full frame -- no crop, so no upscale and nothing to sharpen.
		return f"{trim},scale={frame_w}:{frame_h}:flags=lanczos,setsar=1[v{i}]"

	if seg.layout == "zoom" or len(seg.speaker_bboxes) == 1:
		_, bbox = seg.speaker_bboxes[0]
		crop = person_crop(bbox, frame_w, frame_h, frame_w, frame_h, nudge=seg.crop_nudge)
		parts = [f"{trim}[seg{i}]", _crop_scale(f"seg{i}", crop, frame_w, frame_h, f"v{i}", True)]
		return ";".join(parts)

	n = len(seg.speaker_bboxes)
	parts = [f"{trim}[seg{i}]", f"[seg{i}]split={n}" + "".join(f"[seg{i}p{p}]" for p in range(n))]

	if n <= DUO_SPLIT_MAX:
		# Two people: side-by-side medium shots.
		pane_w = frame_w // n
		labels = []
		for p, (_, bbox) in enumerate(seg.speaker_bboxes):
			crop = person_crop(bbox, frame_w, frame_h, pane_w, frame_h, nudge=seg.crop_nudge)
			parts.append(_crop_scale(f"seg{i}p{p}", crop, pane_w, frame_h, f"pane{i}_{p}", True))
			labels.append(f"[pane{i}_{p}]")
		parts.append(f"{''.join(labels)}hstack=inputs={n}[stacked{i}]")
	else:
		# Three or more: the speaker large on the left, everyone else stacked
		# down the right. Splitting a 16:9 frame into N equal columns gives
		# absurdly narrow slivers past two people; this keeps the person
		# actually talking at a watchable size.
		others = n - 1
		side_w = frame_w - int(frame_w * SPEAKER_FOCUS_MAIN_FRACTION)
		side_h = frame_h // others
		# hstack needs both columns the same height, so the main pane matches
		# the stacked total rather than frame_h (which may not divide evenly).
		column_h = side_h * others
		main_w = frame_w - side_w

		_, main_bbox = seg.speaker_bboxes[0]
		crop = person_crop(main_bbox, frame_w, frame_h, main_w, column_h, nudge=seg.crop_nudge)
		parts.append(_crop_scale(f"seg{i}p0", crop, main_w, column_h, f"main{i}", True))

		labels = []
		for p, (_, bbox) in enumerate(seg.speaker_bboxes[1:], start=1):
			crop = person_crop(bbox, frame_w, frame_h, side_w, side_h, nudge=seg.crop_nudge)
			parts.append(_crop_scale(f"seg{i}p{p}", crop, side_w, side_h, f"side{i}_{p}", True))
			labels.append(f"[side{i}_{p}]")
		parts.append(f"{''.join(labels)}vstack=inputs={others}[sidecol{i}]")
		parts.append(f"[main{i}][sidecol{i}]hstack=inputs=2[stacked{i}]")

	parts.append(f"[stacked{i}]scale={frame_w}:{frame_h}:flags=lanczos,setsar=1[v{i}]")
	return ";".join(parts)


# Cropping forces a real video re-encode -- there is no way to avoid one
# generation of loss. So the encode has to be good enough that it isn't the
# thing that degrades the footage. Measured against a pristine 14 Mbps 1080p
# source from a real recording, CRF 16 scored SSIM 0.986; CRF 14 buys back
# most of the remaining gap for a modest size increase, and large files are
# acceptable here while quality loss is not.
VIDEO_CRF = "14"
VIDEO_PRESET = "medium"

# Fallback only. Audio content is never modified (no cuts, no ducking), so
# when the source codec can be remuxed into MP4 as-is it is stream-copied
# instead -- bit-identical, zero generation loss. Real recordings are almost
# always already AAC, which copies cleanly; this bitrate only applies to the
# formats that can't (PCM off some pro gear, for instance).
AUDIO_BITRATE = "320k"
MP4_SAFE_AUDIO_CODECS = {"aac", "mp3", "alac", "ac3", "eac3"}

# Mild. Cropped layouts always upscale, and a little sharpening restores the
# edge definition upscaling costs. Deliberately restrained -- heavier settings
# produce halos that look worse than the softness they fix.
SHARPEN_FILTER = "unsharp=5:5:0.5:5:5:0.0"


def _source_audio_codec(input_path: Path) -> str | None:
	try:
		out = subprocess.run(
			[
				FFPROBE, "-v", "error", "-select_streams", "a:0",
				"-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1",
				str(input_path),
			],
			check=True, capture_output=True, text=True,
		)
		return (out.stdout or "").strip() or None
	except subprocess.CalledProcessError:
		return None


def _audio_args(input_path: Path) -> list[str]:
	"""Stream-copy the audio when the container allows it; only re-encode as
	a fallback. Copying is bit-identical -- when nothing is cut, the audio is
	never edited, so there is no reason to pay a generation of loss for it.
	Not used when segments are non-contiguous (dead-air/filler trimming) --
	see `_segments_are_contiguous` and `render_export`, where a real audio
	edit forces a real encode."""
	codec = _source_audio_codec(input_path)
	if codec is None:
		return []
	if codec in MP4_SAFE_AUDIO_CODECS:
		return ["-c:a", "copy"]
	return ["-c:a", "aac", "-b:a", AUDIO_BITRATE]


def _segments_are_contiguous(segments: list[RenderSegment], duration: float) -> bool:
	"""Whether the segment list covers the full [0, duration] with no gaps --
	true for every export except one where drop_ranges (pipeline/trim.py)
	actually cut something. Checks both the internal gaps between segments
	*and* the outer edges: a drop_range at the very start or end of the video
	leaves the remaining segments mutually adjacent to each other, so an
	internal-only check would miss it and wrongly take the untouched-audio
	path below. The segments list (plus duration) is the source of truth for
	this, rather than a separate flag threaded through from the caller --
	whatever built the list is what knows whether a drop happened, and this
	only cares about the result."""
	if not segments:
		return duration <= 1e-6
	if abs(segments[0].start) > 1e-6 or abs(segments[-1].end - duration) > 1e-6:
		return False
	return all(abs(a.end - b.start) <= 1e-6 for a, b in zip(segments, segments[1:]))


@lru_cache(maxsize=1)
@lru_cache
def has_ass_filter() -> bool:
	"""Whether this ffmpeg can burn in subtitles at all.

	Cached: FFMPEG is resolved from the environment at import time, so the
	answer cannot change while the process runs, and /health is polled every
	two seconds by the setup gate -- one `ffmpeg -filters` subprocess per
	poll is pure waste.

	Homebrew's regular `ffmpeg` formula is built without libass -- and without
	freetype, so `drawtext` is not a fallback either -- which means a plain
	`brew install ffmpeg` (what the README asks for) cannot render text onto a
	frame. That is the normal state of a macOS install, not a broken one, so
	callers check this *before* starting a render: finding out at the end of a
	15-minute export is the difference between an error and a wasted evening.
	"""
	try:
		out = subprocess.run(
			[FFMPEG, "-hide_banner", "-filters"], check=True, capture_output=True, text=True
		)
	except (subprocess.CalledProcessError, FileNotFoundError, OSError):
		return False
	# Lines are "  <flags> <name> <in>-><out>  <description>".
	return any(parts[1] == "ass" for line in out.stdout.splitlines() if len(parts := line.split()) > 1)


def _escape_filter_path(path: Path) -> str:
	"""Escape a filesystem path for use as an ffmpeg filtergraph argument.
	The filter parser treats `\\`, `:` and `'` specially even inside quotes,
	so all three need escaping before wrapping the result in single quotes."""
	escaped = str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
	return f"'{escaped}'"


def render_export(
	input_path: Path,
	output_path: Path,
	segments: list[RenderSegment],
	frame_w: int,
	frame_h: int,
	duration: float,
	ass_path: Path | None = None,
) -> None:
	"""One ffmpeg invocation, one filter_complex graph: each segment gets its
	own trim+crop+scale filter chain, all segments concat back into a single
	video stream. Captions, when requested, are burned in as a last filter
	step on the concatenated stream rather than per-segment -- one filter
	application instead of one per segment, and cue timing is independent of
	segment boundaries anyway.

	Audio takes one of two paths. The common case -- no dead-air/filler
	trimming, `segments` gapless and duration-complete -- muxes the source's
	original audio track untouched (stream-copied rather than re-encoded
	whenever the source codec can live in an MP4, so it comes through
	bit-identical: nothing was cut, so there's no reason to pay a generation
	of loss for it). When `segments` has gaps (pipeline/trim.py cut something),
	the audio needs the exact same cuts or it drifts out of sync with the
	video almost immediately -- so it gets its own trim+concat filter chain
	mirroring the video one, which forces a real re-encode."""
	filter_parts = [_segment_filter(i, seg, frame_w, frame_h) for i, seg in enumerate(segments)]
	concat_inputs = "".join(f"[v{i}]" for i in range(len(segments)))
	concat_label = "vconcat" if ass_path is not None else "vout"
	filter_complex = ";".join(filter_parts) + f";{concat_inputs}concat=n={len(segments)}:v=1:a=0[{concat_label}]"
	if ass_path is not None:
		filter_complex += f";[{concat_label}]ass=filename={_escape_filter_path(ass_path)}[vout]"

	trimmed_audio = not _segments_are_contiguous(segments, duration)
	if trimmed_audio:
		audio_parts = [
			f"[0:a]atrim=start={_fmt(seg.start)}:end={_fmt(seg.end)},asetpts=PTS-STARTPTS[a{i}]"
			for i, seg in enumerate(segments)
		]
		audio_inputs = "".join(f"[a{i}]" for i in range(len(segments)))
		filter_complex += (
			";" + ";".join(audio_parts) + f";{audio_inputs}concat=n={len(segments)}:v=0:a=1[aout]"
		)

	cmd = [
		FFMPEG,
		"-y",
		"-i", str(input_path),
		"-filter_complex", filter_complex,
		"-map", "[vout]",
		"-c:v", "libx264",
		"-preset", VIDEO_PRESET,
		"-crf", VIDEO_CRF,
	]
	if trimmed_audio:
		cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", AUDIO_BITRATE]
	else:
		cmd += ["-map", "0:a?", *_audio_args(input_path)]
	cmd += ["-movflags", "+faststart", str(output_path)]
	subprocess.run(cmd, check=True, capture_output=True)

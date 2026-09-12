import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from .faces import BBox
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
class LayoutChoice:
	"""One per turn. `start`/`end` are the turn's own time range -- needed
	here (not just the turn index) because the render step has to place this
	choice on the shared timeline alongside overlap windows and gaps."""

	turn_index: int
	# Who is actually on screen for this turn. Resolved in the UI (diarisation
	# suggests it, the user can override any turn), so the renderer never has
	# to reason about anonymous diarisation clusters. None = nobody is
	# assigned, which renders as the untouched wide shot.
	person_id: int | None
	start: float
	end: float
	default_layout: Literal["original", "zoom"]
	final_layout: Layout


@dataclass
class OverlapSegment:
	"""A stretch where more than one person is talking, already resolved to
	people rather than diarisation speakers."""

	start: float
	end: float
	person_ids: list[int]


@dataclass
class RenderSegment:
	start: float
	end: float
	layout: Layout
	speaker_bboxes: list[tuple[int, BBox]]  # empty for "original"


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


def _fallback_second_person(
	exclude_person_id: int | None,
	before: float,
	layout_choices: list[LayoutChoice],
	people: list[Track],
) -> tuple[int, Track] | None:
	"""For a turn manually forced to "split" with no real overlap: whichever
	*other* person most recently had a turn before this point."""
	candidates = [
		lc
		for lc in layout_choices
		if lc.person_id is not None and lc.person_id != exclude_person_id and lc.end <= before
	]
	if not candidates:
		return None
	nearest = max(candidates, key=lambda lc: lc.end)
	person = _person(nearest.person_id, people)
	if person is None or nearest.person_id is None:
		return None
	return nearest.person_id, person


def build_render_segments(
	duration: float,
	overlap_segments: list[OverlapSegment],
	layout_choices: list[LayoutChoice],
	people: list[Track],
) -> list[RenderSegment]:
	"""Build a gapless, duration-complete list of segments covering
	[0, duration] -- one per stretch of time with a single layout decision.

	Gapless matters: the exported video has to stay time-aligned with the
	source's untouched audio track, so every second of the timeline needs a
	segment, including the pauses/silence *between* turns (rendered as the
	untouched wide shot) -- not just the seconds a turn or overlap explicitly
	covers. Dropping gap time here would silently shorten the video relative
	to the audio.
	"""
	boundaries = {0.0, duration}
	for lc in layout_choices:
		boundaries.add(max(0.0, min(duration, lc.start)))
		boundaries.add(max(0.0, min(duration, lc.end)))
	for ov in overlap_segments:
		boundaries.add(max(0.0, min(duration, ov.start)))
		boundaries.add(max(0.0, min(duration, ov.end)))
	sorted_boundaries = sorted(boundaries)

	segments: list[RenderSegment] = []
	for b0, b1 in zip(sorted_boundaries, sorted_boundaries[1:]):
		if b1 - b0 <= 1e-6:
			continue
		mid = (b0 + b1) / 2

		overlap = next((ov for ov in overlap_segments if ov.start <= mid < ov.end), None)
		turn = next((lc for lc in layout_choices if lc.start <= mid < lc.end), None)

		if overlap is not None:
			bboxes = []
			for person_id in overlap.person_ids:
				person = _person(person_id, people)
				if person is not None:
					bboxes.append((person_id, bbox_at_time(person, b0)))
			if len(bboxes) >= 2:
				segments.append(RenderSegment(start=b0, end=b1, layout="split", speaker_bboxes=bboxes))
				continue
			# Nobody recognisable in this overlap -- fall through to the turn.

		if turn is not None:
			if turn.final_layout == "zoom":
				person = _person(turn.person_id, people)
				if person is not None and turn.person_id is not None:
					segments.append(
						RenderSegment(
							start=b0,
							end=b1,
							layout="zoom",
							speaker_bboxes=[(turn.person_id, bbox_at_time(person, b0))],
						)
					)
					continue
				segments.append(RenderSegment(start=b0, end=b1, layout="original", speaker_bboxes=[]))
				continue

			if turn.final_layout == "split":
				own = _person(turn.person_id, people)
				bboxes = (
					[(turn.person_id, bbox_at_time(own, b0))]
					if own is not None and turn.person_id is not None
					else []
				)
				second = _fallback_second_person(turn.person_id, b0, layout_choices, people)
				if second is not None:
					second_id, second_person = second
					bboxes.append((second_id, bbox_at_time(second_person, b0)))
				if len(bboxes) >= 2:
					segments.append(RenderSegment(start=b0, end=b1, layout="split", speaker_bboxes=bboxes))
				elif len(bboxes) == 1:
					segments.append(RenderSegment(start=b0, end=b1, layout="zoom", speaker_bboxes=bboxes))
				else:
					segments.append(RenderSegment(start=b0, end=b1, layout="original", speaker_bboxes=[]))
				continue

			segments.append(RenderSegment(start=b0, end=b1, layout="original", speaker_bboxes=[]))
			continue

		# No turn and no overlap covers this stretch -- a gap (silence/pause).
		segments.append(RenderSegment(start=b0, end=b1, layout="original", speaker_bboxes=[]))

	return _merge_adjacent(segments)


def _merge_adjacent(segments: list[RenderSegment]) -> list[RenderSegment]:
	"""Merge consecutive segments with an identical layout decision -- avoids
	pointless re-encode boundaries. Not a correctness requirement, just
	fewer filter-graph nodes for ffmpeg to chew through."""
	if not segments:
		return []
	merged = [segments[0]]
	for seg in segments[1:]:
		last = merged[-1]
		if last.layout == seg.layout and last.speaker_bboxes == seg.speaker_bboxes:
			merged[-1] = RenderSegment(
				start=last.start, end=seg.end, layout=last.layout, speaker_bboxes=last.speaker_bboxes
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
		crop = person_crop(bbox, frame_w, frame_h, frame_w, frame_h)
		parts = [f"{trim}[seg{i}]", _crop_scale(f"seg{i}", crop, frame_w, frame_h, f"v{i}", True)]
		return ";".join(parts)

	n = len(seg.speaker_bboxes)
	parts = [f"{trim}[seg{i}]", f"[seg{i}]split={n}" + "".join(f"[seg{i}p{p}]" for p in range(n))]

	if n <= DUO_SPLIT_MAX:
		# Two people: side-by-side medium shots.
		pane_w = frame_w // n
		labels = []
		for p, (_, bbox) in enumerate(seg.speaker_bboxes):
			crop = person_crop(bbox, frame_w, frame_h, pane_w, frame_h)
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
		crop = person_crop(main_bbox, frame_w, frame_h, main_w, column_h)
		parts.append(_crop_scale(f"seg{i}p0", crop, main_w, column_h, f"main{i}", True))

		labels = []
		for p, (_, bbox) in enumerate(seg.speaker_bboxes[1:], start=1):
			crop = person_crop(bbox, frame_w, frame_h, side_w, side_h)
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
				"ffprobe", "-v", "error", "-select_streams", "a:0",
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
	a fallback. Copying is bit-identical -- the audio is never edited, so
	there is no reason to pay a generation of loss for it."""
	codec = _source_audio_codec(input_path)
	if codec is None:
		return []
	if codec in MP4_SAFE_AUDIO_CODECS:
		return ["-c:a", "copy"]
	return ["-c:a", "aac", "-b:a", AUDIO_BITRATE]


@lru_cache(maxsize=1)
def has_ass_filter() -> bool:
	"""Whether this ffmpeg can burn in subtitles at all.

	Homebrew's regular `ffmpeg` formula is built without libass -- and without
	freetype, so `drawtext` is not a fallback either -- which means a plain
	`brew install ffmpeg` (what the README asks for) cannot render text onto a
	frame. That is the normal state of a macOS install, not a broken one, so
	callers check this *before* starting a render: finding out at the end of a
	15-minute export is the difference between an error and a wasted evening.
	"""
	try:
		out = subprocess.run(
			["ffmpeg", "-hide_banner", "-filters"], check=True, capture_output=True, text=True
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
	ass_path: Path | None = None,
) -> None:
	"""One ffmpeg invocation, one filter_complex graph: each segment gets its
	own trim+crop+scale filter chain, all segments concat back into a single
	video stream the same total length as the source, then muxed with the
	source's original audio track (untouched content -- no ducking, no
	trimming -- and stream-copied rather than re-encoded whenever the source
	codec can live in an MP4, so audio comes through bit-identical). Captions,
	when requested, are burned in as a last filter step on the concatenated
	stream rather than per-segment -- one filter application instead of one
	per segment, and cue timing is independent of segment boundaries anyway."""
	filter_parts = [_segment_filter(i, seg, frame_w, frame_h) for i, seg in enumerate(segments)]
	concat_inputs = "".join(f"[v{i}]" for i in range(len(segments)))
	concat_label = "vconcat" if ass_path is not None else "vout"
	filter_complex = ";".join(filter_parts) + f";{concat_inputs}concat=n={len(segments)}:v=1:a=0[{concat_label}]"
	if ass_path is not None:
		filter_complex += f";[{concat_label}]ass=filename={_escape_filter_path(ass_path)}[vout]"

	cmd = [
		"ffmpeg",
		"-y",
		"-i", str(input_path),
		"-filter_complex", filter_complex,
		"-map", "[vout]",
		"-map", "0:a?",
		"-c:v", "libx264",
		"-preset", VIDEO_PRESET,
		"-crf", VIDEO_CRF,
		*_audio_args(input_path),
		"-movflags", "+faststart",
		str(output_path),
	]
	subprocess.run(cmd, check=True, capture_output=True)

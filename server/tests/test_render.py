"""Tests for the render pipeline's pure logic: crop math and segment
construction. No ffmpeg subprocess calls here -- that's exercised manually
against a real file (see docs/TECHNICAL_ARCHITECTURE.md §8); these tests
cover the parts that silently produce a wrong-but-not-crashing result if
they're wrong, which is the real risk in this code."""

import pytest

from pipeline.faces import BBox
from pipeline.framing import MAX_UPSCALE, person_crop
from pipeline.render import (
	Keyframe,
	LayoutChoice,
	OverlapSegment,
	Track,
	build_render_segments,
)

FRAME_W, FRAME_H = 1280, 720


class TestFraming:
	"""Framing constants are measured from professional podcast edits (see
	pipeline/framing.py). These tests pin the properties that matter rather
	than exact pixel values, so tuning the ratios doesn't spuriously fail."""

	FRAME_W, FRAME_H = 1920, 1080

	# Face sizes measured off the real four-person test footage.
	REAL_FACES = [
		BBox(x=190, y=216, width=81, height=112),
		BBox(x=751, y=235, width=66, height=93),
		BBox(x=1128, y=245, width=56, height=92),
		BBox(x=1617, y=177, width=81, height=123),
	]

	def test_crop_is_a_medium_shot_not_a_face_closeup(self):
		"""The old implementation cropped ~2.5x face height and looked like a
		head shot. Professionals frame a single speaker at ~3.5x."""
		for bbox in self.REAL_FACES:
			crop = person_crop(bbox, self.FRAME_W, self.FRAME_H, self.FRAME_W, self.FRAME_H)
			assert crop.height / bbox.height >= 3.0, "crop is too tight to read as a medium shot"

	def test_face_sits_in_upper_third_not_centred(self):
		"""Centring the face vertically is the giveaway of an automated crop;
		real edits leave headroom above and body below."""
		for bbox in self.REAL_FACES:
			crop = person_crop(bbox, self.FRAME_W, self.FRAME_H, self.FRAME_W, self.FRAME_H)
			face_cy = bbox.y + bbox.height / 2
			if crop.y <= 0 or crop.y + crop.height >= self.FRAME_H:
				continue  # clamped against a frame edge; position is forced
			relative = (face_cy - crop.y) / crop.height
			assert 0.25 <= relative <= 0.45, f"face at {relative:.2f} of crop height, want upper third"

	def test_crop_never_leaves_the_source_frame(self):
		for bbox in self.REAL_FACES:
			for tw, th in [(self.FRAME_W, self.FRAME_H), (self.FRAME_W // 2, self.FRAME_H), (400, 360)]:
				crop = person_crop(bbox, self.FRAME_W, self.FRAME_H, tw, th)
				assert crop.x >= -1e-6
				assert crop.y >= -1e-6
				assert crop.x + crop.width <= self.FRAME_W + 1e-6
				assert crop.y + crop.height <= self.FRAME_H + 1e-6

	def test_upscale_is_bounded(self):
		"""Sharpness guard: cropping a tiny region and blowing it up to fill
		the output is what made zoomed shots soft."""
		for bbox in self.REAL_FACES:
			crop = person_crop(bbox, self.FRAME_W, self.FRAME_H, self.FRAME_W, self.FRAME_H)
			assert self.FRAME_W / crop.width <= MAX_UPSCALE + 1e-6

	def test_narrow_pane_shows_more_body_than_a_wide_one(self):
		bbox = self.REAL_FACES[0]
		wide = person_crop(bbox, self.FRAME_W, self.FRAME_H, self.FRAME_W, self.FRAME_H)
		narrow = person_crop(bbox, self.FRAME_W, self.FRAME_H, self.FRAME_W // 3, self.FRAME_H)
		assert narrow.height / bbox.height > wide.height / bbox.height


def _track(id_: int, bbox: BBox, t: float = 0.0) -> Track:
	return Track(id=id_, keyframes=[Keyframe(t=t, bbox=bbox)])


BBOX_A = BBox(x=50, y=50, width=100, height=100)
BBOX_B = BBox(x=900, y=50, width=100, height=100)
BBOX_C = BBox(x=500, y=400, width=100, height=100)


class TestBuildRenderSegments:
	def test_gapless_and_duration_complete(self):
		tracks = [_track(0, BBOX_A)]
		layout_choices = [LayoutChoice(0, 0, 0.0, 2.0, "zoom", "zoom")]
		segments = build_render_segments(10.0, [], layout_choices, tracks)

		assert segments[0].start == 0.0
		assert segments[-1].end == 10.0
		for a, b in zip(segments, segments[1:]):
			assert a.end == b.start, "segments must be contiguous, no gaps"

	def test_gap_between_turns_renders_as_original(self):
		tracks = [_track(0, BBOX_A)]
		layout_choices = [
			LayoutChoice(0, 0, 0.0, 2.0, "zoom", "zoom"),
			LayoutChoice(1, 0, 5.0, 7.0, "zoom", "zoom"),
		]
		segments = build_render_segments(10.0, [], layout_choices, tracks)
		gap = next(s for s in segments if s.start == 2.0)
		assert gap.layout == "original"
		assert gap.end == 5.0

	def test_unmatched_speaker_falls_back_to_original(self):
		layout_choices = [LayoutChoice(0, 0, 0.0, 5.0, "zoom", "zoom")]
		segments = build_render_segments(5.0, [], layout_choices, [])
		assert len(segments) == 1
		assert segments[0].layout == "original"

	def test_overlap_window_produces_split_with_correct_speakers(self):
		tracks = [_track(0, BBOX_A), _track(1, BBOX_B)]
		layout_choices = [
			LayoutChoice(0, 0, 0.0, 5.0, "zoom", "zoom"),
			LayoutChoice(1, 1, 3.0, 8.0, "zoom", "zoom"),
		]
		overlap = [OverlapSegment(start=3.0, end=5.0, person_ids=[0, 1])]
		segments = build_render_segments(8.0, overlap, layout_choices, tracks)

		split_seg = next(s for s in segments if s.layout == "split")
		assert split_seg.start == 3.0 and split_seg.end == 5.0
		assert {sp for sp, _ in split_seg.speaker_bboxes} == {0, 1}

	def test_overlap_spanning_a_turn_boundary_cuts_correctly(self):
		# Turn 0 is speaker A alone 0-4s; turn 1 is speaker B alone 4-8s;
		# but the two actually overlap 3-5s (diarization/turn merging is
		# imperfect at exactly this kind of boundary -- see turns.py).
		tracks = [_track(0, BBOX_A), _track(1, BBOX_B)]
		layout_choices = [
			LayoutChoice(0, 0, 0.0, 4.0, "zoom", "zoom"),
			LayoutChoice(1, 1, 4.0, 8.0, "zoom", "zoom"),
		]
		overlap = [OverlapSegment(start=3.0, end=5.0, person_ids=[0, 1])]
		segments = build_render_segments(8.0, overlap, layout_choices, tracks)

		layouts_in_order = [(s.start, s.end, s.layout) for s in segments]
		assert (0.0, 3.0, "zoom") in layouts_in_order
		assert (3.0, 5.0, "split") in layouts_in_order
		assert (5.0, 8.0, "zoom") in layouts_in_order

	def test_overlap_window_with_unmapped_speaker_falls_back_to_turn(self):
		# Only speaker 0 has a mapped face; overlap says [0, 1] but speaker 1
		# has no track -- can't build a 2-pane composite, fall back to
		# whatever the underlying turn (zoom on speaker 0) says.
		tracks = [_track(0, BBOX_A)]
		layout_choices = [LayoutChoice(0, 0, 0.0, 5.0, "zoom", "zoom")]
		overlap = [OverlapSegment(start=1.0, end=3.0, person_ids=[0, 1])]
		segments = build_render_segments(5.0, overlap, layout_choices, tracks)

		mid_segment = next(s for s in segments if s.start <= 2.0 < s.end)
		assert mid_segment.layout == "zoom"

	def test_forced_split_with_no_overlap_uses_second_most_recent_speaker(self):
		tracks = [_track(0, BBOX_A), _track(1, BBOX_B)]
		layout_choices = [
			LayoutChoice(0, 1, 0.0, 2.0, "zoom", "zoom"),  # speaker 1 talks first
			LayoutChoice(1, 0, 2.0, 5.0, "zoom", "split"),  # then speaker 0, forced split
		]
		segments = build_render_segments(5.0, [], layout_choices, tracks)

		forced = next(s for s in segments if s.start == 2.0)
		assert forced.layout == "split"
		assert {sp for sp, _ in forced.speaker_bboxes} == {0, 1}

	def test_forced_split_with_no_other_speaker_available_falls_back_to_zoom(self):
		tracks = [_track(0, BBOX_A)]
		layout_choices = [LayoutChoice(0, 0, 0.0, 5.0, "zoom", "split")]
		segments = build_render_segments(5.0, [], layout_choices, tracks)
		assert len(segments) == 1
		assert segments[0].layout == "zoom"

	def test_forced_split_with_no_mapped_face_at_all_falls_back_to_original(self):
		layout_choices = [LayoutChoice(0, 0, 0.0, 5.0, "original", "split")]
		segments = build_render_segments(5.0, [], layout_choices, [])
		assert len(segments) == 1
		assert segments[0].layout == "original"

	def test_overlap_is_not_capped(self):
		tracks = [_track(0, BBOX_A), _track(1, BBOX_B), _track(2, BBOX_C), _track(3, BBOX_A)]
		layout_choices = [LayoutChoice(0, 0, 0.0, 5.0, "zoom", "zoom")]
		overlap = [OverlapSegment(start=0.0, end=5.0, person_ids=[0, 1, 2, 3])]
		segments = build_render_segments(5.0, overlap, layout_choices, tracks)
		# A four-person podcast is a normal case, not an edge case -- everyone
		# who is actually talking gets on screen. The layout adapts (speaker
		# focus rather than four narrow columns); the roster is not truncated.
		assert len(segments[0].speaker_bboxes) == 4

	def test_back_to_back_turns_no_gap_merge_only_when_identical(self):
		tracks = [_track(0, BBOX_A)]
		layout_choices = [
			LayoutChoice(0, 0, 0.0, 2.0, "zoom", "zoom"),
			LayoutChoice(1, 0, 2.0, 4.0, "zoom", "zoom"),
		]
		segments = build_render_segments(4.0, [], layout_choices, tracks)
		# Same speaker, same bbox (single keyframe) -> merges into one segment.
		assert len(segments) == 1
		assert segments[0].start == 0.0 and segments[0].end == 4.0

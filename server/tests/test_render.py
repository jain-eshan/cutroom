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
	Region,
	RenderSegment,
	Track,
	_segments_are_contiguous,
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

	def test_a_nudge_shifts_the_crop_by_that_fraction_of_its_own_size(self):
		# Away from any edge, so the shift isn't swallowed by the clamp --
		# REAL_FACES are all close enough to the frame edge that their crop
		# already sits clamped at 0, which would pass this test vacuously.
		bbox = BBox(x=900, y=400, width=80, height=110)
		plain = person_crop(bbox, self.FRAME_W, self.FRAME_H, self.FRAME_W, self.FRAME_H)
		nudged = person_crop(bbox, self.FRAME_W, self.FRAME_H, self.FRAME_W, self.FRAME_H, nudge=(0.1, 0.0))
		assert nudged.x == pytest.approx(plain.x + 0.1 * plain.width)
		assert nudged.y == plain.y
		assert nudged.width == plain.width and nudged.height == plain.height

	def test_a_nudge_cannot_push_the_crop_off_the_source_frame(self):
		# A face right at the corner, nudged further toward it: the edge
		# clamp -- the same one an un-nudged crop already relies on -- has to
		# win, or the inspector's nudge control could produce an invalid crop.
		edge_bbox = BBox(x=0, y=0, width=80, height=110)
		nudged = person_crop(edge_bbox, self.FRAME_W, self.FRAME_H, self.FRAME_W, self.FRAME_H, nudge=(-1.0, -1.0))
		assert nudged.x >= 0
		assert nudged.y >= 0


def _track(id_: int, bbox: BBox, t: float = 0.0) -> Track:
	return Track(id=id_, keyframes=[Keyframe(t=t, bbox=bbox)])


BBOX_A = BBox(x=50, y=50, width=100, height=100)
BBOX_B = BBox(x=900, y=50, width=100, height=100)
BBOX_C = BBox(x=500, y=400, width=100, height=100)


class TestBuildRenderSegments:
	"""Framing is a list of regions over the timeline, independent of turn
	boundaries. Anything no region covers renders as the untouched wide shot,
	so "go wide here" is the absence of a region, not a third kind of one."""

	def test_gapless_and_duration_complete(self):
		tracks = [_track(0, BBOX_A)]
		regions = [Region(0.0, 2.0, "zoom", [0])]
		segments = build_render_segments(10.0, regions, tracks)

		assert segments[0].start == 0.0
		assert segments[-1].end == 10.0
		for a, b in zip(segments, segments[1:]):
			assert a.end == b.start, "segments must be contiguous, no gaps"

	def test_uncovered_time_renders_wide(self):
		tracks = [_track(0, BBOX_A)]
		regions = [Region(0.0, 2.0, "zoom", [0]), Region(5.0, 7.0, "zoom", [0])]
		segments = build_render_segments(10.0, regions, tracks)
		gap = next(s for s in segments if s.start == 2.0)
		assert gap.layout == "original"
		assert gap.end == 5.0

	def test_region_naming_a_person_with_no_face_renders_wide(self):
		# A close-up on somebody we never located isn't available at any
		# price; wide is the honest result rather than a crash or a guess.
		regions = [Region(0.0, 5.0, "zoom", [0])]
		segments = build_render_segments(5.0, regions, [])
		assert len(segments) == 1
		assert segments[0].layout == "original"

	def test_split_region_puts_everyone_named_on_screen(self):
		tracks = [_track(0, BBOX_A), _track(1, BBOX_B)]
		regions = [Region(3.0, 5.0, "split", [0, 1])]
		segments = build_render_segments(8.0, regions, tracks)

		split_seg = next(s for s in segments if s.layout == "split")
		assert split_seg.start == 3.0 and split_seg.end == 5.0
		assert {sp for sp, _ in split_seg.speaker_bboxes} == {0, 1}

	def test_regions_cut_exactly_where_they_say(self):
		# A region deliberately spanning what used to be a turn boundary: the
		# whole point of the model is that framing need not agree with turns.
		tracks = [_track(0, BBOX_A), _track(1, BBOX_B)]
		regions = [
			Region(0.0, 3.0, "zoom", [0]),
			Region(3.0, 5.0, "split", [0, 1]),
			Region(5.0, 8.0, "zoom", [1]),
		]
		segments = build_render_segments(8.0, regions, tracks)

		layouts_in_order = [(s.start, s.end, s.layout) for s in segments]
		assert (0.0, 3.0, "zoom") in layouts_in_order
		assert (3.0, 5.0, "split") in layouts_in_order
		assert (5.0, 8.0, "zoom") in layouts_in_order

	def test_split_with_only_one_findable_person_closes_on_them(self):
		# Handoff `7d`, "forced split, one person": fall back to a close-up on
		# whoever is actually there rather than refusing the region.
		tracks = [_track(0, BBOX_A)]
		regions = [Region(1.0, 3.0, "split", [0, 1])]
		segments = build_render_segments(5.0, regions, tracks)

		mid_segment = next(s for s in segments if s.start <= 2.0 < s.end)
		assert mid_segment.layout == "zoom"
		assert [sp for sp, _ in mid_segment.speaker_bboxes] == [0]

	def test_split_with_nobody_findable_renders_wide(self):
		regions = [Region(0.0, 5.0, "split", [0, 1])]
		segments = build_render_segments(5.0, regions, [])
		assert len(segments) == 1
		assert segments[0].layout == "original"

	def test_a_region_is_not_capped(self):
		tracks = [_track(0, BBOX_A), _track(1, BBOX_B), _track(2, BBOX_C), _track(3, BBOX_A)]
		regions = [Region(0.0, 5.0, "split", [0, 1, 2, 3])]
		segments = build_render_segments(5.0, regions, tracks)
		# A four-person podcast is a normal case, not an edge case -- everyone
		# who is actually talking gets on screen. The layout adapts (speaker
		# focus rather than four narrow columns); the roster is not truncated.
		assert len(segments[0].speaker_bboxes) == 4

	def test_touching_regions_merge_only_when_the_decision_is_identical(self):
		tracks = [_track(0, BBOX_A)]
		regions = [Region(0.0, 2.0, "zoom", [0]), Region(2.0, 4.0, "zoom", [0])]
		segments = build_render_segments(4.0, regions, tracks)
		# Same person, same bbox (single keyframe) -> one segment, one encode.
		assert len(segments) == 1
		assert segments[0].start == 0.0 and segments[0].end == 4.0

	def test_overlapping_regions_resolve_to_the_later_one(self):
		# The editor keeps regions disjoint, but the result must not depend on
		# list order if one ever slips through.
		tracks = [_track(0, BBOX_A), _track(1, BBOX_B)]
		regions = [Region(0.0, 6.0, "zoom", [0]), Region(2.0, 4.0, "zoom", [1])]
		segments = build_render_segments(6.0, regions, tracks)
		middle = next(s for s in segments if s.start <= 3.0 < s.end)
		assert [sp for sp, _ in middle.speaker_bboxes] == [1]

	def test_drop_range_is_excluded_from_the_output(self):
		# A 2s dead-air cut in the middle of an otherwise-continuous "original"
		# stretch -- must actually disappear from the timeline, not just get
		# relabeled.
		segments = build_render_segments(10.0, [], [], drop_ranges=[(4.0, 6.0)])
		covered = sum(s.end - s.start for s in segments)
		assert covered == pytest.approx(8.0)
		assert not any(s.start <= 5.0 < s.end for s in segments)

	def test_drop_range_does_not_get_silently_rejoined_across_the_cut(self):
		# Regression test for the bug this feature nearly shipped with: two
		# "original" segments either side of a cut have the same layout and
		# the same (empty) speaker_bboxes, which is exactly what
		# _merge_adjacent used to merge on -- gluing them back into one
		# continuous segment spanning the cut and silently keeping the
		# dropped time in the render. The fix requires true time-adjacency,
		# not just equal layout, so the cut must survive as an actual gap
		# between two segments rather than disappearing into one merged span.
		segments = build_render_segments(10.0, [], [], drop_ranges=[(4.0, 6.0)])
		assert [(s.start, s.end) for s in segments] == [(0.0, 4.0), (6.0, 10.0)]

	def test_drop_range_at_the_very_start_and_end(self):
		tracks = [_track(0, BBOX_A)]
		regions = [Region(2.0, 8.0, "zoom", [0])]
		segments = build_render_segments(
			10.0, regions, tracks, drop_ranges=[(0.0, 1.0), (9.0, 10.0)]
		)
		assert segments[0].start == 1.0
		assert segments[-1].end == 9.0

	def test_no_drop_ranges_behaves_exactly_as_before(self):
		tracks = [_track(0, BBOX_A)]
		regions = [Region(0.0, 5.0, "zoom", [0])]
		with_none = build_render_segments(5.0, regions, tracks)
		with_empty = build_render_segments(5.0, regions, tracks, drop_ranges=[])
		assert with_none == with_empty

	def test_a_regions_crop_nudge_carries_onto_its_segment(self):
		# The inspector's nudge is set on the region; the renderer only ever
		# sees segments, so it has to survive that translation or the export
		# would silently ignore it.
		tracks = [_track(0, BBOX_A)]
		regions = [Region(0.0, 5.0, "zoom", [0], crop_nudge=(0.2, -0.1))]
		segments = build_render_segments(5.0, regions, tracks)
		assert segments[0].crop_nudge == (0.2, -0.1)

	def test_touching_regions_with_different_nudges_do_not_merge(self):
		# Same person, same layout, same single-keyframe bbox -- everything
		# _merge_adjacent used to check -- but a different manual crop, so
		# merging them would silently drop one region's nudge from the export.
		tracks = [_track(0, BBOX_A)]
		regions = [
			Region(0.0, 2.0, "zoom", [0], crop_nudge=(0.1, 0.0)),
			Region(2.0, 4.0, "zoom", [0], crop_nudge=(-0.1, 0.0)),
		]
		segments = build_render_segments(4.0, regions, tracks)
		assert len(segments) == 2


class TestSegmentsAreContiguous:
	"""`_segments_are_contiguous` decides whether render_export can stream-copy
	the source's whole audio track untouched, or has to build a trimmed audio
	edit to match a cut video timeline. Getting this wrong either encodes
	audio that didn't need it, or -- the real risk -- ships an export whose
	audio silently doesn't match a trimmed video."""

	def test_gapless_full_duration_is_contiguous(self):
		segments = [RenderSegment(start=0.0, end=5.0, layout="original", speaker_bboxes=[])]
		assert _segments_are_contiguous(segments, 5.0)

	def test_internal_gap_is_not_contiguous(self):
		segments = [
			RenderSegment(start=0.0, end=4.0, layout="original", speaker_bboxes=[]),
			RenderSegment(start=6.0, end=10.0, layout="original", speaker_bboxes=[]),
		]
		assert not _segments_are_contiguous(segments, 10.0)

	def test_gap_at_the_start_is_not_contiguous(self):
		# The bug this guards against: a drop at the very start/end leaves the
		# *remaining* segments mutually adjacent, so a check that only looks
		# at gaps *between* segments would miss this and wrongly take the
		# untouched-audio path.
		segments = [RenderSegment(start=1.0, end=10.0, layout="original", speaker_bboxes=[])]
		assert not _segments_are_contiguous(segments, 10.0)

	def test_gap_at_the_end_is_not_contiguous(self):
		segments = [RenderSegment(start=0.0, end=9.0, layout="original", speaker_bboxes=[])]
		assert not _segments_are_contiguous(segments, 10.0)

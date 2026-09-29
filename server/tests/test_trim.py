"""Tests for pipeline/trim.py -- checking the editor's cut list, and the
timeline remapping that keeps captions in sync with a trimmed export. Which
pauses and filler words get cut is decided in the editor and tested in
src/features/timeline/cuts.test.ts. Pure logic, no ffmpeg."""

import pytest

from pipeline.trim import BadCuts, keep_ranges, merge_ranges, parse_cuts, remap_time


class TestParseCuts:
	def test_spans_come_back_sorted_and_merged(self):
		cuts = [{"start": 5, "end": 6}, {"start": 1, "end": 2}, {"start": 1.5, "end": 3}]
		assert parse_cuts(cuts, 10.0) == [(1.0, 3.0), (5.0, 6.0)]

	def test_spans_are_clipped_to_the_recording_and_empty_ones_dropped(self):
		cuts = [{"start": -1, "end": 0.5}, {"start": 9, "end": 12}, {"start": 11, "end": 13}, {"start": 4, "end": 4}]
		assert parse_cuts(cuts, 10.0) == [(0.0, 0.5), (9.0, 10.0)]

	def test_anything_that_is_not_a_span_is_refused_rather_than_guessed_at(self):
		for bad in ({"start": 1}, [1, 2], "cut", {"start": "soon", "end": 2}):
			with pytest.raises(BadCuts):
				parse_cuts([bad], 10.0)
		with pytest.raises(BadCuts):
			parse_cuts({"start": 1, "end": 2}, 10.0)


class TestKeepRanges:
	def test_nothing_cut_keeps_everything(self):
		assert keep_ranges([], 10.0) == [(0.0, 10.0)]

	def test_cuts_at_either_end_leave_no_empty_piece(self):
		assert keep_ranges([(0.0, 1.0), (4.0, 5.0), (9.0, 10.0)], 10.0) == [(1.0, 4.0), (5.0, 9.0)]


class TestMergeRanges:
	def test_overlapping_ranges_are_coalesced(self):
		assert merge_ranges([(0.0, 5.0), (3.0, 8.0)]) == [(0.0, 8.0)]

	def test_touching_ranges_are_coalesced(self):
		assert merge_ranges([(0.0, 5.0), (5.0, 8.0)]) == [(0.0, 8.0)]

	def test_disjoint_ranges_stay_separate(self):
		assert merge_ranges([(0.0, 2.0), (5.0, 8.0)]) == [(0.0, 2.0), (5.0, 8.0)]

	def test_unsorted_input_is_handled(self):
		assert merge_ranges([(5.0, 8.0), (0.0, 2.0)]) == [(0.0, 2.0), (5.0, 8.0)]

	def test_empty_input(self):
		assert merge_ranges([]) == []


class TestRemapTime:
	def test_no_drops_is_identity(self):
		assert remap_time(42.0, []) == 42.0

	def test_timestamp_before_any_drop_is_unaffected(self):
		assert remap_time(2.0, [(5.0, 8.0)]) == 2.0

	def test_timestamp_after_a_drop_shifts_left_by_its_length(self):
		assert remap_time(10.0, [(5.0, 8.0)]) == pytest.approx(7.0)

	def test_timestamp_inside_a_drop_shifts_by_however_much_of_it_precedes(self):
		# Shouldn't normally be asked about a timestamp *inside* a cut range,
		# but the math should still be sane rather than producing nonsense.
		assert remap_time(6.0, [(5.0, 8.0)]) == pytest.approx(5.0)

	def test_multiple_drops_accumulate(self):
		assert remap_time(20.0, [(2.0, 4.0), (10.0, 12.0)]) == pytest.approx(20.0 - 2.0 - 2.0)

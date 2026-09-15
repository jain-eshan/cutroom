"""Tests for pipeline/trim.py -- dead-air and filler-word range detection,
and the timeline remapping needed to keep captions in sync with a trimmed
export. Pure logic, no ffmpeg."""

import pytest

from pipeline.transcribe import Word
from pipeline.trim import (
	MIN_SILENCE_TO_TRIM,
	SILENCE_KEEP,
	dead_air_ranges,
	filler_word_ranges,
	merge_ranges,
	remap_time,
)


class TestDeadAirRanges:
	def test_short_gap_is_left_alone(self):
		# Below MIN_SILENCE_TO_TRIM -- reads as a natural breath, not dead air.
		gap = MIN_SILENCE_TO_TRIM - 0.1
		ranges = dead_air_ranges([(0.0, 5.0), (5.0 + gap, 10.0)], 10.0)
		assert ranges == []

	def test_long_gap_is_trimmed_down_not_removed_entirely(self):
		ranges = dead_air_ranges([(0.0, 5.0), (10.0, 12.0)], 12.0)
		assert len(ranges) == 1
		start, end = ranges[0]
		# The cut range should be strictly inside the gap (5.0, 10.0) -- some
		# silence survives on both sides, per SILENCE_KEEP.
		assert start > 5.0 and end < 10.0
		kept_before = start - 5.0
		kept_after = 10.0 - end
		assert kept_before == pytest.approx(SILENCE_KEEP / 2)
		assert kept_after == pytest.approx(SILENCE_KEEP / 2)

	def test_leading_silence_before_the_first_turn_is_caught(self):
		ranges = dead_air_ranges([(5.0, 8.0)], 8.0)
		assert len(ranges) == 1
		assert ranges[0][0] == pytest.approx(SILENCE_KEEP / 2)

	def test_trailing_silence_after_the_last_turn_is_caught(self):
		ranges = dead_air_ranges([(0.0, 3.0)], 10.0)
		assert len(ranges) == 1
		assert ranges[0][1] == pytest.approx(10.0 - SILENCE_KEEP / 2)

	def test_overlapping_turn_bounds_do_not_produce_a_bogus_gap(self):
		# Two people's turns can genuinely overlap (simultaneous speech) --
		# this must not read the overlap itself as a gap.
		ranges = dead_air_ranges([(0.0, 5.0), (3.0, 8.0)], 8.0)
		assert ranges == []

	def test_no_turns_at_all_treats_the_whole_clip_as_one_gap(self):
		ranges = dead_air_ranges([], 20.0)
		assert len(ranges) == 1
		assert ranges[0][0] < ranges[0][1]


class TestFillerWordRanges:
	def test_standalone_filler_is_detected(self):
		words = [Word(start=1.0, end=1.3, text="um")]
		ranges = filler_word_ranges(words)
		assert len(ranges) == 1
		assert ranges[0][0] < 1.0  # padded
		assert ranges[0][1] > 1.3

	def test_ambiguous_words_are_never_treated_as_filler(self):
		# "like" and "so" are filler *sometimes* -- there's no way to tell
		# from the word alone, so this pipeline never guesses.
		words = [
			Word(start=0.0, end=0.2, text="like"),
			Word(start=0.5, end=0.7, text="so"),
			Word(start=1.0, end=1.2, text="actually"),
		]
		assert filler_word_ranges(words) == []

	def test_case_and_punctuation_do_not_matter(self):
		words = [Word(start=0.0, end=0.3, text="Um,")]
		assert len(filler_word_ranges(words)) == 1

	def test_real_word_containing_a_filler_as_a_substring_is_not_matched(self):
		# Guards against a naive substring check instead of an exact-token one.
		words = [Word(start=0.0, end=0.3, text="uhm...ish")]
		assert filler_word_ranges(words) == []


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

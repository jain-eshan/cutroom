"""Tests for deriving overlap windows from diarisation output.

The model call itself isn't tested here (it needs a token, a GPU and ten
minutes); this covers the part that turns overlapping speaker segments into
the windows the renderer builds composites from, which is exactly the kind of
logic that produces a plausible-but-wrong edit when it's subtly off.
"""

from pipeline.diarize import SpeakerSegment, overlap_windows


def _seg(speaker: int, start: float, end: float) -> SpeakerSegment:
	return SpeakerSegment(start=start, end=end, speaker=speaker)


class TestOverlapWindows:
	def test_no_overlap_when_speakers_take_turns(self):
		segments = [_seg(0, 0.0, 5.0), _seg(1, 5.0, 10.0)]
		assert overlap_windows(segments) == []

	def test_finds_the_intersection_only(self):
		# Speaker 0 talks 0-6, speaker 1 cuts in at 4 and runs to 10.
		segments = [_seg(0, 0.0, 6.0), _seg(1, 4.0, 10.0)]
		windows = overlap_windows(segments)
		assert len(windows) == 1
		assert windows[0].start == 4.0
		assert windows[0].end == 6.0
		assert windows[0].speakers == [0, 1]

	def test_three_way_overlap_keeps_everyone(self):
		segments = [_seg(0, 0.0, 10.0), _seg(1, 2.0, 8.0), _seg(2, 3.0, 6.0)]
		windows = overlap_windows(segments)
		three_way = [w for w in windows if len(w.speakers) == 3]
		assert three_way, "a stretch where all three talk at once should be found"
		assert three_way[0].start == 3.0
		assert three_way[0].end == 6.0
		assert three_way[0].speakers == [0, 1, 2]

	def test_same_speaker_twice_is_not_an_overlap(self):
		# Diarisation can emit two adjacent segments for one person; that is not
		# two people talking, and must not trigger a split-screen.
		segments = [_seg(0, 0.0, 5.0), _seg(0, 3.0, 8.0)]
		assert overlap_windows(segments) == []

	def test_adjacent_windows_with_the_same_speakers_merge(self):
		# Two segments from speaker 1 back to back, both inside speaker 0's turn,
		# should read as one continuous overlap rather than two abutting ones.
		segments = [_seg(0, 0.0, 10.0), _seg(1, 2.0, 5.0), _seg(1, 5.0, 8.0)]
		windows = overlap_windows(segments)
		assert len(windows) == 1
		assert windows[0].start == 2.0
		assert windows[0].end == 8.0

	def test_separate_overlaps_stay_separate(self):
		segments = [_seg(0, 0.0, 20.0), _seg(1, 2.0, 4.0), _seg(1, 10.0, 12.0)]
		windows = overlap_windows(segments)
		assert len(windows) == 2
		assert (windows[0].start, windows[0].end) == (2.0, 4.0)
		assert (windows[1].start, windows[1].end) == (10.0, 12.0)

	def test_no_segments_is_not_an_error(self):
		assert overlap_windows([]) == []

	def test_a_brief_interjection_is_not_worth_a_composite(self):
		# Measured on real footage: community-1 finds overlaps as short as 0.02s.
		# Cutting to a two-person composite for that long is a flash, not an edit.
		segments = [_seg(0, 0.0, 10.0), _seg(1, 4.0, 4.2)]
		assert overlap_windows(segments) == []

	def test_a_real_talk_over_survives(self):
		segments = [_seg(0, 0.0, 10.0), _seg(1, 4.0, 6.5)]
		windows = overlap_windows(segments)
		assert len(windows) == 1
		assert windows[0].speakers == [0, 1]

	def test_the_floor_is_tunable(self):
		segments = [_seg(0, 0.0, 10.0), _seg(1, 4.0, 4.4)]
		assert overlap_windows(segments, min_duration=0.2)
		assert overlap_windows(segments, min_duration=2.0) == []

	def test_fragments_merge_before_the_length_check(self):
		# Three consecutive short segments from speaker 1 are one 1.2s overlap,
		# not three sub-second ones that each fail the floor.
		segments = [_seg(0, 0.0, 10.0), _seg(1, 4.0, 4.4), _seg(1, 4.4, 4.8), _seg(1, 4.8, 5.2)]
		windows = overlap_windows(segments)
		assert len(windows) == 1
		assert windows[0].start == 4.0
		assert windows[0].end == 5.2


class TestDiarizationConfigured:
	"""The check the setup gate and /process rely on to refuse a job up front
	rather than after a multi-minute transcription."""

	def test_missing_token_is_not_configured(self, monkeypatch):
		from pipeline.diarize import diarization_configured

		monkeypatch.delenv("HF_TOKEN", raising=False)
		assert diarization_configured() is False

	def test_empty_token_counts_as_missing(self, monkeypatch):
		from pipeline.diarize import diarization_configured

		monkeypatch.setenv("HF_TOKEN", "")
		assert diarization_configured() is False

	def test_any_token_counts_as_configured(self, monkeypatch):
		from pipeline.diarize import diarization_configured

		monkeypatch.setenv("HF_TOKEN", "hf_example")
		assert diarization_configured() is True

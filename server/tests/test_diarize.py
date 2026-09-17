"""Tests for deriving overlap windows from diarisation output.

The model call itself isn't tested here (it needs a token, a GPU and ten
minutes); this covers the part that turns overlapping speaker segments into
the windows the renderer builds composites from, which is exactly the kind of
logic that produces a plausible-but-wrong edit when it's subtly off.
"""

import threading
import time

import pytest

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


class TestPipelineLoadingAnnounced:
	"""`on_loading` is the only way a browser learns why a run stalls before
	transcription can start -- whether that's a real download or just
	loading an already-cached model isn't told apart (see diarize.py's
	comment); either way it's a real pause that needs a label."""

	def test_fires_before_the_pipeline_call_when_not_yet_loaded(self, monkeypatch):
		import pipeline.diarize as diarize_module
		from pyannote.audio import Pipeline

		monkeypatch.setattr(diarize_module, "_pipeline", None)
		monkeypatch.setenv("HF_TOKEN", "hf_example")
		monkeypatch.setattr(
			Pipeline,
			"from_pretrained",
			classmethod(lambda cls, *a, **k: (_ for _ in ()).throw(RuntimeError("no network in tests"))),
		)

		seen: list[str] = []
		with pytest.raises(diarize_module.DiarizationUnavailable):
			diarize_module._get_pipeline(on_loading=seen.append)

		assert seen and "first time" in seen[0]

	def test_does_not_fire_when_already_loaded(self, monkeypatch):
		import pipeline.diarize as diarize_module

		monkeypatch.setattr(diarize_module, "_pipeline", object())

		called = []
		result = diarize_module._get_pipeline(on_loading=called.append)

		assert not called
		assert result is diarize_module._pipeline


class TestConcurrentLoads:
	def test_two_threads_racing_to_load_construct_the_pipeline_only_once(self, monkeypatch):
		# Same reasoning as transcribe.py's equivalent test: nothing limits
		# concurrent jobs, so two jobs starting close together used to both
		# see _pipeline as None and both load community-1 (several hundred
		# MB) at once.
		import pipeline.diarize as diarize_module
		from pyannote.audio import Pipeline

		monkeypatch.setattr(diarize_module, "_pipeline", None)
		monkeypatch.setenv("HF_TOKEN", "hf_example")
		monkeypatch.setattr(diarize_module, "_best_device", lambda: "cpu")

		construction_count = 0
		start_barrier = threading.Barrier(2)

		class FakePipeline:
			def to(self, device):
				return self

		def slow_from_pretrained(cls, *a, **k):
			nonlocal construction_count
			construction_count += 1
			time.sleep(0.05)
			return FakePipeline()

		monkeypatch.setattr(Pipeline, "from_pretrained", classmethod(slow_from_pretrained))

		def call():
			start_barrier.wait(timeout=5)
			return diarize_module._get_pipeline()

		results = []
		threads = [threading.Thread(target=lambda: results.append(call())) for _ in range(2)]
		for t in threads:
			t.start()
		for t in threads:
			t.join(timeout=5)

		assert construction_count == 1
		assert len(results) == 2 and results[0] is results[1]

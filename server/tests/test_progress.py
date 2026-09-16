"""Tests for pipeline/progress.py -- the in-process job registry that backs
the processing screen's stage rows and its evidence area."""

import pytest

from pipeline import jobs, progress
from pipeline.progress import (
	MAX_LINES,
	face_thumbnail,
	report,
	report_error,
	report_line,
	report_people,
	report_timeline_thumbnails,
	report_waveform,
	snapshot,
	timeline_thumbnail,
	waveform_peaks,
)


@pytest.fixture(autouse=True)
def clean_registry(tmp_path, monkeypatch):
	# The registry is module-level by design (single-user local tool), so each
	# test has to start from empty.
	progress._jobs.clear()
	progress._faces.clear()
	progress._waveform.clear()
	progress._timeline_thumbnails.clear()
	# report_waveform/report_timeline_thumbnails now also write through to
	# disk (see TestDiskFallback) -- give every test its own directory rather
	# than the real server/jobs/.
	monkeypatch.setattr(jobs, "JOBS_DIR", tmp_path)


class TestStages:
	def test_unknown_job_reads_as_a_fresh_one(self):
		# A page reload asks about a job the server never saw. That's an empty
		# job, not an error -- the UI has nothing useful to do with a 404 here.
		snap = snapshot("nobody")
		assert snap["transcribe"]["done"] is False
		assert snap["lines"] == []
		assert snap["people"] == []

	def test_reporting_without_a_job_id_is_a_no_op(self):
		report(None, "transcribe", "transcribing speech", 0.5)
		report_line(None, "hello", 1.0, 10.0)
		assert progress._jobs == {}


class TestTranscriptLines:
	def test_lines_accumulate_with_the_position_they_reached(self):
		report_line("j", "first thing said", 4.0, 120.0)
		report_line("j", "second thing said", 9.5, 120.0)
		snap = snapshot("j")
		assert snap["lines"] == ["first thing said", "second thing said"]
		assert snap["position"] == 9.5
		assert snap["duration"] == 120.0

	def test_only_the_tail_is_kept(self):
		# The whole snapshot is serialised on every poll, so an hour of
		# transcript here would grow every response for the length of the job.
		for i in range(MAX_LINES + 5):
			report_line("j", f"line {i}", float(i), 100.0)
		lines = snapshot("j")["lines"]
		assert len(lines) == MAX_LINES
		assert lines[-1] == f"line {MAX_LINES + 4}"

	def test_empty_text_is_ignored(self):
		# faster-whisper emits the occasional empty segment; an empty row in
		# the evidence area reads as a stall.
		report_line("j", "", 1.0, 10.0)
		assert snapshot("j")["lines"] == []


class TestPeople:
	def test_ids_go_in_the_snapshot_and_bytes_do_not(self):
		report_people("j", {1: b"\xff\xd8second", 0: b"\xff\xd8first"})
		snap = snapshot("j")
		assert snap["people"] == [0, 1]
		assert b"first" not in repr(snap).encode()
		assert face_thumbnail("j", 0) == b"\xff\xd8first"

	def test_a_face_from_another_job_is_not_served(self):
		report_people("j", {0: b"\xff\xd8first"})
		assert face_thumbnail("other", 0) is None
		assert face_thumbnail("j", 7) is None


class TestWaveform:
	def test_peaks_round_trip(self):
		report_waveform("j", [0.0, 0.5, 1.0])
		assert waveform_peaks("j") == [0.0, 0.5, 1.0]

	def test_no_waveform_yet_reads_as_none_not_an_empty_list(self):
		# An empty list is a valid (if odd) computed result -- the endpoint
		# has to be able to tell "not computed" apart from "computed as empty".
		assert waveform_peaks("nobody") is None


class TestTimelineThumbnails:
	def test_thumbnails_round_trip_and_the_count_lands_on_the_job(self):
		report_timeline_thumbnails("j", [b"\xff\xd8first", b"\xff\xd8second"])
		snap = snapshot("j")
		# camelCase on the wire, like every other multi-word field the API
		# returns -- this is the one field in JobProgress where that isn't
		# already true of the Python name by coincidence.
		assert snap["thumbnailCount"] == 2
		assert b"first" not in repr(snap).encode()
		assert timeline_thumbnail("j", 0) == b"\xff\xd8first"
		assert timeline_thumbnail("j", 1) == b"\xff\xd8second"

	def test_an_out_of_range_index_is_not_served(self):
		report_timeline_thumbnails("j", [b"\xff\xd8first"])
		assert timeline_thumbnail("j", 1) is None
		assert timeline_thumbnail("j", -1) is None

	def test_a_thumbnail_from_another_job_is_not_served(self):
		report_timeline_thumbnails("j", [b"\xff\xd8first"])
		assert timeline_thumbnail("other", 0) is None


class TestPruning:
	def test_stale_jobs_drop_their_faces_too(self):
		report_people("old", {0: b"\xff\xd8first"})
		progress._jobs["old"].updated -= progress.STALE_AFTER_S + 1
		# Any write prunes; without dropping _faces alongside _jobs the
		# thumbnails would outlive the job that owns them.
		report_line("new", "something", 1.0, 10.0)
		assert "old" not in progress._jobs
		assert face_thumbnail("old", 0) is None

	def test_stale_jobs_drop_the_in_memory_copy_but_keep_the_saved_one(self):
		# Unlike faces, waveform and thumbnails are also written to disk (a
		# saved episode needs them after the in-memory registry forgets it),
		# so pruning the registry entry must not take away a real answer that
		# still exists on disk -- that's what makes it a *saved* episode
		# rather than one more thing lost when the tab is forgotten.
		report_waveform("old", [1.0])
		report_timeline_thumbnails("old", [b"\xff\xd8one"])
		progress._jobs["old"].updated -= progress.STALE_AFTER_S + 1
		report_line("new", "something", 1.0, 10.0)
		assert "old" not in progress._waveform
		assert "old" not in progress._timeline_thumbnails
		assert waveform_peaks("old") == [1.0]
		assert timeline_thumbnail("old", 0) == b"\xff\xd8one"


class TestError:
	def test_an_error_lands_on_the_snapshot(self):
		report_error("j", "Could not read the audio track.")
		assert snapshot("j")["error"] == "Could not read the audio track."

	def test_no_error_reads_as_none(self):
		report_line("j", "still going", 1.0, 10.0)
		assert snapshot("j")["error"] is None

	def test_reporting_an_error_without_a_job_id_is_a_no_op(self):
		report_error(None, "whatever")
		assert progress._jobs == {}


class TestSavedEpisodeSnapshot:
	"""Once a job's in-memory entry is gone (pruned, or the server
	restarted), /progress/{job_id} still has to say something useful for a
	saved episode being reopened -- reporting it as freshly "waiting" would
	read as a hung job that never started."""

	def test_a_finished_saved_episode_reads_as_done(self):
		jobs.save_result("j", "ep1.mp4", {"turns": []})
		jobs.save_thumbnails("j", [b"\xff\xd8one", b"\xff\xd8two"])
		snap = snapshot("j")
		assert snap["transcribe"]["done"] is True
		assert snap["faces"]["done"] is True
		assert snap["match"]["done"] is True
		assert snap["thumbnailCount"] == 2

	def test_an_unfinished_job_with_no_result_still_reads_as_fresh(self):
		# Input saved but the pipeline never finished -- not a saved episode,
		# and definitely not "done".
		jobs.save_input("j", "ep1.mp4")
		assert snapshot("j")["transcribe"]["done"] is False

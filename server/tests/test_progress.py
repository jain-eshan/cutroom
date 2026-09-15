"""Tests for pipeline/progress.py -- the in-process job registry that backs
the processing screen's stage rows and its evidence area."""

import pytest

from pipeline import progress
from pipeline.progress import (
	MAX_LINES,
	face_thumbnail,
	report,
	report_line,
	report_people,
	snapshot,
)


@pytest.fixture(autouse=True)
def clean_registry():
	# The registry is module-level by design (single-user local tool), so each
	# test has to start from empty.
	progress._jobs.clear()
	progress._faces.clear()


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


class TestPruning:
	def test_stale_jobs_drop_their_faces_too(self):
		report_people("old", {0: b"\xff\xd8first"})
		progress._jobs["old"].updated -= progress.STALE_AFTER_S + 1
		# Any write prunes; without dropping _faces alongside _jobs the
		# thumbnails would outlive the job that owns them.
		report_line("new", "something", 1.0, 10.0)
		assert "old" not in progress._jobs
		assert face_thumbnail("old", 0) is None

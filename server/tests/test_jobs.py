"""Tests for pipeline/jobs.py -- the on-disk store that lets a job survive
past the request that started it, and lets a finished one be reopened later
without reprocessing."""

import pytest

from pipeline import jobs


@pytest.fixture(autouse=True)
def isolated_jobs_dir(tmp_path, monkeypatch):
	# Every test gets its own empty directory instead of the real server/jobs/
	# -- these tests write real files, and must not touch (or depend on) an
	# actual episode saved on this machine.
	monkeypatch.setattr(jobs, "JOBS_DIR", tmp_path)


class TestLookupHasNoSideEffects:
	"""A wrong or expired job id is the common case -- /progress/{job_id}
	takes one on every poll, including from a stale bookmark or a typo. None
	of that may create a directory, or the jobs folder fills up with empty
	junk for ids that never became real jobs."""

	def test_looking_up_an_unknown_job_creates_nothing(self):
		assert jobs.input_path("nobody") is None
		assert jobs.load_result("nobody") is None
		assert jobs.load_waveform("nobody") is None
		assert jobs.load_thumbnail("nobody", 0) is None
		assert jobs.thumbnail_count("nobody") == 0
		assert not jobs.job_dir("nobody").exists()

	def test_list_jobs_on_a_machine_with_none_yet(self):
		assert jobs.list_jobs() == []


class TestInputFile:
	def test_the_saved_extension_survives_for_later_lookup(self):
		dest = jobs.save_input("j", "My Recording.MP4")
		dest.write_bytes(b"fake video")
		assert jobs.input_path("j") == dest
		assert dest.suffix == ".MP4"

	def test_no_filename_still_gets_a_findable_path(self):
		dest = jobs.save_input("j", "")
		dest.write_bytes(b"x")
		assert jobs.input_path("j") == dest

	def test_a_retry_under_the_same_job_id_replaces_the_old_file_instead_of_sitting_beside_it(self):
		# A different file picked after a failure, or a different container for
		# the same recording -- input_path()'s plain alphabetical sort would
		# otherwise hand back whichever name sorts first, not the one just
		# uploaded.
		first = jobs.save_input("j", "first-attempt.mov")
		first.write_bytes(b"first bytes")
		second = jobs.save_input("j", "retry.mp4")
		second.write_bytes(b"retry bytes")
		assert not first.exists()
		assert jobs.input_path("j") == second
		assert jobs.input_path("j").read_bytes() == b"retry bytes"


class TestResult:
	def test_a_saved_result_round_trips(self):
		jobs.save_result("j", "ep1.mp4", {"turns": [{"speaker": 0}]})
		assert jobs.load_result("j") == {"turns": [{"speaker": 0}]}

	def test_an_unfinished_job_is_not_a_saved_episode(self):
		# Input saved, but the pipeline never got to save_result -- e.g. the
		# server was killed mid-job. Nothing to reopen; /process would just
		# overwrite these files on retry.
		jobs.save_input("j", "ep1.mp4")
		assert jobs.list_jobs() == []

	def test_saved_episodes_list_newest_first(self, monkeypatch):
		times = iter([100.0, 200.0])
		monkeypatch.setattr(jobs.time, "time", lambda: next(times))
		jobs.save_result("old", "first.mp4", {})
		jobs.save_result("new", "second.mp4", {})
		assert [j["jobId"] for j in jobs.list_jobs()] == ["new", "old"]

	def test_a_truncated_result_reads_as_not_found_rather_than_raising(self):
		# The same "killed mid-write" risk list_jobs already guards its own
		# read against -- load_result and original_filename need the same
		# guard, or GET /jobs/{id} 500s on a job that GET /jobs still lists.
		d = jobs.job_dir("j")
		d.mkdir(parents=True)
		(d / "result.json").write_text("{not valid json")
		(d / "meta.json").write_text("{not valid json")
		assert jobs.load_result("j") is None
		assert jobs.original_filename("j") is None

	def test_a_large_result_round_trips_intact_and_leaves_no_temp_file_behind(self):
		# save_result writes via a temp file renamed into place; confirm that
		# actually lands a complete, parseable file rather than a plausible
		# but subtly wrong one.
		big = {"turns": [{"speaker": i} for i in range(5000)]}
		jobs.save_result("j", "ep1.mp4", big)
		assert jobs.load_result("j") == big
		assert sorted(p.name for p in jobs.job_dir("j").iterdir()) == ["meta.json", "result.json"]


class TestWaveformAndThumbnails:
	def test_waveform_round_trips(self):
		jobs.save_waveform("j", [0.0, 0.5, 1.0])
		assert jobs.load_waveform("j") == [0.0, 0.5, 1.0]

	def test_thumbnails_round_trip_by_index(self):
		jobs.save_thumbnails("j", [b"\xff\xd8first", b"\xff\xd8second"])
		assert jobs.load_thumbnail("j", 0) == b"\xff\xd8first"
		assert jobs.load_thumbnail("j", 1) == b"\xff\xd8second"
		assert jobs.thumbnail_count("j") == 2

	def test_an_out_of_range_thumbnail_is_not_served(self):
		jobs.save_thumbnails("j", [b"\xff\xd8only"])
		assert jobs.load_thumbnail("j", 1) is None

	def test_a_truncated_waveform_reads_as_not_found_rather_than_raising(self):
		d = jobs.job_dir("j")
		d.mkdir(parents=True)
		(d / "waveform.json").write_text("[1, 2,")
		assert jobs.load_waveform("j") is None


class TestDelete:
	def test_deleting_a_job_removes_everything_about_it(self):
		jobs.save_result("j", "ep1.mp4", {})
		jobs.save_waveform("j", [1.0])
		jobs.delete_job("j")
		assert jobs.load_result("j") is None
		assert jobs.load_waveform("j") is None
		assert not jobs.job_dir("j").exists()

	def test_deleting_a_job_that_never_existed_does_not_raise(self):
		jobs.delete_job("nobody")

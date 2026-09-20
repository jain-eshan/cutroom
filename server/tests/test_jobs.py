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


class TestDiscardWav:
	"""The extracted wav is ~115MB per hour of episode and nothing reads it
	once the pipeline is done. Dropping it is the one piece of eviction this
	store does, and it is safe precisely because the file is derived."""

	def test_the_wav_goes_but_the_episode_stays(self):
		jobs.wav_path("j").write_bytes(b"RIFF")
		jobs.save_result("j", "ep1.mp4", {"ok": True})
		jobs.save_waveform("j", [1.0])

		jobs.discard_wav("j")

		assert not (jobs.job_dir("j") / "audio.wav").exists()
		# What the saved episode is actually made of has to survive.
		assert jobs.load_result("j") == {"ok": True}
		assert jobs.load_waveform("j") == [1.0]

	def test_discarding_twice_does_not_raise(self):
		jobs.wav_path("j").write_bytes(b"RIFF")
		jobs.discard_wav("j")
		jobs.discard_wav("j")

	def test_discarding_after_the_job_was_deleted_does_not_recreate_it(self):
		# _run_pipeline calls this from a `finally`, which also runs when
		# DELETE /jobs/{id} cancelled the task -- by which point it has
		# already removed the directory. Going through wav_path (which calls
		# _ensure_dir) would put it back, resurrecting the job the delete was
		# for. This is the regression that guards the non-creating path.
		jobs.save_result("j", "ep1.mp4", {})
		jobs.delete_job("j")

		jobs.discard_wav("j")

		assert not jobs.job_dir("j").exists()


class TestSpaceCheck:
	def test_no_problem_when_there_is_room(self, monkeypatch):
		monkeypatch.setattr(jobs, "free_bytes", lambda: 10 * 1024**3)
		assert jobs.space_problem(1024**3, "take this recording") is None

	def test_the_margin_is_required_on_top_of_the_asked_for_size(self, monkeypatch):
		# Exactly the requested size free is still a refusal: the wav, the
		# thumbnails and the result files all land after the thing being
		# measured, which is the whole reason for the margin.
		monkeypatch.setattr(jobs, "free_bytes", lambda: 1024**3)
		assert jobs.space_problem(1024**3, "take this recording") is not None

	def test_the_message_names_both_numbers_and_what_failed(self, monkeypatch):
		monkeypatch.setattr(jobs, "free_bytes", lambda: 2 * 1024**3)
		problem = jobs.space_problem(5 * 1024**3, "render this episode")
		assert "render this episode" in problem
		assert "6.0GB" in problem and "2.0GB" in problem

	def test_free_bytes_works_before_the_jobs_directory_exists(self, tmp_path, monkeypatch):
		# First run on a fresh machine: neither jobs/ nor the data directory
		# is there yet, and shutil.disk_usage needs a path that exists.
		monkeypatch.setattr(jobs, "JOBS_DIR", tmp_path / "not" / "created" / "yet")
		assert jobs.free_bytes() > 0

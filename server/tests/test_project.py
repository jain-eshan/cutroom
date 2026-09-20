"""Tests for the .cutroom project file.

A project is the one artefact here that a user keeps, moves between machines
and opens later, so the two things under test are that a round trip loses
nothing, and that reading one -- an archive from outside this process --
can't be talked into writing where it shouldn't.
"""

import json
import zipfile
from pathlib import Path

import pytest

from pipeline import jobs, project


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
	monkeypatch.setattr(jobs, "JOBS_DIR", tmp_path / "jobs")


RESULT = {"turns": [{"speaker": 0, "start": 0.0, "end": 1.0, "text": "hello"}], "words": [], "faces": {}, "match": {}}
EDIT = {"version": 1, "cast": {"names": {"1": "Siddharth"}}, "regions": [{"id": "r1"}], "savedAt": 1.0}


def _job_with_everything(tmp_path, job_id="src", *, with_source=True):
	jobs.save_result(job_id, "Ep1.mp4", RESULT)
	jobs.save_edit(job_id, EDIT)
	jobs.save_waveform(job_id, [0.1, 0.9])
	jobs.save_thumbnails(job_id, [b"\xff\xd8jpeg-0", b"\xff\xd8jpeg-1"])
	if with_source:
		recording = tmp_path / "Ep1.mp4"
		recording.write_bytes(b"not really a video")
		jobs.save_input(job_id, "Ep1.mp4").symlink_to(recording)
		return job_id, recording
	return job_id, None


class TestRoundTrip:
	def test_everything_but_the_recording_survives(self, tmp_path):
		job_id, recording = _job_with_everything(tmp_path)
		archive = project.write_project(job_id, tmp_path / "Ep1.cutroom")

		manifest = project.read_project(archive, "opened")
		assert manifest["filename"] == "Ep1.mp4"
		assert jobs.load_result("opened") == RESULT
		assert jobs.load_edit("opened") == EDIT
		assert jobs.load_waveform("opened") == [0.1, 0.9]
		assert jobs.thumbnail_count("opened") == 2
		assert jobs.load_thumbnail("opened", 1) == b"\xff\xd8jpeg-1"
		# The recording is referenced, never packed in.
		with zipfile.ZipFile(archive) as z:
			assert not any(name.startswith("input") for name in z.namelist())
		assert manifest["source"]["path"] == str(recording.resolve())

	def test_an_opened_project_lists_as_a_saved_episode(self, tmp_path):
		job_id, _ = _job_with_everything(tmp_path)
		project.read_project(project.write_project(job_id, tmp_path / "p.cutroom"), "opened")
		assert [j["jobId"] for j in jobs.list_jobs() if j["jobId"] == "opened"] == ["opened"]

	def test_an_episode_nobody_has_edited_still_saves(self, tmp_path):
		jobs.save_result("plain", "Ep2.mp4", RESULT)
		project.read_project(project.write_project("plain", tmp_path / "p.cutroom"), "opened")
		assert jobs.load_result("opened") == RESULT
		# No edit is a normal project, not a broken one.
		assert jobs.load_edit("opened") is None

	def test_the_audio_intermediate_is_left_out(self, tmp_path):
		job_id, _ = _job_with_everything(tmp_path)
		jobs.wav_path(job_id).write_bytes(b"x" * 1000)
		with zipfile.ZipFile(project.write_project(job_id, tmp_path / "p.cutroom")) as z:
			assert "audio.wav" not in z.namelist()

	def test_the_project_is_named_after_the_recording(self):
		assert project.project_filename("TheFounders' Podcast Ep1.mp4") == "TheFounders' Podcast Ep1.cutroom"
		assert project.project_filename(None) == "episode.cutroom"

	def test_a_failed_write_leaves_no_half_project_behind(self, tmp_path, monkeypatch):
		job_id, _ = _job_with_everything(tmp_path)
		monkeypatch.setattr(project.zipfile.ZipFile, "write", _boom)
		out = tmp_path / "Ep1.cutroom"
		with pytest.raises(RuntimeError):
			project.write_project(job_id, out)
		assert not out.exists()
		# Not even under the temp name it builds at.
		assert list(tmp_path.glob(".*writing")) == []

	def test_an_unprocessed_episode_cannot_be_saved(self, tmp_path):
		with pytest.raises(project.NotAProject):
			project.write_project("never-ran", tmp_path / "p.cutroom")


def _boom(*args, **kwargs):
	raise RuntimeError("disk full")


class TestReadingSomethingElse:
	"""A project file arrives from outside this process, so reading one is
	the only place here that treats its input as hostile."""

	def test_a_file_that_is_not_a_zip_is_refused(self, tmp_path):
		bad = tmp_path / "notes.txt"
		bad.write_text("this is not a project")
		with pytest.raises(project.NotAProject, match="isn't a Cutroom project"):
			project.read_project(bad, "opened")

	def test_a_zip_that_is_not_a_project_is_refused(self, tmp_path):
		bad = tmp_path / "holiday.zip"
		with zipfile.ZipFile(bad, "w") as z:
			z.writestr("photo.jpg", b"x")
		with pytest.raises(project.NotAProject, match="isn't a Cutroom project"):
			project.read_project(bad, "opened")

	def test_a_newer_format_is_refused_rather_than_half_read(self, tmp_path):
		newer = tmp_path / "future.cutroom"
		with zipfile.ZipFile(newer, "w") as z:
			z.writestr(
				project.MANIFEST_NAME,
				json.dumps({"format": project.FORMAT_TAG, "version": project.PROJECT_VERSION + 1}),
			)
			z.writestr("result.json", json.dumps(RESULT))
		with pytest.raises(project.NotAProject, match="newer version"):
			project.read_project(newer, "opened")

	def test_a_project_without_a_transcript_is_refused(self, tmp_path):
		empty = tmp_path / "empty.cutroom"
		with zipfile.ZipFile(empty, "w") as z:
			z.writestr(project.MANIFEST_NAME, json.dumps({"format": project.FORMAT_TAG, "version": 1}))
		with pytest.raises(project.NotAProject, match="missing its transcript"):
			project.read_project(empty, "opened")

	def test_a_damaged_manifest_is_refused(self, tmp_path):
		damaged = tmp_path / "damaged.cutroom"
		with zipfile.ZipFile(damaged, "w") as z:
			z.writestr(project.MANIFEST_NAME, "{not json")
			z.writestr("result.json", json.dumps(RESULT))
		with pytest.raises(project.NotAProject, match="damaged"):
			project.read_project(damaged, "opened")

	def test_a_member_escaping_the_job_directory_is_not_written(self, tmp_path):
		"""The zip-slip case. `../` in a member name must not place a file
		outside the job -- and here it isn't sanitised into the job either,
		it simply isn't one of the names a project may contain."""
		evil = tmp_path / "evil.cutroom"
		outside = tmp_path / "pwned.txt"
		with zipfile.ZipFile(evil, "w") as z:
			z.writestr(project.MANIFEST_NAME, json.dumps({"format": project.FORMAT_TAG, "version": 1}))
			z.writestr("result.json", json.dumps(RESULT))
			z.writestr("../../pwned.txt", b"owned")
			z.writestr("../pwned.txt", b"owned")
			z.writestr("thumbnails/../../pwned.txt", b"owned")
			z.writestr("/etc/pwned.txt", b"owned")

		project.read_project(evil, "opened")
		assert not outside.exists()
		assert not (tmp_path.parent / "pwned.txt").exists()
		assert list(jobs.job_dir("opened").glob("**/pwned.txt")) == []
		# The real contents still came through.
		assert jobs.load_result("opened") == RESULT

	def test_a_thumbnail_name_that_is_not_an_index_is_skipped(self, tmp_path):
		odd = tmp_path / "odd.cutroom"
		with zipfile.ZipFile(odd, "w") as z:
			z.writestr(project.MANIFEST_NAME, json.dumps({"format": project.FORMAT_TAG, "version": 1}))
			z.writestr("result.json", json.dumps(RESULT))
			z.writestr("thumbnails/evil.jpg", b"x")
			z.writestr("thumbnails/3.jpg", b"\xff\xd8three")
		project.read_project(odd, "opened")
		assert jobs.load_thumbnail("opened", 3) == b"\xff\xd8three"
		assert not (jobs.job_dir("opened") / "thumbnails" / "evil.jpg").exists()

	def test_an_implausibly_large_project_is_refused(self, tmp_path, monkeypatch):
		# Declared sizes are checked before anything is written, so a zip bomb
		# is refused rather than unpacked onto the disk.
		monkeypatch.setattr(project, "MAX_UNPACKED_BYTES", 100)
		big = tmp_path / "big.cutroom"
		with zipfile.ZipFile(big, "w", zipfile.ZIP_DEFLATED) as z:
			z.writestr(project.MANIFEST_NAME, json.dumps({"format": project.FORMAT_TAG, "version": 1}))
			z.writestr("result.json", json.dumps(RESULT))
			z.writestr("waveform.json", "0" * 10_000)
		with pytest.raises(project.NotAProject, match="implausibly large"):
			project.read_project(big, "opened")


class TestRelink:
	def test_the_recording_is_found_again_when_it_is_still_there(self, tmp_path):
		job_id, recording = _job_with_everything(tmp_path)
		project.read_project(project.write_project(job_id, tmp_path / "p.cutroom"), "opened")
		project.relink("opened", recording)
		assert project.source_is_available("opened")

	def test_relinking_points_at_the_file_rather_than_copying_it(self, tmp_path):
		jobs.save_result("opened", "Ep1.mp4", RESULT)
		recording = tmp_path / "moved" / "Ep1.mp4"
		recording.parent.mkdir()
		recording.write_bytes(b"not really a video")
		project.relink("opened", recording)
		linked = jobs.input_path("opened")
		assert linked.is_symlink() and linked.resolve() == recording.resolve()

	def test_a_recording_that_moved_away_reads_as_unavailable(self, tmp_path):
		job_id, recording = _job_with_everything(tmp_path)
		project.read_project(project.write_project(job_id, tmp_path / "p.cutroom"), "opened")
		project.relink("opened", recording)
		recording.unlink()
		# A dangling symlink is exactly the "your file moved" case, and it has
		# to read as missing rather than as a file that happens to fail later.
		assert not project.source_is_available("opened")

	def test_an_opened_project_with_no_recording_yet_reads_as_unavailable(self, tmp_path):
		jobs.save_result("opened", "Ep1.mp4", RESULT)
		assert not project.source_is_available("opened")

	def test_relinking_to_nothing_is_refused(self, tmp_path):
		jobs.save_result("opened", "Ep1.mp4", RESULT)
		with pytest.raises(project.NotAProject, match="No such file"):
			project.relink("opened", tmp_path / "gone.mp4")

	def test_relinking_replaces_the_previous_recording(self, tmp_path):
		job_id, first = _job_with_everything(tmp_path)
		second = tmp_path / "Ep1-again.mov"
		second.write_bytes(b"different container")
		project.relink(job_id, second)
		assert jobs.input_path(job_id).resolve() == second.resolve()
		# The old `input.mp4` is gone, not left beside the new one where
		# `input_path`'s alphabetical pick could hand back the stale file.
		assert len(list(jobs.job_dir(job_id).glob("input.*"))) == 1


class TestPathsInsideProjects:
	def test_a_project_records_where_the_recording_really_is(self, tmp_path):
		"""Not the symlink inside the job directory, which means nothing on
		another machine."""
		job_id, recording = _job_with_everything(tmp_path)
		with zipfile.ZipFile(project.write_project(job_id, tmp_path / "p.cutroom")) as z:
			manifest = json.loads(z.read(project.MANIFEST_NAME))
		assert manifest["source"]["path"] == str(recording.resolve())
		assert manifest["source"]["sizeBytes"] == len(b"not really a video")

	def test_a_project_saved_without_a_recording_still_saves(self, tmp_path):
		job_id, _ = _job_with_everything(tmp_path, with_source=False)
		with zipfile.ZipFile(project.write_project(job_id, tmp_path / "p.cutroom")) as z:
			manifest = json.loads(z.read(project.MANIFEST_NAME))
		assert manifest["source"]["path"] is None

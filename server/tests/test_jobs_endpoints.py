"""Tests for the job-persistence layer wired into main.py: /process handing
back a job id instead of doing the work inline, /jobs listing and reopening
saved episodes, and /export reading its input from a job instead of a
second upload.

No real transcription/diarisation/face detection runs here -- `_run_pipeline`
is exercised directly with its heavy steps monkeypatched to fast fakes, the
same way test_error_reporting.py avoids real ffmpeg calls."""

import asyncio
import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
from pipeline import jobs, progress
from pipeline.diarize import DiarizationUnavailable
from pipeline.audio import NoAudioTrack

ORIGIN = "http://localhost:3460"
FACES = b'{"frameWidth": 1, "frameHeight": 1, "people": []}'


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
	monkeypatch.setattr(jobs, "JOBS_DIR", tmp_path)
	progress._jobs.clear()
	progress._faces.clear()
	progress._waveform.clear()
	progress._timeline_thumbnails.clear()


@pytest.fixture
def client():
	return TestClient(main.app, raise_server_exceptions=False)


def _fake_pipeline_steps(monkeypatch, *, transcribe_raises=None, gather_raises=None, unexpected=None):
	"""Stand in for the real, slow pipeline calls inside _run_pipeline."""
	monkeypatch.setattr(main, "extract_wav", lambda *a, **k: None)
	if transcribe_raises:
		monkeypatch.setattr(main, "extract_wav", lambda *a, **k: (_ for _ in ()).throw(transcribe_raises))

	def fake_transcribe_work(wav_path, job_id):
		if gather_raises:
			raise gather_raises
		return {"turns": [], "overlapWindows": [], "words": []}, object()

	def fake_faces_work(input_path, job_id):
		return {"frameWidth": 0, "frameHeight": 0, "people": []}

	def fake_match_work(video_path, wav_path, diarization, people, job_id):
		return {"speakerToPerson": {}, "matches": [], "notes": []}

	monkeypatch.setattr(main, "_transcribe_work", fake_transcribe_work)
	monkeypatch.setattr(main, "_faces_work", fake_faces_work)
	monkeypatch.setattr(main, "_match_work", fake_match_work)
	monkeypatch.setattr(main, "compute_waveform_peaks", lambda *a, **k: [0.1, 0.2])
	monkeypatch.setattr(main, "compute_timeline_thumbnails", lambda *a, **k: [b"\xff\xd8jpg"])
	monkeypatch.setattr(main, "get_video_duration", lambda *a, **k: 12.0)

	if unexpected:
		monkeypatch.setattr(main, "_match_work", lambda *a, **k: (_ for _ in ()).throw(unexpected))


class TestRunPipeline:
	"""Errors that used to become the /process response now have nowhere to
	go but report_error -- by the time any of them can happen, /process has
	already returned. Each of these pins that a specific failure still
	reaches the browser, just through a different door."""

	async def _run(self, tmp_path):
		input_path = tmp_path / "input.mp4"
		input_path.write_bytes(b"fake")
		await main._run_pipeline("j", input_path, "clip.mp4")

	def test_a_successful_run_saves_the_result(self, tmp_path, monkeypatch):
		_fake_pipeline_steps(monkeypatch)
		asyncio.run(self._run(tmp_path))
		result = jobs.load_result("j")
		assert result is not None
		assert result["faces"]["people"] == []
		assert progress.snapshot("j")["error"] is None

	def test_no_audio_track_is_reported_not_saved(self, tmp_path, monkeypatch):
		_fake_pipeline_steps(monkeypatch, transcribe_raises=NoAudioTrack("no audio track"))
		asyncio.run(self._run(tmp_path))
		assert jobs.load_result("j") is None
		assert progress.snapshot("j")["error"] == "no audio track"

	def test_diarisation_unavailable_is_reported_not_saved(self, tmp_path, monkeypatch):
		_fake_pipeline_steps(monkeypatch, gather_raises=DiarizationUnavailable("set HF_TOKEN"))
		asyncio.run(self._run(tmp_path))
		assert jobs.load_result("j") is None
		assert progress.snapshot("j")["error"] == "set HF_TOKEN"

	def test_an_unexpected_error_is_still_reported_not_swallowed(self, tmp_path, monkeypatch):
		# Nothing awaits this task once /process has returned -- without this
		# catch-all, an unexpected exception here would only ever show up as
		# an uvicorn log line, with the browser polling a job that silently
		# never finishes.
		_fake_pipeline_steps(monkeypatch, unexpected=RuntimeError("boom"))
		asyncio.run(self._run(tmp_path))
		assert jobs.load_result("j") is None
		assert "boom" in progress.snapshot("j")["error"]


class TestProcessEndpoint:
	def test_returns_a_job_id_without_waiting_for_the_pipeline(self, client, monkeypatch):
		monkeypatch.setattr(main, "diarization_configured", lambda: True)

		started = asyncio.Event()

		async def slow_pipeline(job_id, input_path, filename):
			started.set()
			await asyncio.sleep(10)  # would time the test out if actually awaited

		monkeypatch.setattr(main, "_run_pipeline", slow_pipeline)

		response = client.post(
			"/process",
			headers={"Origin": ORIGIN},
			files={"file": ("clip.mp4", b"fake video")},
			params={"jobId": "j1"},
		)
		assert response.status_code == 200
		assert response.json() == {"jobId": "j1"}
		# The task was scheduled, not run inline -- the endpoint returned
		# well under the 10s sleep above.

	def test_refuses_without_a_hugging_face_token(self, client, monkeypatch):
		monkeypatch.setattr(main, "diarization_configured", lambda: False)
		response = client.post(
			"/process",
			headers={"Origin": ORIGIN},
			files={"file": ("clip.mp4", b"fake video")},
		)
		assert response.status_code == 400


class TestProcessLocalEndpoint:
	"""The desktop app's path: no upload body, just a location on disk --
	see electron/preload.mjs and src/lib/electron.ts."""

	def test_returns_a_job_id_without_waiting_for_the_pipeline(self, client, monkeypatch, tmp_path):
		monkeypatch.setattr(main, "diarization_configured", lambda: True)
		source = tmp_path / "recording.mp4"
		source.write_bytes(b"fake video")

		started = asyncio.Event()

		async def slow_pipeline(job_id, input_path, filename):
			started.set()
			await asyncio.sleep(10)  # would time the test out if actually awaited

		monkeypatch.setattr(main, "_run_pipeline", slow_pipeline)

		response = client.post(
			"/process/local",
			headers={"Origin": ORIGIN},
			json={"path": str(source), "jobId": "j1"},
		)
		assert response.status_code == 200
		assert response.json() == {"jobId": "j1"}

	def test_reads_the_recording_in_place_rather_than_copying_it(self, client, monkeypatch, tmp_path):
		"""The whole point of this endpoint: the job's input is a symlink
		back to the source, not a second copy of the bytes."""
		monkeypatch.setattr(main, "diarization_configured", lambda: True)
		monkeypatch.setattr(main, "_run_pipeline", lambda *a, **k: asyncio.sleep(0))
		source = tmp_path / "recording.mp4"
		source.write_bytes(b"fake video")

		response = client.post(
			"/process/local",
			headers={"Origin": ORIGIN},
			json={"path": str(source), "jobId": "j2"},
		)
		assert response.status_code == 200
		input_path = jobs.input_path("j2")
		assert input_path is not None
		assert input_path.is_symlink()
		assert input_path.resolve() == source.resolve()

	def test_refuses_without_a_hugging_face_token(self, client, monkeypatch, tmp_path):
		monkeypatch.setattr(main, "diarization_configured", lambda: False)
		source = tmp_path / "recording.mp4"
		source.write_bytes(b"fake video")
		response = client.post("/process/local", headers={"Origin": ORIGIN}, json={"path": str(source)})
		assert response.status_code == 400

	def test_a_path_that_does_not_exist_400s_rather_than_500ing(self, client, monkeypatch, tmp_path):
		monkeypatch.setattr(main, "diarization_configured", lambda: True)
		response = client.post(
			"/process/local",
			headers={"Origin": ORIGIN},
			json={"path": str(tmp_path / "nope.mp4")},
		)
		assert response.status_code == 400


class TestSavedEpisodes:
	def test_an_unfinished_job_is_not_listed(self, client):
		jobs.save_input("j", "ep.mp4")
		assert client.get("/jobs").json() == []

	def test_a_finished_job_is_listed_and_fetchable(self, client):
		jobs.save_result("j", "ep.mp4", {"turns": ["x"]})
		listed = client.get("/jobs").json()
		assert len(listed) == 1 and listed[0]["jobId"] == "j" and listed[0]["filename"] == "ep.mp4"
		# The filename rides along on the result too -- a resumed session has
		# no browser-held upload left to read it from.
		assert client.get("/jobs/j").json() == {"turns": ["x"], "filename": "ep.mp4"}

	def test_reopening_an_unknown_job_404s(self, client):
		assert client.get("/jobs/nobody").status_code == 404

	def test_media_serves_the_original_upload(self, client):
		dest = jobs.save_input("j", "ep.mp4")
		dest.write_bytes(b"video bytes")
		response = client.get("/jobs/j/media")
		assert response.status_code == 200
		assert response.content == b"video bytes"

	def test_media_for_an_unknown_job_404s(self, client):
		assert client.get("/jobs/nobody/media").status_code == 404

	def test_deleting_a_job_removes_it_from_the_list(self, client):
		jobs.save_result("j", "ep.mp4", {})
		client.delete("/jobs/j")
		assert client.get("/jobs").json() == []
		assert client.get("/jobs/j").status_code == 404


class TestExportReadsTheSavedInput:
	def test_export_404s_when_the_job_has_no_saved_input(self, client):
		response = client.post(
			"/export",
			headers={"Origin": ORIGIN},
			files={"faces": ("faces.json", b'{"frameWidth": 1, "frameHeight": 1, "people": []}', "application/json")},
			data={"regions": "[]", "jobId": "nobody"},
		)
		assert response.status_code == 404
		assert "recording" in response.json()["detail"]


class TestExportToPath:
	"""The desktop app's path: no response body, a real file written where
	the user chose -- see src/lib/electron.ts's chooseExportPath."""

	def _prepare_job(self, job_id="j"):
		input_path = jobs.save_input(job_id, "clip.mp4")
		input_path.write_bytes(b"fake video")

	def test_writes_to_the_chosen_path_and_returns_it_as_json_not_bytes(self, client, monkeypatch, tmp_path):
		self._prepare_job()
		monkeypatch.setattr(main, "get_video_duration", lambda *a, **k: 5.0)

		def fake_render_export(input_path, output_path, segments, frame_w, frame_h, duration, ass_path=None, on_progress=None):
			Path(output_path).write_bytes(b"rendered mp4 bytes")

		monkeypatch.setattr(main, "render_export", fake_render_export)

		destination = tmp_path / "out" / "episode-edited.mp4"
		destination.parent.mkdir()

		response = client.post(
			"/export",
			headers={"Origin": ORIGIN},
			files={"faces": ("faces.json", FACES, "application/json")},
			data={"regions": "[]", "jobId": "j", "outputPath": str(destination)},
		)
		assert response.status_code == 200
		assert response.json() == {"outputPath": str(destination)}
		assert destination.read_bytes() == b"rendered mp4 bytes"

	def test_refuses_before_rendering_when_the_folder_does_not_exist(self, client):
		self._prepare_job()
		response = client.post(
			"/export",
			headers={"Origin": ORIGIN},
			files={"faces": ("faces.json", FACES, "application/json")},
			data={"regions": "[]", "jobId": "j", "outputPath": "/nonexistent-dir-xyz/out.mp4"},
		)
		assert response.status_code == 400

	def test_with_no_output_path_still_streams_a_response_as_before(self, client, monkeypatch):
		self._prepare_job()
		monkeypatch.setattr(main, "get_video_duration", lambda *a, **k: 5.0)

		def fake_render_export(input_path, output_path, segments, frame_w, frame_h, duration, ass_path=None, on_progress=None):
			Path(output_path).write_bytes(b"rendered mp4 bytes")

		monkeypatch.setattr(main, "render_export", fake_render_export)

		response = client.post(
			"/export",
			headers={"Origin": ORIGIN},
			files={"faces": ("faces.json", FACES, "application/json")},
			data={"regions": "[]", "jobId": "j"},
		)
		assert response.status_code == 200
		assert response.content == b"rendered mp4 bytes"
		assert response.headers["content-type"] == "video/mp4"


class TestExportProgress:
	"""GET /export/progress/{job_id}, polled alongside the still-open
	/export request above -- see render_export's on_progress."""

	def test_reports_zero_for_a_job_that_has_never_rendered(self, client):
		assert client.get("/export/progress/nobody").json() == {"fraction": 0.0}

	def test_reflects_render_export_s_on_progress_callback_while_it_runs(self, client, monkeypatch, tmp_path):
		input_path = jobs.save_input("j", "clip.mp4")
		input_path.write_bytes(b"fake video")
		monkeypatch.setattr(main, "get_video_duration", lambda *a, **k: 5.0)

		seen_mid_render = {}

		def fake_render_export(input_path, output_path, segments, frame_w, frame_h, duration, ass_path=None, on_progress=None):
			on_progress(0.5)
			# The endpoint's own progress store, read the same way the
			# frontend's poll would -- not just asserting the callback was
			# called, but that it actually reached somewhere pollable.
			seen_mid_render["fraction"] = progress.render_progress("j")
			Path(output_path).write_bytes(b"rendered mp4 bytes")

		monkeypatch.setattr(main, "render_export", fake_render_export)

		response = client.post(
			"/export",
			headers={"Origin": ORIGIN},
			files={"faces": ("faces.json", FACES, "application/json")},
			data={"regions": "[]", "jobId": "j"},
		)
		assert response.status_code == 200
		assert seen_mid_render == {"fraction": 0.5}
		# Cleared once the request that was rendering has returned -- nothing
		# left to poll for, and a stale 0.5 would misreport a finished job.
		assert client.get("/export/progress/j").json() == {"fraction": 0.0}

	def test_still_cleared_when_the_render_fails(self, client, monkeypatch):
		input_path = jobs.save_input("j", "clip.mp4")
		input_path.write_bytes(b"fake video")
		monkeypatch.setattr(main, "get_video_duration", lambda *a, **k: 5.0)

		def failing_render_export(*a, on_progress=None, **k):
			on_progress(0.3)
			raise subprocess.CalledProcessError(1, ["ffmpeg"], stderr=b"boom")

		monkeypatch.setattr(main, "render_export", failing_render_export)

		response = client.post(
			"/export",
			headers={"Origin": ORIGIN},
			files={"faces": ("faces.json", FACES, "application/json")},
			data={"regions": "[]", "jobId": "j"},
		)
		assert response.status_code == 500
		assert client.get("/export/progress/j").json() == {"fraction": 0.0}

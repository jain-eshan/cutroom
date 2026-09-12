import asyncio
import base64
import json
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from pipeline.audio import extract_wav
from pipeline.diarize import OverlapDetectionUnavailable, OverlapWindow, detect_overlap, diarize
from pipeline.faces import BBox, detect_and_track_faces, get_video_dimensions, get_video_duration
from pipeline.progress import report, snapshot
from pipeline.render import (
	Keyframe,
	LayoutChoice,
	OverlapSegment,
	Track,
	build_render_segments,
	render_export,
)
from pipeline.transcribe import transcribe
from pipeline.turns import build_turns

load_dotenv()

app = FastAPI(title="podcast-editor processing service")

app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:3460", "http://127.0.0.1:3460"],
	allow_methods=["*"],
	allow_headers=["*"],
)

# Editors upload real recordings -- 4K, multi-GB files. `UploadFile.read()`
# with no size arg pulls the whole thing into one in-memory `bytes` object;
# for a 5GB upload that's a 5GB allocation. Stream to disk in chunks instead.
UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024  # 4MB


async def _save_upload(file: UploadFile, dest: Path) -> None:
	with dest.open("wb") as f:
		while chunk := await file.read(UPLOAD_CHUNK_SIZE):
			f.write(chunk)


@app.get("/health")
def health() -> dict[str, str]:
	return {"status": "ok"}


@app.get("/progress/{job_id}")
def progress_endpoint(job_id: str) -> dict:
	"""Where a job has got to. Polled by the UI while processing runs -- a
	multi-minute wait with no feedback is indistinguishable from a hang."""
	return snapshot(job_id)


def _transcribe_work(wav_path: Path, num_speakers: int | None, job_id: str | None) -> dict:
	report(job_id, "transcribe", "transcribing speech")
	segments = transcribe(
		str(wav_path), progress=lambda f: report(job_id, "transcribe", "transcribing speech", f)
	)
	report(job_id, "transcribe", "identifying speakers", 1.0)
	speaker_segments = diarize(str(wav_path), num_speakers=num_speakers)
	turns = build_turns(segments, speaker_segments)

	try:
		report(job_id, "transcribe", "detecting overlapping speech", 1.0)
		overlap_windows = detect_overlap(str(wav_path), speaker_segments)
	except OverlapDetectionUnavailable as err:
		# Soft failure -- overlap detection needs a Hugging Face token that not
		# every install will have configured. Everything else still works; the
		# multi-speaker composite just won't have an automatic trigger.
		print(f"[process] overlap detection skipped: {err}")
		overlap_windows = []

	report(job_id, "transcribe", "done", 1.0, done=True)
	return {
		"turns": [
			{"speaker": t.speaker, "start": t.start, "end": t.end, "text": t.text} for t in turns
		],
		"overlapWindows": [
			{"start": w.start, "end": w.end, "speakers": w.speakers} for w in overlap_windows
		],
	}


def _faces_work(input_path: Path, job_id: str | None) -> dict:
	width, height = get_video_dimensions(str(input_path))
	report(job_id, "faces", "finding and recognising faces")
	people = detect_and_track_faces(
		str(input_path),
		progress=lambda f: report(job_id, "faces", "finding and recognising faces", f),
	)
	report(job_id, "faces", "done", 1.0, done=True)
	return {
		"frameWidth": width,
		"frameHeight": height,
		"people": [
			{
				"id": person.id,
				"thumbnail": "data:image/jpeg;base64," + base64.b64encode(person.thumbnail_jpeg).decode(),
				# How many sampled frames this person appeared in. The UI sorts
				# by it so actual participants come before anyone who wandered
				# through shot.
				"detectionCount": person.detection_count,
				"keyframes": [
					{
						"t": kf.t,
						"bbox": {
							"x": kf.bbox.x,
							"y": kf.bbox.y,
							"width": kf.bbox.width,
							"height": kf.bbox.height,
						},
					}
					for kf in person.keyframes
				],
			}
			for person in people
		],
	}


@app.post("/process")
async def process_endpoint(
	file: UploadFile, num_speakers: int | None = None, jobId: str | None = None
) -> dict:
	"""Transcript, speakers and people in one pass.

	This used to be two endpoints the frontend called in parallel, which meant
	the browser uploaded the same file twice -- 10GB of transfer for a 5GB
	recording, and roughly double the wait before any work started. One
	upload, then both analyses run concurrently in threads (OpenCV and
	CTranslate2 both release the GIL, so they genuinely overlap).
	"""
	with tempfile.TemporaryDirectory() as tmp:
		input_path = Path(tmp) / (file.filename or "input")
		report(jobId, "transcribe", "receiving upload")
		report(jobId, "faces", "receiving upload")
		await _save_upload(file, input_path)

		wav_path = Path(tmp) / "audio.wav"
		report(jobId, "transcribe", "extracting audio")
		extract_wav(input_path, wav_path)

		transcript, faces = await asyncio.gather(
			asyncio.to_thread(_transcribe_work, wav_path, num_speakers, jobId),
			asyncio.to_thread(_faces_work, input_path, jobId),
		)

	return {**transcript, "faces": faces}


@app.post("/export")
async def export_endpoint(
	file: UploadFile,
	# A file part, not a text field: Starlette caps text fields at 1MB, and face
	# keyframes grow with episode length (every sampled second, every person).
	# Measured: a 53-minute episode's faces are 1.7MB and the export 400'd with
	# "Part exceeded maximum size of 1024KB."
	faces: UploadFile,
	layoutChoices: str = Form(...),
	overlapSegments: str = Form(...),
	sessionId: str | None = Form(None),
) -> FileResponse:
	try:
		layout_choices_data = json.loads(layoutChoices)
		overlap_segments_data = json.loads(overlapSegments)
		faces_data = json.loads(await faces.read())
	except json.JSONDecodeError as err:
		raise HTTPException(400, f"Malformed JSON in request field: {err}") from err

	layout_choices = [
		LayoutChoice(
			turn_index=lc["turnIndex"],
			person_id=lc.get("personId"),
			start=lc["start"],
			end=lc["end"],
			default_layout=lc["defaultLayout"],
			final_layout=lc["finalLayout"],
		)
		for lc in layout_choices_data
	]
	overlap_segments = [
		OverlapSegment(start=w["start"], end=w["end"], person_ids=w["personIds"])
		for w in overlap_segments_data
	]
	people = [
		Track(
			id=t["id"],
			keyframes=[Keyframe(t=kf["t"], bbox=BBox(**kf["bbox"])) for kf in t["keyframes"]],
		)
		for t in faces_data["people"]
	]
	frame_w = faces_data["frameWidth"]
	frame_h = faces_data["frameHeight"]

	# Not a `with tempfile.TemporaryDirectory()` -- FileResponse below streams
	# the output from disk *after* this function returns, so the directory
	# has to survive past the return. Cleaned up via BackgroundTask instead,
	# which Starlette runs once the response has actually been sent.
	tmp = tempfile.mkdtemp()
	try:
		input_path = Path(tmp) / (file.filename or "input")
		await _save_upload(file, input_path)
		duration = get_video_duration(str(input_path))

		segments = build_render_segments(
			duration=duration,
			overlap_segments=overlap_segments,
			layout_choices=layout_choices,
			people=people,
		)

		output_path = Path(tmp) / "export.mp4"
		render_export(input_path, output_path, segments, frame_w, frame_h)
	except subprocess.CalledProcessError as err:
		shutil.rmtree(tmp, ignore_errors=True)
		stderr_tail = (err.stderr or b"").decode(errors="replace")[-2000:]
		raise HTTPException(500, f"Render failed: {stderr_tail}") from err
	except Exception:
		shutil.rmtree(tmp, ignore_errors=True)
		raise

	if sessionId:
		_log_decision(sessionId, layout_choices_data)

	output_name = f"{Path(file.filename or 'export').stem}-edited.mp4"
	return FileResponse(
		output_path,
		media_type="video/mp4",
		filename=output_name,
		background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True),
	)


def _log_decision(session_id: str, layout_choices: list[dict]) -> None:
	log_dir = Path(__file__).parent / "logs" / session_id
	log_dir.mkdir(parents=True, exist_ok=True)
	log_path = log_dir / "decisions.jsonl"
	entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "layoutChoices": layout_choices}
	with log_path.open("a") as f:
		f.write(json.dumps(entry) + "\n")

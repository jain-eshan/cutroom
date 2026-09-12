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

from pipeline.audio import NoAudioTrack, extract_wav
from pipeline.captions import build_caption_cues, write_ass
from pipeline.diarize import Diarization, DiarizationUnavailable, diarize
from pipeline.fuse import fuse
from pipeline.faces import BBox, detect_and_track_faces, get_video_dimensions, get_video_duration
from pipeline.lipsync import analyse
from pipeline.progress import report, snapshot
from pipeline.render import (
	Keyframe,
	LayoutChoice,
	OverlapSegment,
	Track,
	build_render_segments,
	has_ass_filter,
	render_export,
)
from pipeline.transcribe import Word, transcribe
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


def _transcribe_work(wav_path: Path, job_id: str | None) -> tuple[dict, Diarization]:
	report(job_id, "transcribe", "transcribing speech")
	segments = transcribe(
		str(wav_path), progress=lambda f: report(job_id, "transcribe", "transcribing speech", f)
	)
	report(job_id, "transcribe", "identifying speakers", 1.0)
	# One pass: speaker turns and the stretches where people talk over each
	# other come out of the same model, so overlap no longer needs a second
	# model or a guess about which speakers were involved.
	diarization = diarize(str(wav_path))
	turns = build_turns(segments, diarization.segments)

	report(job_id, "transcribe", "done", 1.0, done=True)
	return {
		"turns": [
			{"speaker": t.speaker, "start": t.start, "end": t.end, "text": t.text} for t in turns
		],
		"overlapWindows": [
			{"start": w.start, "end": w.end, "speakers": w.speakers} for w in diarization.overlaps
		],
		# Word-level timestamps, independent of turn boundaries -- captions need
		# tighter timing than a turn provides (see pipeline/captions.py).
		"words": [
			{"start": w.start, "end": w.end, "text": w.text} for seg in segments for w in seg.words
		],
	}, diarization


def _match_work(
	video_path: Path, wav_path: Path, diarization: Diarization, people: list[dict], job_id: str | None
) -> dict:
	"""Work out which face each voice belongs to.

	This is the step that used to be the human's job in the cast screen. It
	still is -- the result is a suggestion the editor confirms -- but it starts
	from evidence rather than from a blank grid.
	"""
	report(job_id, "match", "matching voices to faces")
	lip = analyse(
		str(video_path),
		str(wav_path),
		people,
		progress=lambda f: report(job_id, "match", "matching voices to faces", f),
	)
	result = fuse(diarization.segments, lip.speaking_per_second(), lip.person_ids)
	report(job_id, "match", "done", 1.0, done=True)
	return {
		"speakerToPerson": result.speaker_to_person(),
		"matches": [
			{
				"speaker": m.speaker,
				"personId": m.person_id,
				"confidence": m.confidence,
				"judgedSeconds": m.judged_seconds,
			}
			for m in result.matches
		],
		"notes": result.notes,
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
async def process_endpoint(file: UploadFile, jobId: str | None = None) -> dict:
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
		try:
			extract_wav(input_path, wav_path)
		except NoAudioTrack as err:
			raise HTTPException(400, str(err)) from err

		try:
			(transcript, diarization), faces = await asyncio.gather(
				asyncio.to_thread(_transcribe_work, wav_path, jobId),
				asyncio.to_thread(_faces_work, input_path, jobId),
			)
		except DiarizationUnavailable as err:
			# Setup problem, not a server fault: the message says exactly what to
			# do, so it needs to reach the user rather than become a 500.
			raise HTTPException(400, str(err)) from err

		# Third, not concurrent: it needs both of the above to have finished.
		match = await asyncio.to_thread(
			_match_work, input_path, wav_path, diarization, faces["people"], jobId
		)

	return {**transcript, "faces": faces, "match": match}


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
	# Also a file part, and for the same reason as faces: word timestamps grow
	# with episode length. A 53-minute episode is ~550KB of them, which fits
	# under the 1MB text-field cap only by luck; a two-hour one would not.
	words: UploadFile | None = None,
	captions: bool = Form(False),
) -> FileResponse:
	try:
		layout_choices_data = json.loads(layoutChoices)
		overlap_segments_data = json.loads(overlapSegments)
		faces_data = json.loads(await faces.read())
		words_data = json.loads(await words.read()) if words is not None else []
	except json.JSONDecodeError as err:
		raise HTTPException(400, f"Malformed JSON in request field: {err}") from err

	# Before the upload is saved and the render starts, not after: a full-length
	# export is ~15 minutes of work, and silently dropping the captions someone
	# explicitly asked for is worse than refusing the job.
	if captions and words_data and not has_ass_filter():
		raise HTTPException(
			400,
			"This ffmpeg was built without libass, so captions cannot be burned in. "
			"Homebrew's regular `ffmpeg` formula omits it: `brew install ffmpeg-full` "
			"has it, then point the server at that binary by putting "
			"FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg in server/.env. "
			"Or export without captions to continue with this build.",
		)

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

		ass_path: Path | None = None
		if captions and words_data:
			words_list = [Word(start=w["start"], end=w["end"], text=w["text"]) for w in words_data]
			cues = build_caption_cues(words_list)
			ass_path = Path(tmp) / "captions.ass"
			write_ass(cues, ass_path, frame_w, frame_h)

		output_path = Path(tmp) / "export.mp4"
		render_export(input_path, output_path, segments, frame_w, frame_h, ass_path=ass_path)
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

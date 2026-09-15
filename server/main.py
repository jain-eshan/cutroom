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
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

from pipeline.audio import NoAudioTrack, extract_wav
from pipeline.captions import CaptionCue, build_caption_cues, write_ass
from pipeline.diarize import Diarization, DiarizationUnavailable, diarize
from pipeline.faces import BBox, detect_and_track_faces, get_video_dimensions, get_video_duration
from pipeline.fuse import fuse
from pipeline.lipsync import analyse
from pipeline.progress import face_thumbnail, report, report_line, report_people, snapshot
from pipeline.render import (
	Keyframe,
	Region,
	Track,
	build_render_segments,
	has_ass_filter,
	render_export,
)
from pipeline.transcribe import Word, transcribe
from pipeline.trim import dead_air_ranges, filler_word_ranges, merge_ranges, remap_time
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
def health() -> dict[str, object]:
	"""Liveness, plus which optional capabilities this install actually has.

	The setup gate shows one row per capability so it can name what is
	missing instead of reporting a generic connection failure, and captions
	being unavailable is a normal state of a macOS ffmpeg, not a fault.
	"""
	return {"status": "ok", "captions": has_ass_filter()}


@app.get("/progress/{job_id}")
def progress_endpoint(job_id: str) -> dict:
	"""Where a job has got to. Polled by the UI while processing runs -- a
	multi-minute wait with no feedback is indistinguishable from a hang."""
	return snapshot(job_id)


@app.get("/progress/{job_id}/face/{person_id}")
def progress_face(job_id: str, person_id: int) -> Response:
	"""One recognised face, while processing is still running.

	Its own endpoint rather than a field on the snapshot: these are crops off
	full-resolution frames, and the snapshot is polled every few hundred ms.
	Immutable once written, so the browser fetches each one exactly once.
	"""
	data = face_thumbnail(job_id, person_id)
	if data is None:
		raise HTTPException(404, "No such face for this job.")
	return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


def _transcribe_work(wav_path: Path, job_id: str | None) -> tuple[dict, Diarization]:
	report(job_id, "transcribe", "transcribing speech")
	segments = transcribe(
		str(wav_path),
		progress=lambda f: report(job_id, "transcribe", "transcribing speech", f),
		on_segment=lambda seg, total: report_line(job_id, seg.text, seg.end, total),
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
		"notes": [
			{"kind": n.kind, "speakers": n.speakers, "personIds": n.person_ids} for n in result.notes
		],
	}


def _faces_work(input_path: Path, job_id: str | None) -> dict:
	width, height = get_video_dimensions(str(input_path))
	report(job_id, "faces", "finding and recognising faces")
	people = detect_and_track_faces(
		str(input_path),
		progress=lambda f: report(job_id, "faces", "finding and recognising faces", f),
	)
	report_people(job_id, {p.id: p.thumbnail_jpeg for p in people})
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
	regions: str = Form(...),
	# Only needed when trimming: dead-air detection works from where speech
	# actually is, which regions deliberately don't describe (a stretch nobody
	# framed is still speech, and cutting it would be silent data loss).
	turns: str = Form("[]"),
	sessionId: str | None = Form(None),
	# Also a file part, and for the same reason as faces: word timestamps grow
	# with episode length. A 53-minute episode is ~550KB of them, which fits
	# under the 1MB text-field cap only by luck; a two-hour one would not.
	words: UploadFile | None = None,
	captions: bool = Form(False),
	trimDeadAir: bool = Form(False),
) -> FileResponse:
	try:
		regions_data = json.loads(regions)
		turns_data = json.loads(turns)
		faces_data = json.loads(await faces.read())
		words_data = json.loads(await words.read()) if words is not None else []
	except json.JSONDecodeError as err:
		raise HTTPException(400, f"Malformed JSON in request field: {err}") from err
	words_list = [Word(start=w["start"], end=w["end"], text=w["text"]) for w in words_data]

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

	framing_regions = [
		Region(
			start=r["start"],
			end=r["end"],
			layout=r["layout"],
			person_ids=r["personIds"],
			source=r.get("source", "suggested"),
		)
		for r in regions_data
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

		# Dead air / filler words to cut, if asked for. Computed from the
		# speaker turns plus word-level timestamps when they're available --
		# filler-word detection needs them, dead-air detection alone doesn't.
		# See pipeline/trim.py for why these are deliberately conservative.
		drop_ranges: list[tuple[float, float]] = []
		if trimDeadAir:
			turn_bounds = [(t["start"], t["end"]) for t in turns_data]
			ranges = dead_air_ranges(turn_bounds, duration)
			if words_list:
				ranges += filler_word_ranges(words_list)
			drop_ranges = merge_ranges(ranges)

		segments = build_render_segments(
			duration=duration,
			regions=framing_regions,
			people=people,
			drop_ranges=drop_ranges,
		)

		ass_path: Path | None = None
		if captions and words_list:
			cues = build_caption_cues(words_list)
			if drop_ranges:
				# Cue timestamps were computed against the untrimmed source;
				# without this they'd drift out of sync with the trimmed
				# video by however much was already cut before each cue.
				cues = [
					CaptionCue(
						start=remap_time(cue.start, drop_ranges),
						end=remap_time(cue.end, drop_ranges),
						text=cue.text,
					)
					for cue in cues
				]
			ass_path = Path(tmp) / "captions.ass"
			write_ass(cues, ass_path, frame_w, frame_h)

		output_path = Path(tmp) / "export.mp4"
		render_export(input_path, output_path, segments, frame_w, frame_h, duration, ass_path=ass_path)
	except subprocess.CalledProcessError as err:
		shutil.rmtree(tmp, ignore_errors=True)
		stderr_tail = (err.stderr or b"").decode(errors="replace")[-2000:]
		raise HTTPException(500, f"Render failed: {stderr_tail}") from err
	except Exception:
		shutil.rmtree(tmp, ignore_errors=True)
		raise

	if sessionId:
		_log_decision(sessionId, regions_data)

	output_name = f"{Path(file.filename or 'export').stem}-edited.mp4"
	return FileResponse(
		output_path,
		media_type="video/mp4",
		filename=output_name,
		background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True),
	)


def _log_decision(session_id: str, regions: list[dict]) -> None:
	log_dir = Path(__file__).parent / "logs" / session_id
	log_dir.mkdir(parents=True, exist_ok=True)
	log_path = log_dir / "decisions.jsonl"
	# `source` on each region is the whole point of keeping these: the
	# difference between what was suggested and what the editor made it is the
	# only signal we have about where the automatic framing is wrong.
	entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "regions": regions}
	with log_path.open("a") as f:
		f.write(json.dumps(entry) + "\n")

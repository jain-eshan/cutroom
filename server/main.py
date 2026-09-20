import asyncio
import base64
import contextlib
import json
import logging
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Body, FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.background import BackgroundTask

from pipeline.audio import NoAudioTrack, extract_wav
from pipeline.captions import CaptionCue, build_caption_cues, write_ass
from pipeline.diarize import (
	MISSING_MODEL_MESSAGE,
	Diarization,
	DiarizationUnavailable,
	diarization_configured,
	diarize,
)
from pipeline.faces import BBox, detect_and_track_faces, get_video_dimensions, get_video_duration
from pipeline.fuse import fuse
from pipeline import jobs
from pipeline.lipsync import analyse
from pipeline.paths import DATA_DIR
from pipeline.progress import (
	clear_render_progress,
	face_thumbnail,
	render_progress,
	report,
	report_error,
	report_line,
	report_people,
	report_render_progress,
	report_timeline_thumbnails,
	report_waveform,
	snapshot,
	timeline_thumbnail,
	waveform_peaks,
)
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
from pipeline.waveform import compute_timeline_thumbnails, compute_waveform_peaks

# Explicit rather than dotenv's search-upward default: in a packaged install
# any settings live beside the rest of this install's data, not next to the
# source. Same file as before in dev, where DATA_DIR is server/ itself. Only
# FFMPEG_BINARY is read from it now; HF_TOKEN is no longer used anywhere.
load_dotenv(DATA_DIR / ".env")

app = FastAPI(title="Cutroom processing service")


class ReportUnexpectedErrors:
	"""Turn an unhandled exception into a readable JSON 500.

	Without this, Starlette answers an unhandled exception from its outermost
	error middleware -- outside CORSMiddleware -- so the 500 carries no
	access-control-allow-origin header. The browser throws that response away
	and the app reports "Could not reach the local processing service" while
	the service is up and holding a real error. Registered before the CORS
	middleware so CORS wraps it and adds the header.

	Only errors raised before a response has started can be reported this way;
	one raised mid-stream (a download already under way) is re-raised.
	"""

	def __init__(self, app):
		self.app = app

	async def __call__(self, scope, receive, send):
		if scope["type"] != "http":
			await self.app(scope, receive, send)
			return
		started = False

		async def tracked_send(message):
			nonlocal started
			if message["type"] == "http.response.start":
				started = True
			await send(message)

		try:
			await self.app(scope, receive, tracked_send)
		except Exception as err:
			if started:
				raise
			# The full traceback still goes to the service log, where the setup
			# screen can show it; the response carries the one-line version.
			logging.getLogger("uvicorn.error").exception("Unhandled error on %s", scope.get("path"))
			response = JSONResponse({"detail": f"{type(err).__name__}: {err}"}, status_code=500)
			await response(scope, receive, send)


class RefuseUploadsThatWontFit:
	"""Turn away a `/process` upload the disk can't hold, before reading it.

	This has to be middleware rather than a check inside the endpoint.
	FastAPI resolves `file: UploadFile` before it calls the path function, so
	by the time any line of `process_endpoint` runs, Starlette has already
	read the whole body into a `SpooledTemporaryFile` -- in memory up to 1MB,
	then rolled over to a real file in the system temp directory. For a 5GB
	recording that is 5GB written to disk before the endpoint gets a word in,
	which is exactly the thing being prevented. Here, the body has not been
	touched yet: only the headers have arrived.

	`Content-Length` is the browser's own count of what it is about to send,
	so the size is measured rather than guessed; a request without one (a
	chunked upload -- nothing in this app sends one) is let through rather
	than refused on a number that isn't there.
	"""

	def __init__(self, app):
		self.app = app

	async def __call__(self, scope, receive, send):
		if scope["type"] == "http" and scope["method"] == "POST" and scope["path"] == "/process":
			headers = {k.decode(): v.decode() for k, v in scope["headers"]}
			declared = headers.get("content-length", "")
			problem = jobs.space_problem(int(declared) if declared.isdigit() else 0, "take this recording")
			if problem:
				await JSONResponse({"detail": problem}, status_code=507)(scope, receive, send)
				return
		await self.app(scope, receive, send)


@app.exception_handler(ValueError)
async def _value_error_handler(request, err: ValueError) -> JSONResponse:
	"""A malformed job id (`pipeline.jobs.job_dir`'s validation) is a bad
	request, not a server bug -- give it a 400 instead of falling through to
	`ReportUnexpectedErrors`'s generic 500."""
	return JSONResponse({"detail": str(err)}, status_code=400)


app.add_middleware(ReportUnexpectedErrors)
app.add_middleware(RefuseUploadsThatWontFit)
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
	return {
		"status": "ok",
		# Required, unlike captions: without speaker turns there is nothing to
		# edit, so the setup gate won't let anyone past until this is true.
		"diarization": diarization_configured(),
		"captions": has_ass_filter(),
	}


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


@app.get("/progress/{job_id}/waveform")
def progress_waveform(job_id: str) -> dict:
	"""The episode's amplitude envelope, for the timeline overview strip."""
	peaks = waveform_peaks(job_id)
	if peaks is None:
		raise HTTPException(404, "No waveform for this job.")
	return {"peaks": peaks}


@app.get("/progress/{job_id}/thumbnail/{index}")
def progress_thumbnail(job_id: str, index: int) -> Response:
	"""One sampled frame for the timeline overview strip's scrubber.

	Its own endpoint for the same reason as the face crops: these are JPEGs,
	and the snapshot is polled every few hundred ms.
	"""
	data = timeline_thumbnail(job_id, index)
	if data is None:
		raise HTTPException(404, "No such thumbnail for this job.")
	return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


@app.get("/jobs")
def list_jobs_endpoint() -> list[dict]:
	"""Saved episodes: every job that finished processing, newest first. An
	in-progress job isn't here yet -- reopening only means "skip
	reprocessing", and a job that hasn't finished has nothing to reopen."""
	return jobs.list_jobs()


@app.get("/jobs/{job_id}")
def get_job_endpoint(job_id: str) -> dict:
	"""The saved result of a finished job -- what `/process` used to hand
	back directly, before it started returning as soon as the upload lands
	and running the pipeline in the background. `filename` rides along too:
	a resumed or reopened session has no browser-held upload to read it from
	any more, and the editor's title bar and export both want it."""
	result = jobs.load_result(job_id)
	if result is None:
		raise HTTPException(404, "No finished job with that id.")
	return {**result, "filename": jobs.original_filename(job_id)}


@app.get("/jobs/{job_id}/media")
def job_media_endpoint(job_id: str) -> FileResponse:
	"""The original recording, for a reopened saved episode -- there's no
	browser-held `File` object to play from once the tab that uploaded it is
	gone. `FileResponse` serves Range requests on its own, which video
	playback and scrubbing both need."""
	path = jobs.input_path(job_id)
	if path is None:
		raise HTTPException(404, "No uploaded recording for that job.")
	return FileResponse(path)


@app.delete("/jobs/{job_id}")
async def delete_job_endpoint(job_id: str) -> dict[str, bool]:
	# Cancel the pipeline before removing its directory, not after: jobs.py's
	# save_* functions all call _ensure_dir first, so a still-running task
	# just recreates what this deletes on its very next write.
	task = _running_jobs.get(job_id)
	if task is not None:
		task.cancel()
		with contextlib.suppress(asyncio.CancelledError):
			await task
	jobs.delete_job(job_id)
	return {"ok": True}


def _transcribe_work(wav_path: Path, job_id: str | None) -> tuple[dict, Diarization]:
	report(job_id, "transcribe", "transcribing speech")
	segments = transcribe(
		str(wav_path),
		progress=lambda f: report(job_id, "transcribe", "transcribing speech", f),
		on_segment=lambda seg, total: report_line(job_id, seg.text, seg.end, total),
		on_loading=lambda label: report(job_id, "transcribe", label),
	)
	report(job_id, "transcribe", "identifying speakers", 1.0)
	# One pass: speaker turns and the stretches where people talk over each
	# other come out of the same model, so overlap no longer needs a second
	# model or a guess about which speakers were involved.
	diarization = diarize(str(wav_path), on_loading=lambda label: report(job_id, "transcribe", label))
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
		download_progress=lambda label, f: report(job_id, "match", label, f),
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
		download_progress=lambda label, f: report(job_id, "faces", label, f),
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


# Fire-and-forget tasks need a live reference somewhere, or asyncio is free to
# garbage-collect one mid-run -- a real gotcha, not a hypothetical one. This
# is that somewhere; `_run_pipeline`'s own done-callback is what empties it.
_background_jobs: set[asyncio.Task] = set()
# job_id -> its running pipeline task, so a delete can cancel the work
# instead of just removing the directory out from under it. Before this,
# jobs._ensure_dir recreated the directory on the pipeline's next write
# (save_result, save_waveform, ...) regardless of the delete, so a "deleted"
# job could reappear in GET /jobs afterwards -- with its input file gone
# (deleted before the resurrection), so unplayable and only removable by
# deleting it a second time.
_running_jobs: dict[str, asyncio.Task] = {}


def _start_pipeline(job_id: str, input_path: Path, filename: str) -> None:
	task = asyncio.create_task(_run_pipeline(job_id, input_path, filename))
	_background_jobs.add(task)
	_running_jobs[job_id] = task

	def _done(t: asyncio.Task) -> None:
		_background_jobs.discard(t)
		if _running_jobs.get(job_id) is t:
			del _running_jobs[job_id]

	task.add_done_callback(_done)


async def _run_pipeline(job_id: str, input_path: Path, filename: str) -> None:
	"""Transcript, speakers and people in one pass -- everything `/process`
	used to do inline, moved to a task that outlives the request.

	Errors that used to become an HTTP response (a missing audio track, a
	diarisation setup problem) can't do that anymore -- by the time either
	happens, `/process` has already returned. `report_error` is how they
	reach the browser instead: it polls `/progress/{job_id}` regardless of
	whether the request that started the job is still open.
	"""
	try:
		wav_path = jobs.wav_path(job_id)
		report(job_id, "transcribe", "extracting audio")
		try:
			extract_wav(input_path, wav_path)
		except NoAudioTrack as err:
			report_error(job_id, str(err))
			return

		# Both analyses run concurrently in threads (OpenCV and CTranslate2
		# both release the GIL, so they genuinely overlap).
		try:
			(transcript, diarization), faces = await asyncio.gather(
				asyncio.to_thread(_transcribe_work, wav_path, job_id),
				asyncio.to_thread(_faces_work, input_path, job_id),
			)
		except DiarizationUnavailable as err:
			# Setup problem, not a server fault: the message says exactly what
			# to do, so it needs to reach the user rather than become a
			# traceback in the log with nothing on screen.
			report_error(job_id, str(err))
			return

		# Cheap enough (numpy over an already-decoded 16kHz mono wav) to run
		# inline on the event loop rather than earning its own thread or
		# progress stage -- unlike the two steps above, there's nothing here to
		# overlap with.
		report_waveform(job_id, compute_waveform_peaks(str(wav_path)))

		# Real decode work -- every sampled frame goes through OpenCV -- so
		# this runs in a thread the same way face detection does.
		duration = get_video_duration(str(input_path))
		thumbnails = await asyncio.to_thread(compute_timeline_thumbnails, str(input_path), duration)
		report_timeline_thumbnails(job_id, thumbnails)

		# Third, not concurrent: it needs both of the above to have finished.
		match = await asyncio.to_thread(
			_match_work, input_path, wav_path, diarization, faces["people"], job_id
		)

		jobs.save_result(job_id, filename, {**transcript, "faces": faces, "match": match})
	except Exception as err:
		# Nothing awaits this task, so an uncaught exception here would only
		# ever surface as an uvicorn log line nobody's watching -- the same
		# silent failure `ReportUnexpectedErrors` exists to avoid for a real
		# request. This is that same guarantee for a background one.
		logging.getLogger("uvicorn.error").exception("Background job %s failed", job_id)
		report_error(job_id, f"{type(err).__name__}: {err}")
	finally:
		# Every way out of this function is the end of the pipeline -- success,
		# a reported failure, an unexpected one, or cancellation by `DELETE
		# /jobs/{id}` -- and nothing reads the wav afterwards. A `finally`
		# rather than a line after `save_result` so the ~115MB/hour isn't
		# stranded by the paths that return early. See `jobs.discard_wav` for
		# why it must not go through `wav_path`.
		jobs.discard_wav(job_id)


@app.post("/process")
async def process_endpoint(file: UploadFile, jobId: str | None = None) -> dict:
	"""Saves the upload and starts processing, returning a job id right away.

	Used to do the whole pipeline inline and hand back the full result --
	simple, but it meant closing the tab (or even a slow connection blinking)
	killed the job outright: Starlette cancels a handler's coroutine the
	moment the client disconnects. Detaching the pipeline into a background
	task means the browser dropping off doesn't stop it; poll
	`/progress/{job_id}` for status and `GET /jobs/{job_id}` for the result
	once it's done, from this tab or a fresh one.
	"""
	# Before the upload is saved, not after transcription: diarisation runs
	# second, so a missing token used to surface minutes into the job.
	if not diarization_configured():
		raise HTTPException(400, MISSING_MODEL_MESSAGE)

	job_id = jobId or str(uuid.uuid4())
	report(job_id, "transcribe", "receiving upload")
	report(job_id, "faces", "receiving upload")
	input_path = jobs.save_input(job_id, file.filename or "input")
	await _save_upload(file, input_path)

	_start_pipeline(job_id, input_path, file.filename or "input")

	return {"jobId": job_id}


@app.post("/process/local")
async def process_local_endpoint(path: str = Body(..., embed=True), jobId: str | None = Body(None, embed=True)) -> dict:
	"""Same as `/process`, for the desktop app: the recording already exists
	on this machine, so point at it instead of uploading a copy through the
	request body -- for a multi-GB recording, that copy is most of what
	makes `/process` slow. `path` only ever comes from Electron's
	`webUtils.getPathForFile`, which resolves solely for a file the user
	actually picked or dropped (see `electron/preload.mjs`); nothing else in
	this app lets the renderer name an arbitrary path.

	Symlinked into the job's own directory rather than copied, so "reads it
	where it is" is literal -- the trade-off being that moving or deleting
	the source after this point breaks the job, same as it would break any
	other app with the file open.
	"""
	if not diarization_configured():
		raise HTTPException(400, MISSING_MODEL_MESSAGE)

	source = Path(path)
	if not source.is_file():
		raise HTTPException(400, f"No such file: {path}")

	# Nothing is copied here, so the recording's own size isn't the cost --
	# the extracted wav and the thumbnails are, which is what the margin
	# covers. Still worth refusing up front rather than failing on the wav
	# write a minute in.
	problem = jobs.space_problem(0, "process this recording")
	if problem:
		raise HTTPException(507, problem)

	job_id = jobId or str(uuid.uuid4())
	report(job_id, "transcribe", "reading the recording")
	report(job_id, "faces", "reading the recording")
	input_path = jobs.save_input(job_id, source.name)
	input_path.symlink_to(source.resolve())

	_start_pipeline(job_id, input_path, source.name)

	return {"jobId": job_id}


@app.post("/export")
async def export_endpoint(
	# A file part, not a text field: Starlette caps text fields at 1MB, and face
	# keyframes grow with episode length (every sampled second, every person).
	# Measured: a 53-minute episode's faces are 1.7MB and the export 400'd with
	# "Part exceeded maximum size of 1024KB."
	faces: UploadFile,
	# The original recording no longer rides along with this request -- it's
	# already on disk from /process (see pipeline/jobs.py), and re-uploading
	# a multi-GB file a second time just to export it was pure waste. Also
	# what locates the decision log, so it's required rather than optional
	# the way the old sessionId was.
	jobId: str = Form(...),
	regions: str = Form(...),
	# Only needed when trimming: dead-air detection works from where speech
	# actually is, which regions deliberately don't describe (a stretch nobody
	# framed is still speech, and cutting it would be silent data loss).
	turns: str = Form("[]"),
	# Also a file part, and for the same reason as faces: word timestamps grow
	# with episode length. A 53-minute episode is ~550KB of them, which fits
	# under the 1MB text-field cap only by luck; a two-hour one would not.
	words: UploadFile | None = None,
	captions: bool = Form(False),
	trimDeadAir: bool = Form(False),
	# Only sent by the desktop app, where a folder to write into actually
	# exists -- see src/lib/electron.ts's chooseExportPath. A plain browser
	# has nowhere to write to but the request's own response body.
	outputPath: str | None = Form(None),
) -> Response:
	if outputPath and not Path(outputPath).parent.is_dir():
		raise HTTPException(400, f"That folder doesn't exist: {Path(outputPath).parent}")

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
			crop_nudge=(r.get("cropNudge", {}).get("x", 0.0), r.get("cropNudge", {}).get("y", 0.0)),
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

	input_path = jobs.input_path(jobId)
	if input_path is None:
		raise HTTPException(404, "No uploaded recording found for that job. Try exporting from the editor again.")

	# Same reasoning as the libass check above -- refuse before ~15 minutes of
	# work rather than during it. The render is written to a temp directory
	# under the data directory first even when `outputPath` sends it elsewhere
	# afterwards, so this is the filesystem that has to hold it. The source's
	# own size is the estimate: same resolution and stream-copied audio, and
	# the one full-length measurement (5.3GB in, 3.5GB out) came in under it,
	# so it errs high rather than inventing a compression ratio.
	problem = jobs.space_problem(input_path.stat().st_size, "render this episode")
	if problem:
		raise HTTPException(507, problem)

	# Not a `with tempfile.TemporaryDirectory()` -- FileResponse below streams
	# the output from disk *after* this function returns, so the directory
	# has to survive past the return. Cleaned up via BackgroundTask instead,
	# which Starlette runs once the response has actually been sent.
	tmp = tempfile.mkdtemp()
	try:
		duration = await asyncio.to_thread(get_video_duration, str(input_path))

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
		try:
			await asyncio.to_thread(
				render_export,
				input_path,
				output_path,
				segments,
				frame_w,
				frame_h,
				duration,
				ass_path=ass_path,
				on_progress=lambda f: report_render_progress(jobId, f),
			)
		finally:
			# Whether it finished or failed -- either way there's nothing left
			# to poll for. GET /export/progress reports 0 for a job it's never
			# heard of, so a request that lands right after this is a no-op,
			# not an error.
			clear_render_progress(jobId)
	except subprocess.CalledProcessError as err:
		shutil.rmtree(tmp, ignore_errors=True)
		stderr_tail = (err.stderr or b"").decode(errors="replace")[-2000:]
		raise HTTPException(500, f"Render failed: {stderr_tail}") from err
	except Exception:
		shutil.rmtree(tmp, ignore_errors=True)
		raise

	_log_decision(jobId, regions_data)

	if outputPath:
		# Moved rather than streamed back: the point of this branch is that
		# the render never has to pass through the renderer's memory at all.
		# `shutil.move` copies-then-deletes instead of a fast rename when
		# outputPath is on a different filesystem than the temp dir.
		shutil.move(str(output_path), outputPath)
		shutil.rmtree(tmp, ignore_errors=True)
		return JSONResponse({"outputPath": outputPath})

	original_name = jobs.original_filename(jobId) or input_path.name
	output_name = f"{Path(original_name).stem}-edited.mp4"
	return FileResponse(
		output_path,
		media_type="video/mp4",
		filename=output_name,
		background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True),
	)


@app.get("/export/progress/{job_id}")
def export_progress(job_id: str) -> dict[str, float]:
	"""Polled alongside the still-open `/export` request above -- real
	progress parsed from ffmpeg's own output (see render_export), not a
	guess from elapsed time. 0 both before a render has started and after
	it's finished; the caller already knows which from its own `/export`
	promise, so there's nothing to disambiguate here."""
	return {"fraction": render_progress(job_id)}


def _log_decision(session_id: str, regions: list[dict]) -> None:
	# Kept out of the job's own directory on purpose: deleting an episode
	# shouldn't delete the record of what the editor changed about it, which
	# is the only measure of where the automatic framing is wrong.
	log_dir = DATA_DIR / "logs" / jobs.validate_job_id(session_id)
	log_dir.mkdir(parents=True, exist_ok=True)
	log_path = log_dir / "decisions.jsonl"
	# `source` on each region is the whole point of keeping these: the
	# difference between what was suggested and what the editor made it is the
	# only signal we have about where the automatic framing is wrong.
	entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "regions": regions}
	with log_path.open("a") as f:
		f.write(json.dumps(entry) + "\n")

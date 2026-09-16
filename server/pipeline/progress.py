"""Tiny in-process progress registry.

Processing a real recording takes minutes, and with no feedback the app is
indistinguishable from one that has hung. This lets each endpoint report
which stage it's in and how far through, so the UI can say something
truthful instead of "this can take a few minutes...".

Deliberately in-memory and process-local: this is a single-user local tool,
so a dict is the whole requirement. Nothing here survives a restart, and
nothing needs to.
"""

import threading
import time
from dataclasses import asdict, dataclass, field

from . import jobs

# Entries older than this are dropped -- a page reload abandons its job and
# there's nobody left to read it.
STALE_AFTER_S = 30 * 60


@dataclass
class StageProgress:
	stage: str = "waiting"
	fraction: float = 0.0
	done: bool = False


# Only the tail is ever on screen, and the whole snapshot is serialised on
# every poll -- keeping the full transcript here would grow every response for
# the length of the episode.
MAX_LINES = 8


@dataclass
class JobProgress:
	transcribe: StageProgress = field(default_factory=StageProgress)
	faces: StageProgress = field(default_factory=StageProgress)
	# Runs after the other two rather than alongside them: matching voices to
	# faces needs both to have finished.
	match: StageProgress = field(default_factory=StageProgress)
	# What the pipeline has actually produced so far. A progress bar proves
	# time passed; output proves work happened.
	lines: list[str] = field(default_factory=list)
	# How far into the recording transcription has reached, and how long the
	# recording is -- shown as a position, so the numbers are the recording's,
	# not the job's.
	position: float = 0.0
	duration: float = 0.0
	# Ids only. The images are fetched once each from their own endpoint;
	# a face crop off a 4K frame is tens of KB and this is polled constantly.
	people: list[int] = field(default_factory=list)
	# How many timeline thumbnails are ready, so the UI knows how many to
	# fetch. Same reasoning as `people`: the bytes come from their own
	# endpoint, one at a time, not the snapshot.
	thumbnail_count: int = 0
	# Set once, on the way out of a background job that failed. The stage
	# `done` flags alone can't say *why* processing stopped, and the request
	# that started the job is long gone by the time it does -- this is the
	# only way the failure reaches the browser at all now that `/process`
	# returns before the pipeline runs.
	error: str | None = None
	updated: float = field(default_factory=time.time)


_lock = threading.Lock()
_jobs: dict[str, JobProgress] = {}
_faces: dict[str, dict[int, bytes]] = {}
_waveform: dict[str, list[float]] = {}
_timeline_thumbnails: dict[str, list[bytes]] = {}


def _prune(now: float) -> None:
	for key in [k for k, v in _jobs.items() if now - v.updated > STALE_AFTER_S]:
		_jobs.pop(key, None)
		_faces.pop(key, None)
		_waveform.pop(key, None)
		_timeline_thumbnails.pop(key, None)


def report(job_id: str | None, track: str, stage: str, fraction: float = 0.0, done: bool = False) -> None:
	"""Record where a job has got to. No-ops when there's no job id, so the
	endpoints stay callable (from tests, curl, anything) without one."""
	if not job_id:
		return
	now = time.time()
	with _lock:
		_prune(now)
		job = _jobs.setdefault(job_id, JobProgress())
		setattr(job, track, StageProgress(stage=stage, fraction=max(0.0, min(1.0, fraction)), done=done))
		job.updated = now


def report_error(job_id: str | None, message: str) -> None:
	if not job_id:
		return
	now = time.time()
	with _lock:
		_prune(now)
		job = _jobs.setdefault(job_id, JobProgress())
		job.error = message
		job.updated = now


def report_line(job_id: str | None, text: str, position: float, duration: float) -> None:
	"""One transcribed line, as it comes off the model. Only the tail is kept."""
	if not job_id or not text:
		return
	now = time.time()
	with _lock:
		_prune(now)
		job = _jobs.setdefault(job_id, JobProgress())
		job.lines = [*job.lines, text][-MAX_LINES:]
		job.position = position
		job.duration = duration
		job.updated = now


def report_people(job_id: str | None, thumbnails: dict[int, bytes]) -> None:
	"""The people face recognition settled on, with their thumbnails.

	Reported in one go rather than as they appear, because identity is a
	clustering step over the *whole* pass -- mid-pass there are tracks, not
	people, and one person routinely produces several of them.
	"""
	if not job_id:
		return
	now = time.time()
	with _lock:
		_prune(now)
		job = _jobs.setdefault(job_id, JobProgress())
		job.people = sorted(thumbnails)
		job.updated = now
		_faces[job_id] = dict(thumbnails)


def face_thumbnail(job_id: str, person_id: int) -> bytes | None:
	with _lock:
		return _faces.get(job_id, {}).get(person_id)


def report_waveform(job_id: str | None, peaks: list[float]) -> None:
	"""The episode's amplitude envelope, computed once from the extracted wav.

	Written to disk as well as kept in memory: unlike the rest of this
	registry, a saved episode needs this to still answer after the process
	that computed it has restarted.
	"""
	if not job_id:
		return
	now = time.time()
	with _lock:
		_prune(now)
		job = _jobs.setdefault(job_id, JobProgress())
		job.updated = now
		_waveform[job_id] = list(peaks)
	jobs.save_waveform(job_id, peaks)


def waveform_peaks(job_id: str) -> list[float] | None:
	with _lock:
		cached = _waveform.get(job_id)
	return cached if cached is not None else jobs.load_waveform(job_id)


def report_timeline_thumbnails(job_id: str | None, thumbnails: list[bytes]) -> None:
	"""Sampled frames for the timeline overview strip, reported once /process
	has them. Only the count goes on the job -- like the face thumbnails, the
	bytes are fetched one at a time from their own endpoint. Also written to
	disk, same reasoning as `report_waveform`."""
	if not job_id:
		return
	now = time.time()
	with _lock:
		_prune(now)
		job = _jobs.setdefault(job_id, JobProgress())
		job.thumbnail_count = len(thumbnails)
		job.updated = now
		_timeline_thumbnails[job_id] = list(thumbnails)
	jobs.save_thumbnails(job_id, thumbnails)


def timeline_thumbnail(job_id: str, index: int) -> bytes | None:
	with _lock:
		thumbnails = _timeline_thumbnails.get(job_id)
	if thumbnails is not None:
		return thumbnails[index] if 0 <= index < len(thumbnails) else None
	return jobs.load_thumbnail(job_id, index)


def snapshot(job_id: str) -> dict:
	with _lock:
		job = _jobs.get(job_id)
		data = asdict(job) if job else None
	if data is None:
		# Nothing in memory -- either this job never ran here, or it's a
		# saved episode being reopened well after the in-memory entry was
		# pruned (or the server restarted). If it finished, report it as
		# done from disk rather than the empty, still-waiting defaults,
		# which would otherwise read as a hung job that never started.
		data = asdict(JobProgress())
		if jobs.load_result(job_id) is not None:
			done = StageProgress(stage="done", fraction=1.0, done=True)
			data.update(transcribe=asdict(done), faces=asdict(done), match=asdict(done))
			data["thumbnail_count"] = jobs.thumbnail_count(job_id)
	# Every other field here is one word, so asdict's snake_case happens to
	# already match the camelCase the rest of the API uses; this is the one
	# that isn't, so it needs an explicit rename rather than a silent
	# exception to the wire format's naming.
	data["thumbnailCount"] = data.pop("thumbnail_count")
	return data

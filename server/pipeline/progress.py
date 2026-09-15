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
	updated: float = field(default_factory=time.time)


_lock = threading.Lock()
_jobs: dict[str, JobProgress] = {}
_faces: dict[str, dict[int, bytes]] = {}


def _prune(now: float) -> None:
	for key in [k for k, v in _jobs.items() if now - v.updated > STALE_AFTER_S]:
		_jobs.pop(key, None)
		_faces.pop(key, None)


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


def snapshot(job_id: str) -> dict:
	with _lock:
		job = _jobs.get(job_id)
		return asdict(job) if job else asdict(JobProgress())

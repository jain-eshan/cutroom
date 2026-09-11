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


@dataclass
class JobProgress:
	transcribe: StageProgress = field(default_factory=StageProgress)
	faces: StageProgress = field(default_factory=StageProgress)
	updated: float = field(default_factory=time.time)


_lock = threading.Lock()
_jobs: dict[str, JobProgress] = {}


def _prune(now: float) -> None:
	for key in [k for k, v in _jobs.items() if now - v.updated > STALE_AFTER_S]:
		_jobs.pop(key, None)


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


def snapshot(job_id: str) -> dict:
	with _lock:
		job = _jobs.get(job_id)
		return asdict(job) if job else asdict(JobProgress())

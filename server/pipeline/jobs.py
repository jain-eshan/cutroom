"""Where a job's own files live, once it needs to survive past one request.

`/process` used to do everything inside a `tempfile.TemporaryDirectory()`
that vanished the moment the request ended -- closing the tab mid-job (or
just a slow connection) killed the work, because Starlette cancels the
handler coroutine when the client disconnects. Moving a job here instead of
a tempdir is what lets `/process` hand back a job id immediately and keep
processing in the background: the files it needs outlive the request, and
the browser can drop off and poll `/progress/{job_id}` (or come back later)
without losing anything.

The same directory is also the whole of "saved episodes" -- a finished job's
input file and result never get deleted, so reopening one is a matter of
reading `result.json` back rather than reprocessing.

Deliberately a plain directory tree, not a database: this is a single-user
local tool, same reasoning as `progress.py`'s in-memory registry. Unlike that
registry, everything here is meant to survive a server restart, so it's on
disk rather than in a module-level dict.
"""

import json
import shutil
import time
from pathlib import Path

JOBS_DIR = Path(__file__).parent.parent / "jobs"


def job_dir(job_id: str) -> Path:
	"""Just the path -- does not create it. `/progress/{job_id}` looks jobs up
	by id constantly, including ones that never existed (a stale bookmark, a
	typo); this must not litter the jobs directory with empty folders for
	every miss. Only the `save_*` functions below create it, on write."""
	return JOBS_DIR / job_id


def _ensure_dir(job_id: str) -> Path:
	d = job_dir(job_id)
	d.mkdir(parents=True, exist_ok=True)
	return d


def input_path(job_id: str) -> Path | None:
	"""The original upload, wherever `save_input` put it -- named `input.<ext>`,
	so the extension (ffprobe/ffmpeg both use it to sniff format) survives."""
	matches = sorted(job_dir(job_id).glob("input.*"))
	return matches[0] if matches else None


def wav_path(job_id: str) -> Path:
	return _ensure_dir(job_id) / "audio.wav"


def save_input(job_id: str, filename: str) -> Path:
	"""Where the upload should be streamed to. Named `input<ext>` so a later
	`input_path()` lookup can find it regardless of the original filename."""
	suffix = Path(filename or "input").suffix or ".bin"
	return _ensure_dir(job_id) / f"input{suffix}"


def save_result(job_id: str, filename: str, result: dict) -> None:
	"""The finished pipeline output, plus enough metadata to list this job as
	a saved episode without reading the (potentially large) result back."""
	d = _ensure_dir(job_id)
	(d / "result.json").write_text(json.dumps(result))
	(d / "meta.json").write_text(json.dumps({"filename": filename, "createdAt": time.time()}))


def original_filename(job_id: str) -> str | None:
	path = job_dir(job_id) / "meta.json"
	if not path.exists():
		return None
	return json.loads(path.read_text())["filename"]


def load_result(job_id: str) -> dict | None:
	path = job_dir(job_id) / "result.json"
	if not path.exists():
		return None
	return json.loads(path.read_text())


def list_jobs() -> list[dict]:
	"""Every finished job with a saved result, newest first -- the "saved
	episodes" list. A job that never finished (no `meta.json` yet, or the
	server was killed mid-job) doesn't count as one: there's nothing to
	reopen, only unfinished files that `/process` would overwrite on retry."""
	if not JOBS_DIR.exists():
		return []
	found = []
	for meta_path in JOBS_DIR.glob("*/meta.json"):
		try:
			meta = json.loads(meta_path.read_text())
		except (json.JSONDecodeError, OSError):
			continue
		found.append({"jobId": meta_path.parent.name, "filename": meta["filename"], "createdAt": meta["createdAt"]})
	found.sort(key=lambda j: j["createdAt"], reverse=True)
	return found


def delete_job(job_id: str) -> None:
	shutil.rmtree(job_dir(job_id), ignore_errors=True)


# Waveform peaks and timeline thumbnails aren't part of `result.json` --
# they're fetched from their own endpoints during processing, the same way
# face thumbnails are (see progress.py). Persisting them here too is what
# lets a saved episode still show them after the in-memory copy in
# progress.py has been pruned, or the server restarted.


def save_waveform(job_id: str, peaks: list[float]) -> None:
	(_ensure_dir(job_id) / "waveform.json").write_text(json.dumps(peaks))


def load_waveform(job_id: str) -> list[float] | None:
	path = job_dir(job_id) / "waveform.json"
	return json.loads(path.read_text()) if path.exists() else None


def save_thumbnails(job_id: str, thumbnails: list[bytes]) -> None:
	d = _ensure_dir(job_id) / "thumbnails"
	d.mkdir(exist_ok=True)
	for i, data in enumerate(thumbnails):
		(d / f"{i}.jpg").write_bytes(data)


def load_thumbnail(job_id: str, index: int) -> bytes | None:
	path = job_dir(job_id) / "thumbnails" / f"{index}.jpg"
	return path.read_bytes() if path.exists() else None


def thumbnail_count(job_id: str) -> int:
	d = job_dir(job_id) / "thumbnails"
	return len(list(d.glob("*.jpg"))) if d.exists() else 0

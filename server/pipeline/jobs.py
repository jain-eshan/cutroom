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
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

from .paths import DATA_DIR

JOBS_DIR = DATA_DIR / "jobs"

# Every job id the app itself hands out is a `crypto.randomUUID()` (frontend)
# or `uuid.uuid4()` (server fallback) -- both just hex digits and hyphens.
# Validated here, the one place every other function in this module routes
# through, so a `job_id` of `"../../etc"` or `".."` can't turn into a path
# outside `JOBS_DIR` (arbitrary file write via `save_input`, or `delete_job`'s
# `shutil.rmtree` walking up to a parent directory).
_SAFE_JOB_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def validate_job_id(job_id: str) -> str:
	"""Raise unless this id is safe to put in a filesystem path.

	Public because the decision log in `main.py` builds its own path from the
	same id, and depending on some earlier lookup having rejected it first is
	one reordering away from being wrong."""
	if not _SAFE_JOB_ID.match(job_id):
		raise ValueError(f"not a valid job id: {job_id!r}")
	return job_id


def job_dir(job_id: str) -> Path:
	"""Just the path -- does not create it. `/progress/{job_id}` looks jobs up
	by id constantly, including ones that never existed (a stale bookmark, a
	typo); this must not litter the jobs directory with empty folders for
	every miss. Only the `save_*` functions below create it, on write."""
	return JOBS_DIR / validate_job_id(job_id)


def _ensure_dir(job_id: str) -> Path:
	d = job_dir(job_id)
	d.mkdir(parents=True, exist_ok=True)
	return d


def _atomic_write_text(path: Path, text: str) -> None:
	"""Write, then rename into place, so a reader never sees a partial file.

	`save_result` writes two files a `GET /jobs/{id}` depends on both
	existing and parsing; a crash (or, before `delete_job` cancelled the
	pipeline first, a delete racing a write) partway through a plain
	`write_text` could leave either truncated. `os.replace` is atomic on the
	same filesystem, and the temp file lives right next to its destination so
	it always is one."""
	fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
	try:
		with os.fdopen(fd, "w") as f:
			f.write(text)
		os.replace(tmp_name, path)
	except BaseException:
		Path(tmp_name).unlink(missing_ok=True)
		raise


def input_path(job_id: str) -> Path | None:
	"""The original upload, wherever `save_input` put it -- named `input.<ext>`,
	so the extension (ffprobe/ffmpeg both use it to sniff format) survives."""
	matches = sorted(job_dir(job_id).glob("input.*"))
	return matches[0] if matches else None


def wav_path(job_id: str) -> Path:
	return _ensure_dir(job_id) / "audio.wav"


def save_input(job_id: str, filename: str) -> Path:
	"""Where the upload should be streamed to. Named `input<ext>` so a later
	`input_path()` lookup can find it regardless of the original filename.

	Removes any `input.*` already there first: a retry under the same job id
	(a different file picked after a failure, or a different container for
	the same recording) used to leave the old one behind, and `input_path`'s
	plain alphabetical sort would then hand `/export` and playback whichever
	name sorted first -- the stale file, not the one just uploaded -- rather
	than the one this call is about to write.
	"""
	for stale in job_dir(job_id).glob("input.*"):
		stale.unlink(missing_ok=True)
	suffix = Path(filename or "input").suffix or ".bin"
	return _ensure_dir(job_id) / f"input{suffix}"


def save_result(job_id: str, filename: str, result: dict) -> None:
	"""The finished pipeline output, plus enough metadata to list this job as
	a saved episode without reading the (potentially large) result back."""
	d = _ensure_dir(job_id)
	_atomic_write_text(d / "result.json", json.dumps(result))
	_atomic_write_text(d / "meta.json", json.dumps({"filename": filename, "createdAt": time.time()}))


def original_filename(job_id: str) -> str | None:
	path = job_dir(job_id) / "meta.json"
	try:
		return json.loads(path.read_text())["filename"]
	except (FileNotFoundError, json.JSONDecodeError, KeyError):
		# A job interrupted between writing meta.json and result.json, or
		# killed mid-write to either -- the same "server crash mid-job" this
		# store has always accepted as a risk, just not previously guarded
		# here the way `list_jobs` already guards its own read of this file.
		return None


def load_result(job_id: str) -> dict | None:
	path = job_dir(job_id) / "result.json"
	try:
		return json.loads(path.read_text())
	except (FileNotFoundError, json.JSONDecodeError):
		return None


def save_edit(job_id: str, edit: dict) -> None:
	"""The editor's own work -- the cast it confirmed, the shots it set, the
	episode options -- as opposed to `result.json`, which is what the pipeline
	produced and never changes.

	Kept a separate file for that reason: an edit is written constantly while
	someone works, and rewriting a 2MB `result.json` (117 turns and 8,824 word
	timings on a real 53-minute episode) on every change to a shot edge would
	be both slow and a way to lose the expensive half to a bad write."""
	_atomic_write_text(_ensure_dir(job_id) / "edit.json", json.dumps(edit))


def load_edit(job_id: str) -> dict | None:
	"""`None` for a job nobody has edited yet, which is not an error -- it
	means "open this on the cast screen", the behaviour every job had before
	edits were saved at all."""
	path = job_dir(job_id) / "edit.json"
	try:
		return json.loads(path.read_text())
	except (FileNotFoundError, json.JSONDecodeError):
		return None


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


def discard_wav(job_id: str) -> None:
	"""Drop the extracted audio once the pipeline is done with it.

	`audio.wav` is 16kHz mono PCM -- about 115MB per hour of episode -- and
	nothing reads it after the pipeline finishes. `/export` renders from the
	original recording and cuts dead air from word timings, not from the
	audio; the waveform the timeline draws was already reduced to peaks and
	saved by `save_waveform`. Keeping it meant every saved episode carried a
	derived file a tenth of a gigabyte in size that could be regenerated from
	the input in seconds, and `jobs/` has no eviction.

	Deliberately built from `job_dir`, which does not create anything, rather
	than `wav_path`, which does: this runs in `_run_pipeline`'s `finally`,
	including when the task was cancelled by `DELETE /jobs/{id}` having just
	removed the directory. Going through `_ensure_dir` there would recreate
	the very directory the delete was for -- the same trap `main.py` already
	cancels the task to avoid.
	"""
	(job_dir(job_id) / "audio.wav").unlink(missing_ok=True)


# Headroom beyond whatever a request can measure exactly, for the extracted
# wav (~115MB/hour), the timeline thumbnails, the result files, and not
# backing the whole machine into a wall. A 53-minute 1080p episode needs
# about 100MB of that; the rest is deliberate slack, because running out of
# disk halfway through a 15-minute render costs far more than refusing a job
# that would probably have fitted.
SPACE_MARGIN_BYTES = 1024**3


def free_bytes() -> int:
	"""Free space on the filesystem the jobs directory lives on.

	Walks up to the nearest directory that exists: on a first run neither
	`jobs/` nor the data directory is there yet, and `disk_usage` needs a
	real path."""
	path = JOBS_DIR
	while not path.exists() and path.parent != path:
		path = path.parent
	return shutil.disk_usage(path).free


def space_problem(needed: int, what: str) -> str | None:
	"""None if `needed` bytes (plus margin) are free, otherwise what to say.

	Callers pass a size they actually know -- an upload's `Content-Length`,
	a recording's size on disk -- rather than a guess scaled off one, so the
	only estimated part of this is the margin above.
	"""
	required = needed + SPACE_MARGIN_BYTES
	free = free_bytes()
	if free >= required:
		return None
	return (
		f"Not enough disk space to {what}. It needs about {_gb(required)} free "
		f"and there is {_gb(free)}. Free some space and try again."
	)


def _gb(n: int) -> str:
	return f"{n / 1024**3:.1f}GB"


# Waveform peaks and timeline thumbnails aren't part of `result.json` --
# they're fetched from their own endpoints during processing, the same way
# face thumbnails are (see progress.py). Persisting them here too is what
# lets a saved episode still show them after the in-memory copy in
# progress.py has been pruned, or the server restarted.


def save_waveform(job_id: str, peaks: list[float]) -> None:
	_atomic_write_text(_ensure_dir(job_id) / "waveform.json", json.dumps(peaks))


def load_waveform(job_id: str) -> list[float] | None:
	path = job_dir(job_id) / "waveform.json"
	try:
		return json.loads(path.read_text())
	except (FileNotFoundError, json.JSONDecodeError):
		return None


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

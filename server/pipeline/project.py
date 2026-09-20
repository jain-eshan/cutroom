"""The `.cutroom` project file: an episode as a document you own.

Everything a job holds *except* the recording -- the transcript, the faces,
the waveform, the timeline thumbnails and the edit on top of them. On the
53-minute reference episode that is 1.2MB, against a 5.3GB recording, so a
project is something you can back up, move between machines or send to
someone who has the footage.

The recording is referenced, not contained, the same way a Premiere or
Resolve project references its media. A project therefore records where the
recording was, and opening one on a machine where that path is wrong leaves
the job without an input until it is relinked -- see `relink` in main.py.
The alternative, copying multi-GB media into a "project", is the thing every
editor learned not to do.

`audio.wav` is excluded, and normally isn't there to exclude -- the pipeline
deletes it once a job finishes. `/export` reads the recording itself, so
nothing needs it to reopen or re-render an episode. The exclusion stays
explicit anyway, since a job interrupted mid-run can still have one.
"""

import json
import shutil
import time
import zipfile
from pathlib import Path

from . import jobs

PROJECT_SUFFIX = ".cutroom"

# The format's own version, separate from the app's and from the edit's
# (`EDIT_VERSION` in src/lib/savedEdit.ts). A project written by a newer
# version is refused rather than half-read: opening one by ignoring the parts
# we don't understand would look like it opened cleanly while quietly
# dropping some of it.
PROJECT_VERSION = 1

MANIFEST_NAME = "manifest.json"
FORMAT_TAG = "cutroom-project"

# Exactly what may come out of an archive. An allowlist rather than a check
# for `..` and absolute paths: a zip member name is attacker-controlled, and
# every path-traversal fix that works by *inspecting* the name has a history
# of being one encoding away from wrong. Nothing here is derived from the
# archive except which of these names it happens to contain.
_ALLOWED_FILES = {MANIFEST_NAME, "result.json", "edit.json", "waveform.json"}
_THUMBNAIL_DIR = "thumbnails/"

# A project is JSON and small JPEGs. This is generous for a feature-length
# episode (the reference one is 1.2MB) and still refuses an archive that
# would fill the disk when decompressed.
MAX_UNPACKED_BYTES = 256 * 1024 * 1024


class NotAProject(Exception):
	"""The file isn't a Cutroom project, or isn't one this build can open.
	The message is shown to the user as-is, so it says what to do."""


def _thumbnail_index(name: str) -> int | None:
	"""`thumbnails/12.jpg` -> 12, or None for anything else. The index is
	what the name is *rebuilt* from on extraction, so a member called
	`thumbnails/../../evil.jpg` doesn't parse as an index and is skipped
	rather than sanitised."""
	if not name.startswith(_THUMBNAIL_DIR) or not name.endswith(".jpg"):
		return None
	stem = name[len(_THUMBNAIL_DIR) : -len(".jpg")]
	return int(stem) if stem.isdigit() else None


def project_filename(original_filename: str | None) -> str:
	"""`TheFounders' Podcast Ep1.mp4` -> `TheFounders' Podcast Ep1.cutroom`."""
	stem = Path(original_filename or "episode").stem or "episode"
	return f"{stem}{PROJECT_SUFFIX}"


def write_project(job_id: str, out_path: Path) -> Path:
	"""Write this job as a project file at `out_path`.

	Built in the destination directory and renamed into place, so an
	interrupted write can't leave something that looks like a project but
	isn't -- the same reasoning as `jobs._atomic_write_text`, and it matters
	more here because the destination is somewhere the user chose and will
	trust later."""
	result = jobs.load_result(job_id)
	if result is None:
		raise NotAProject("That episode hasn't finished processing yet.")

	source = jobs.input_path(job_id)
	# `resolve()` so a project records where the recording really is, not the
	# symlink inside the job directory, which means nothing on another machine.
	real_source = source.resolve() if source else None
	manifest = {
		"format": FORMAT_TAG,
		"version": PROJECT_VERSION,
		"savedAt": time.time(),
		"filename": jobs.original_filename(job_id),
		"source": {
			"path": str(real_source) if real_source else None,
			"sizeBytes": real_source.stat().st_size if real_source and real_source.is_file() else None,
		},
	}

	job = jobs.job_dir(job_id)
	temp = out_path.with_name(f".{out_path.name}.writing")
	try:
		with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as archive:
			archive.writestr(MANIFEST_NAME, json.dumps(manifest))
			for name in ("result.json", "edit.json", "waveform.json"):
				path = job / name
				if path.is_file():
					archive.write(path, name)
			thumbnails = job / "thumbnails"
			if thumbnails.is_dir():
				for thumbnail in sorted(thumbnails.glob("*.jpg")):
					archive.write(thumbnail, f"{_THUMBNAIL_DIR}{thumbnail.name}")
		temp.replace(out_path)
	except BaseException:
		temp.unlink(missing_ok=True)
		raise
	return out_path


def read_project(archive_path: Path, job_id: str) -> dict:
	"""Unpack a project into a fresh job and return its manifest.

	Refuses rather than guesses: a file that isn't a zip, isn't a Cutroom
	project, comes from a newer format version, or has no `result.json` is an
	error with a sentence explaining it, not a half-made job. A job directory
	is only created once the archive has been accepted."""
	try:
		with zipfile.ZipFile(archive_path) as archive:
			names = set(archive.namelist())
			if MANIFEST_NAME not in names:
				raise NotAProject("That file isn't a Cutroom project.")
			manifest = json.loads(archive.read(MANIFEST_NAME))
			if manifest.get("format") != FORMAT_TAG:
				raise NotAProject("That file isn't a Cutroom project.")
			version = manifest.get("version")
			if not isinstance(version, int) or version > PROJECT_VERSION:
				raise NotAProject("That project was saved by a newer version of Cutroom. Update and try again.")
			if "result.json" not in names:
				raise NotAProject("That project is missing its transcript and can't be opened.")

			wanted = [(name, info) for name, info in ((n, archive.getinfo(n)) for n in sorted(names)) if _is_wanted(name)]
			if sum(info.file_size for _, info in wanted) > MAX_UNPACKED_BYTES:
				raise NotAProject("That project is implausibly large and wasn't opened.")

			destination = jobs.job_dir(job_id)
			(destination / "thumbnails").mkdir(parents=True, exist_ok=True)
			for name, _ in wanted:
				index = _thumbnail_index(name)
				# Rebuilt from the parsed index, never from the archive's own
				# string, so nothing an archive says can name a destination.
				out = destination / "thumbnails" / f"{index}.jpg" if index is not None else destination / name
				with archive.open(name) as member, out.open("wb") as handle:
					shutil.copyfileobj(member, handle)
	except zipfile.BadZipFile as err:
		raise NotAProject("That file isn't a Cutroom project.") from err
	except json.JSONDecodeError as err:
		raise NotAProject("That project file is damaged and can't be opened.") from err

	# `meta.json` is what makes this a listable saved episode; it is rebuilt
	# here rather than carried in the archive, because `createdAt` means "when
	# this machine got it", which is what the episode list is sorted by.
	jobs.save_result(job_id, manifest.get("filename") or "episode", json.loads((jobs.job_dir(job_id) / "result.json").read_text()))
	return manifest


def _is_wanted(name: str) -> bool:
	return name in _ALLOWED_FILES or _thumbnail_index(name) is not None


def relink(job_id: str, source: Path) -> None:
	"""Point a job at a recording, replacing whatever it had.

	A project carries a path, not the media, so opening one on another
	machine -- or after the recording moved, which for a file in a synced
	folder is a question of when -- leaves the job with nothing to play or
	export. Symlinked, exactly as `/process/local` does it, so relinking
	never copies a multi-GB file either."""
	if not source.is_file():
		raise NotAProject(f"No such file: {source}")
	destination = jobs.save_input(job_id, source.name)
	destination.symlink_to(source.resolve())


def source_is_available(job_id: str) -> bool:
	"""Whether this job's recording can actually be read right now. A broken
	symlink -- the recording moved or was deleted -- is exactly the case
	worth catching, and `Path.is_file()` follows the link, so it answers that
	on its own."""
	path = jobs.input_path(job_id)
	return path is not None and path.is_file()

"""One-time first-run downloads for pipeline model weights.

Shared by faces.py (SFace) and lipsync.py (LR-ASD) -- both ship the model
architecture but not the weights, which are too big to commit and download
once into paths.DATA_DIR/.models on first use, same as faster-whisper and
pyannote's own model caches.
"""

import os
import urllib.request
from pathlib import Path
from tempfile import mkstemp
from typing import Callable


def download_once(
	url: str,
	dest: Path,
	*,
	name: str,
	label: str,
	progress: Callable[[str, float], None] | None = None,
) -> Path:
	"""Download `url` to `dest` if it isn't already there. Returns `dest`.

	`name` is the short noun phrase for the error message ("the face
	recognition model"); `label` is the fuller, `progress(label, fraction)`
	string a caller already shows on screen ("downloading the face
	recognition model (first run only, ~38MB)") -- kept separate since
	that's a worse fit for "Could not download {x} from {url}" than a
	callback label.

	Writes to a uniquely-named temp file in the same directory, then renames
	atomically into place. Before this, both callers used a temp filename
	derived only from the destination -- fixed and shared across every call,
	same-process or not. Nothing in this app limits how many jobs can run at
	once (see main.py), so two jobs starting close together on a fresh
	install, before either model is cached, both saw the destination missing
	and both wrote to the same temp path: interleaved downloads landing in
	one file, and either one's failure-path cleanup deleting the other's
	in-progress download out from under it. A unique temp name per call
	means the worst a race costs now is downloading the same bytes twice,
	not a corrupted model that fails every job afterward until someone
	notices and deletes it by hand.
	"""
	if dest.exists():
		return dest
	dest.parent.mkdir(parents=True, exist_ok=True)
	fd, tmp_name = mkstemp(dir=dest.parent, prefix=f".{dest.name}.", suffix=".part")
	os.close(fd)
	tmp = Path(tmp_name)

	def reporthook(block_num: int, block_size: int, total_size: int) -> None:
		if progress is not None and total_size > 0:
			progress(label, min(1.0, block_num * block_size / total_size))

	print(f"[download] {label} to {dest} ...")
	try:
		urllib.request.urlretrieve(url, tmp, reporthook=reporthook)
		os.replace(tmp, dest)
	except Exception as err:
		tmp.unlink(missing_ok=True)
		raise RuntimeError(
			f"Could not download {name} from {url}. Download it manually and save it to {dest}. "
			f"Original error: {err}"
		) from err
	return dest

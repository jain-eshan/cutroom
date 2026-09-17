"""Tests for pipeline/download.py, shared by faces.py's SFace download and
lipsync.py's LR-ASD weights download."""

import threading
import time
import urllib.request

import pytest

from pipeline.download import download_once


class TestDownloadOnce:
	def test_does_nothing_if_the_destination_already_exists(self, monkeypatch, tmp_path):
		dest = tmp_path / "model.bin"
		dest.write_bytes(b"already here")

		def fail_if_called(*a, **k):
			raise AssertionError("should not fetch a file that already exists")

		monkeypatch.setattr(urllib.request, "urlretrieve", fail_if_called)
		result = download_once("http://example.invalid/model.bin", dest, name="the model", label="downloading")
		assert result == dest
		assert dest.read_bytes() == b"already here"

	def test_downloads_and_renames_into_place(self, monkeypatch, tmp_path):
		dest = tmp_path / "sub" / "model.bin"

		def fake_urlretrieve(url, filename, reporthook=None):
			if reporthook:
				reporthook(1, 100, 100)
			from pathlib import Path

			Path(filename).write_bytes(b"downloaded content")

		monkeypatch.setattr(urllib.request, "urlretrieve", fake_urlretrieve)
		seen_progress = []
		download_once(
			"http://example.invalid/model.bin",
			dest,
			name="the model",
			label="downloading the model",
			progress=lambda label, fraction: seen_progress.append((label, fraction)),
		)
		assert dest.read_bytes() == b"downloaded content"
		assert seen_progress == [("downloading the model", 1.0)]
		# No stray temp file left behind next to it.
		assert list(dest.parent.iterdir()) == [dest]

	def test_a_failed_download_is_cleaned_up_and_raises_a_clear_error(self, monkeypatch, tmp_path):
		dest = tmp_path / "model.bin"

		def fake_urlretrieve(url, filename, reporthook=None):
			raise OSError("connection reset")

		monkeypatch.setattr(urllib.request, "urlretrieve", fake_urlretrieve)
		with pytest.raises(RuntimeError, match="the model.*connection reset"):
			download_once("http://example.invalid/model.bin", dest, name="the model", label="downloading")
		assert not dest.exists()
		assert list(tmp_path.iterdir()) == [], "the failed temp file must not be left behind"

	def test_two_concurrent_downloads_of_the_same_missing_file_dont_corrupt_each_other(self, monkeypatch, tmp_path):
		# The actual bug: both faces.py and lipsync.py used to derive their
		# temp filename from the destination alone, so two jobs racing to
		# download the same not-yet-cached model on a fresh install wrote to
		# the *same* temp file concurrently. Real network downloads take long
		# enough for that overlap to be likely; this proves the fix holds
		# even in the worst case, not just that it's less likely to happen.
		dest = tmp_path / "model.bin"
		barrier = threading.Barrier(2)

		def slow_urlretrieve(url, filename, reporthook=None):
			from pathlib import Path

			# Line both threads up so their writes to (now-distinct) temp
			# files genuinely overlap in time, the way a real download would.
			barrier.wait(timeout=5)
			Path(filename).write_bytes(f"content from thread {threading.current_thread().name}".encode())
			time.sleep(0.05)

		monkeypatch.setattr(urllib.request, "urlretrieve", slow_urlretrieve)

		errors = []

		def run():
			try:
				download_once("http://example.invalid/model.bin", dest, name="the model", label="downloading")
			except Exception as err:  # noqa: BLE001 -- captured to fail the test, not swallowed
				errors.append(err)

		threads = [threading.Thread(target=run, name=f"t{i}") for i in range(2)]
		for t in threads:
			t.start()
		for t in threads:
			t.join(timeout=5)

		assert errors == []
		# Whichever thread's rename landed last, the file is one thread's
		# complete, valid content -- not an interleaving of both, and not
		# missing because the other thread's cleanup deleted it.
		assert dest.exists()
		assert dest.read_text().startswith("content from thread t")
		assert list(tmp_path.iterdir()) == [dest], "no leftover temp files from either thread"

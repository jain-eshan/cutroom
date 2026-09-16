"""Tests for the presence threshold that decides what counts as a person.

Detection and clustering need real footage and are exercised end to end; this
covers the arithmetic that decides which clusters survive, which is what let
six junk "people" into the cast screen on a full-length episode.
"""

import urllib.request
from pathlib import Path

import pipeline.faces as faces
from pipeline.faces import MIN_DETECTIONS, MIN_PRESENCE, _ensure_recognition_model


def survives(count: int, sampled_frames: int) -> bool:
	"""The check as detect_and_track_faces applies it."""
	return count >= max(MIN_DETECTIONS, round(sampled_frames * MIN_PRESENCE))


class TestPresenceThreshold:
	def test_real_participants_survive_a_full_episode(self):
		# Measured: four participants in 3,164-3,172 of 3,181 sampled frames.
		for count in (3164, 3172):
			assert survives(count, 3181)

	def test_junk_clusters_are_dropped_on_a_full_episode(self):
		# Measured: six clusters seen between 3 and 12 times, all of which the
		# old fixed threshold of 3 let through.
		for count in (3, 5, 12):
			assert not survives(count, 3181)

	def test_the_floor_still_applies_to_short_clips(self):
		# On a 60-second clip 5% is 3 frames, so the floor is what bites.
		assert not survives(2, 60)
		assert survives(3, 60)

	def test_someone_who_joins_late_still_counts(self):
		# Present for the last five minutes of a 53-minute episode: a guest who
		# arrives late is a real participant, not a false positive.
		assert survives(300, 3181)


class TestRecognitionModelDownloadProgress:
	"""The download itself is a plain HTTP GET this project controls, so a
	real byte fraction is cheap here -- unlike the Whisper/pyannote model
	loads, where the same honesty would mean guessing at a total size."""

	def _fake_urlretrieve(self, total_size: int, block_size: int = 100):
		def fake(url, dest, reporthook=None):
			if reporthook:
				for block_num in range(total_size // block_size + 1):
					reporthook(block_num, block_size, total_size)
			Path(dest).write_bytes(b"fake model bytes")

		return fake

	def test_progress_reaches_one_and_is_clamped(self, tmp_path, monkeypatch):
		monkeypatch.setattr(faces, "MODELS_DIR", tmp_path)
		monkeypatch.setattr(faces, "RECOGNITION_MODEL", tmp_path / "sface.onnx")
		monkeypatch.setattr(urllib.request, "urlretrieve", self._fake_urlretrieve(total_size=1000))

		seen: list[float] = []
		_ensure_recognition_model(progress=lambda label, fraction: seen.append(fraction))

		assert seen[-1] == 1.0
		assert all(0.0 <= f <= 1.0 for f in seen)
		assert (tmp_path / "sface.onnx").exists()

	def test_the_label_explains_the_pause_is_one_time(self, tmp_path, monkeypatch):
		monkeypatch.setattr(faces, "MODELS_DIR", tmp_path)
		monkeypatch.setattr(faces, "RECOGNITION_MODEL", tmp_path / "sface.onnx")
		monkeypatch.setattr(urllib.request, "urlretrieve", self._fake_urlretrieve(total_size=100))

		labels: list[str] = []
		_ensure_recognition_model(progress=lambda label, fraction: labels.append(label))

		assert labels and all("first run" in label for label in labels)

	def test_an_already_downloaded_model_reports_nothing(self, tmp_path, monkeypatch):
		model = tmp_path / "sface.onnx"
		model.write_bytes(b"already here")
		monkeypatch.setattr(faces, "MODELS_DIR", tmp_path)
		monkeypatch.setattr(faces, "RECOGNITION_MODEL", model)

		def fail(*a, **k):
			raise AssertionError("should not attempt a download when the model already exists")

		monkeypatch.setattr(urllib.request, "urlretrieve", fail)

		called = False

		def progress(label, fraction):
			nonlocal called
			called = True

		_ensure_recognition_model(progress=progress)
		assert not called

	def test_no_progress_callback_is_fine(self, tmp_path, monkeypatch):
		# The normal case for anyone who already has the model cached, and
		# also has to work with no callback at all -- most callers won't pass
		# one.
		monkeypatch.setattr(faces, "MODELS_DIR", tmp_path)
		monkeypatch.setattr(faces, "RECOGNITION_MODEL", tmp_path / "sface.onnx")
		monkeypatch.setattr(urllib.request, "urlretrieve", self._fake_urlretrieve(total_size=100))
		_ensure_recognition_model()  # must not raise
		assert (tmp_path / "sface.onnx").exists()

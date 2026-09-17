"""Tests for get_model's on_loading announcement -- the only way a browser
learns why a run stalls before any transcript line can appear. The model
itself isn't loaded here (it needs a real download or a real cache hit);
this pins that the callback fires exactly once, only when the model isn't
already loaded in this process."""

import threading
import time

import pytest

import pipeline.transcribe as transcribe


@pytest.fixture(autouse=True)
def clean_model():
	transcribe._model = None
	yield
	transcribe._model = None


class TestModelLoadingAnnounced:
	def test_fires_once_on_first_load(self, monkeypatch):
		monkeypatch.setattr(transcribe, "WhisperModel", lambda *a, **k: "the model")

		seen: list[str] = []
		model = transcribe.get_model(on_loading=seen.append)

		assert model == "the model"
		assert len(seen) == 1 and "first time" in seen[0]

	def test_does_not_fire_once_already_loaded(self, monkeypatch):
		monkeypatch.setattr(transcribe, "WhisperModel", lambda *a, **k: "the model")
		transcribe.get_model()  # loads it once, no callback

		called = []
		transcribe.get_model(on_loading=called.append)

		assert not called

	def test_no_callback_is_fine(self, monkeypatch):
		monkeypatch.setattr(transcribe, "WhisperModel", lambda *a, **k: "the model")
		assert transcribe.get_model() == "the model"


class TestConcurrentLoads:
	def test_two_threads_racing_to_load_construct_the_model_only_once(self, monkeypatch):
		# main.py runs transcription in a thread and puts no limit on how
		# many jobs run at once, so two jobs starting close together used to
		# both see _model as None and both construct a WhisperModel --
		# several hundred MB, loaded twice for nothing. A barrier lines both
		# threads up right before they call get_model(), so they genuinely
		# race on the "is it already loaded" check rather than just in theory.
		construction_count = 0
		start_barrier = threading.Barrier(2)

		def slow_constructor(*a, **k):
			nonlocal construction_count
			construction_count += 1
			time.sleep(0.05)  # held under the lock, so the second thread
			return "the model"  # must wait here, not construct alongside it

		monkeypatch.setattr(transcribe, "WhisperModel", slow_constructor)

		def call():
			start_barrier.wait(timeout=5)
			return transcribe.get_model()

		results = []
		threads = [threading.Thread(target=lambda: results.append(call())) for _ in range(2)]
		for t in threads:
			t.start()
		for t in threads:
			t.join(timeout=5)

		assert construction_count == 1
		assert results == ["the model", "the model"]

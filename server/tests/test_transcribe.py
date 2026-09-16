"""Tests for get_model's on_loading announcement -- the only way a browser
learns why a run stalls before any transcript line can appear. The model
itself isn't loaded here (it needs a real download or a real cache hit);
this pins that the callback fires exactly once, only when the model isn't
already loaded in this process."""

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

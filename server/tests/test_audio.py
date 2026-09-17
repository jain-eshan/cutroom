"""Tests for pipeline/audio.py's ffprobe/ffmpeg wrapping.

No real ffprobe/ffmpeg calls here -- CI has neither installed, the same
reason test_render.py exercises the actual subprocess only manually. What's
under test is entirely in how this module reacts to what subprocess.run
does: a clean result, a genuine "no audio here", a corrupted file ffprobe
can't parse, a missing binary, or a hang -- not ffprobe's own behaviour."""

import subprocess

import pytest

from pipeline.audio import (
	FFMPEG_EXTRACT_TIMEOUT_S,
	FFPROBE_TIMEOUT_S,
	NoAudioTrack,
	UnreadableRecording,
	extract_wav,
	has_audio,
)


def _completed(stdout: str) -> subprocess.CompletedProcess:
	return subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout, stderr="")


class TestHasAudio:
	def test_a_stream_list_containing_audio_is_true(self, monkeypatch, tmp_path):
		monkeypatch.setattr(subprocess, "run", lambda *a, **k: _completed("audio\n"))
		assert has_audio(tmp_path / "clip.mp4") is True

	def test_an_empty_stream_list_is_false_not_an_error(self, monkeypatch, tmp_path):
		# ffprobe exits 0 with nothing selected -- a real, successful read
		# that just found no audio stream. This is NoAudioTrack's case, not
		# UnreadableRecording's.
		monkeypatch.setattr(subprocess, "run", lambda *a, **k: _completed(""))
		assert has_audio(tmp_path / "silent.mp4") is False

	def test_ffprobe_erroring_on_a_corrupted_file_raises_unreadable_not_silent(self, monkeypatch, tmp_path):
		# Before this, any ffprobe failure -- a corrupted upload, a
		# permissions error -- was caught and reported as "has no audio
		# track", sending whoever reads it looking at their microphone
		# instead of at the actual file.
		def raise_called_process_error(*a, **k):
			raise subprocess.CalledProcessError(1, ["ffprobe"], stderr="moov atom not found")

		monkeypatch.setattr(subprocess, "run", raise_called_process_error)
		with pytest.raises(UnreadableRecording, match="moov atom not found"):
			has_audio(tmp_path / "corrupted.mp4")

	def test_a_missing_ffprobe_binary_raises_unreadable_not_silent(self, monkeypatch, tmp_path):
		def raise_not_found(*a, **k):
			raise FileNotFoundError("[Errno 2] No such file or directory: 'ffprobe'")

		monkeypatch.setattr(subprocess, "run", raise_not_found)
		with pytest.raises(UnreadableRecording, match="FFPROBE_BINARY"):
			has_audio(tmp_path / "clip.mp4")

	def test_a_hung_ffprobe_times_out_instead_of_blocking_forever(self, monkeypatch, tmp_path):
		def raise_timeout(*a, **k):
			raise subprocess.TimeoutExpired(cmd=["ffprobe"], timeout=k.get("timeout"))

		monkeypatch.setattr(subprocess, "run", raise_timeout)
		with pytest.raises(UnreadableRecording, match=f"{FFPROBE_TIMEOUT_S}s"):
			has_audio(tmp_path / "clip.mp4")

	def test_the_probe_call_itself_is_given_a_timeout(self, monkeypatch, tmp_path):
		seen = {}
		monkeypatch.setattr(subprocess, "run", lambda *a, **k: seen.update(k) or _completed("audio"))
		has_audio(tmp_path / "clip.mp4")
		assert seen["timeout"] == FFPROBE_TIMEOUT_S


class TestExtractWav:
	def test_no_audio_track_is_raised_before_ffmpeg_is_ever_invoked(self, monkeypatch, tmp_path):
		monkeypatch.setattr(subprocess, "run", lambda *a, **k: _completed(""))
		with pytest.raises(NoAudioTrack):
			extract_wav(tmp_path / "silent.mp4", tmp_path / "out.wav")

	def test_a_hung_ffmpeg_extraction_times_out(self, monkeypatch, tmp_path):
		calls = iter([_completed("audio")])  # has_audio's probe succeeds

		def fake_run(*a, **k):
			try:
				return next(calls)
			except StopIteration:
				raise subprocess.TimeoutExpired(cmd=["ffmpeg"], timeout=k.get("timeout"))

		monkeypatch.setattr(subprocess, "run", fake_run)
		with pytest.raises(UnreadableRecording, match=f"{FFMPEG_EXTRACT_TIMEOUT_S}s"):
			extract_wav(tmp_path / "clip.mp4", tmp_path / "out.wav")

	def test_the_extraction_call_itself_is_given_a_timeout(self, monkeypatch, tmp_path):
		seen = {}

		def fake_run(*a, **k):
			if "-show_entries" in a[0]:
				return _completed("audio")
			seen.update(k)
			return _completed("")

		monkeypatch.setattr(subprocess, "run", fake_run)
		extract_wav(tmp_path / "clip.mp4", tmp_path / "out.wav")
		assert seen["timeout"] == FFMPEG_EXTRACT_TIMEOUT_S

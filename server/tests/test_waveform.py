"""Tests for pipeline/waveform.py -- the amplitude envelope and timeline
thumbnails the timeline overview strip uses. Pins actual bucket/thumbnail
counts and values, not just "doesn't crash", the same way test_faces.py pins
the presence threshold's arithmetic rather than just running it end to end.
"""

import cv2
import numpy as np
import pytest
import soundfile as sf

from pipeline.waveform import compute_timeline_thumbnails, compute_waveform_peaks


def _write_wav(path, samples, sample_rate=16000):
	sf.write(str(path), samples.astype(np.float32), sample_rate)


class TestWaveformPeaks:
	def test_returns_exactly_the_requested_bucket_count(self, tmp_path):
		wav_path = tmp_path / "audio.wav"
		samples = np.sin(np.linspace(0, 200 * np.pi, 32000)).astype(np.float32)
		_write_wav(wav_path, samples)
		assert len(compute_waveform_peaks(str(wav_path))) == 2000

	def test_a_smaller_explicit_bucket_count_against_a_short_clip(self, tmp_path):
		# The API also has to work with fewer samples than the 2000-bucket
		# default -- exactly the case a short test clip hits.
		wav_path = tmp_path / "audio.wav"
		samples = np.sin(np.linspace(0, 20 * np.pi, 1000)).astype(np.float32)
		_write_wav(wav_path, samples)
		assert len(compute_waveform_peaks(str(wav_path), buckets=10)) == 10

	def test_a_louder_segment_normalises_to_a_higher_bucket(self, tmp_path):
		# First half loud, second half quiet -- with two buckets, one bucket
		# each, so the loud one should end up at 1.0 and the quiet one below it.
		wav_path = tmp_path / "audio.wav"
		loud = np.sin(np.linspace(0, 200 * np.pi, 16000)).astype(np.float32)
		quiet = (0.01 * np.sin(np.linspace(0, 200 * np.pi, 16000))).astype(np.float32)
		_write_wav(wav_path, np.concatenate([loud, quiet]))

		peaks = compute_waveform_peaks(str(wav_path), buckets=2)

		assert len(peaks) == 2
		assert all(0.0 <= p <= 1.0 for p in peaks)
		assert peaks[0] == pytest.approx(1.0, abs=1e-3)
		assert peaks[0] > peaks[1]

	def test_a_silent_clip_normalises_to_all_zero_without_dividing_by_zero(self, tmp_path):
		wav_path = tmp_path / "audio.wav"
		_write_wav(wav_path, np.zeros(8000, dtype=np.float32))

		peaks = compute_waveform_peaks(str(wav_path), buckets=100)

		assert len(peaks) == 100
		assert all(p == 0.0 for p in peaks)

	def test_an_empty_clip_does_not_raise(self, tmp_path):
		# Not the same as silent -- zero samples, not zero-amplitude samples.
		# array_split can't divide zero samples into buckets, so this has to
		# be handled before that call rather than crashing on it.
		wav_path = tmp_path / "audio.wav"
		_write_wav(wav_path, np.zeros(0, dtype=np.float32))
		assert compute_waveform_peaks(str(wav_path)) == []


def _write_video(path, frame_count, fps=1.0, size=(320, 240)):
	fourcc = cv2.VideoWriter_fourcc(*"mp4v")
	writer = cv2.VideoWriter(str(path), fourcc, fps, size)
	for i in range(frame_count):
		frame = np.full((size[1], size[0], 3), i % 256, dtype=np.uint8)
		writer.write(frame)
	writer.release()


class TestTimelineThumbnails:
	def test_count_follows_the_sizing_formula(self, tmp_path):
		# duration / 8 = 3, below the MIN_THUMBNAILS floor of 12 -- a short
		# clip should still get the floor, not a handful of thumbnails.
		video_path = tmp_path / "clip.mp4"
		_write_video(video_path, frame_count=24, fps=1.0)

		thumbnails = compute_timeline_thumbnails(str(video_path), duration=24.0)

		assert len(thumbnails) == 12

	def test_each_thumbnail_is_a_valid_resized_jpeg(self, tmp_path):
		video_path = tmp_path / "clip.mp4"
		_write_video(video_path, frame_count=24, fps=1.0, size=(320, 240))

		thumbnails = compute_timeline_thumbnails(str(video_path), duration=24.0)

		for jpeg_bytes in thumbnails:
			decoded = cv2.imdecode(np.frombuffer(jpeg_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
			assert decoded is not None
			# 320-wide source resized to the fixed 160px thumbnail width,
			# aspect preserved (240 * 160/320 = 120).
			assert decoded.shape[1] == 160
			assert decoded.shape[0] == 120

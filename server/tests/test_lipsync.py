"""Tests for pipeline/lipsync.py's window alignment -- the invariant the LR-ASD
model enforces by crashing: exactly 4 audio feature rows per video frame in
every window it scores."""

import numpy as np
import pytest
import torch

from pipeline.lipsync import AUDIO_ROWS_PER_FRAME, _aligned_window
from pipeline.lrasd.Model import ASD_Model


class TestAlignedWindow:
	def test_the_recording_that_crashed(self):
		# 20260826_081419000_iOS.MOV: 35,780 feature rows. Its 90th window starts
		# at row 35,600 with 46 video frames, but only 180 rows (45 frames) remain.
		audio, frames = _aligned_window(np.zeros((35_780, 13)), 35_600, 46)
		assert frames == 45
		assert len(audio) == 180

	def test_a_window_the_audio_fully_covers_is_left_alone(self):
		audio, frames = _aligned_window(np.zeros((1_000, 13)), 0, 100)
		assert frames == 100
		assert len(audio) == 400

	@pytest.mark.parametrize("rows_left", range(12))
	def test_rows_are_always_four_per_frame(self, rows_left):
		audio, frames = _aligned_window(np.zeros((400 + rows_left, 13)), 400, 46)
		assert len(audio) == frames * AUDIO_ROWS_PER_FRAME
		assert frames == rows_left // AUDIO_ROWS_PER_FRAME

	def test_a_window_past_the_end_of_the_audio_covers_nothing(self):
		audio, frames = _aligned_window(np.zeros((100, 13)), 400, 46)
		assert frames == 0
		assert len(audio) == 0


@pytest.fixture(scope="module")
def model():
	return ASD_Model().eval()


class TestModelShapes:
	"""The real network with untrained weights. Output shapes don't depend on the
	weights, so this runs offline and still exercises the exact fusion step that
	failed. Tiny 16x16 faces keep it fast; the visual encoder pools space away."""

	@staticmethod
	def _fuse(model, audio_rows: int, frames: int) -> torch.Tensor:
		with torch.no_grad():
			embed_a = model.forward_audio_frontend(torch.zeros(1, audio_rows, 13))
			embed_v = model.forward_visual_frontend(torch.zeros(1, frames, 16, 16))
			return model.forward_audio_visual_backend(embed_a, embed_v)

	def test_the_unaligned_window_is_the_crash_that_was_reported(self, model):
		with pytest.raises(RuntimeError, match="Expected size 45 but got size 46"):
			self._fuse(model, 180, 46)

	def test_the_aligned_window_fuses_one_score_per_frame(self, model):
		audio, frames = _aligned_window(np.zeros((35_780, 13)), 35_600, 46)
		out = self._fuse(model, len(audio), frames)
		assert out.shape[0] == frames

"""Tests for pairing voices to faces.

The cases that matter are the ones where the two signals disagree, because
that disagreement is the only evidence either side is wrong. A fusion that
only handles the happy path adds nothing over a lookup table.
"""

import numpy as np

from pipeline.diarize import SpeakerSegment
from pipeline.fuse import cooccurrence, fuse


def _voice(speaker: int, start: float, end: float) -> SpeakerSegment:
	return SpeakerSegment(start=start, end=end, speaker=speaker)


def _speaking(faces: list[int]) -> np.ndarray:
	"""One entry per second: index into person_ids, or -1 for nobody."""
	return np.array(faces)


class TestCooccurrence:
	def test_counts_seconds_where_both_agree(self):
		segments = [_voice(0, 0.0, 3.0), _voice(1, 3.0, 6.0)]
		speaking = _speaking([0, 0, 0, 1, 1, 1])
		voices, counts = cooccurrence(segments, speaking, person_ids=[10, 11])
		assert voices == [0, 1]
		assert counts.tolist() == [[3, 0], [0, 3]]

	def test_ignores_seconds_with_no_speaking_face(self):
		segments = [_voice(0, 0.0, 4.0)]
		speaking = _speaking([0, -1, -1, 0])
		_, counts = cooccurrence(segments, speaking, person_ids=[10])
		assert counts.tolist() == [[2]]

	def test_ignores_seconds_where_two_voices_overlap(self):
		# While two people talk at once there is no evidence about either.
		segments = [_voice(0, 0.0, 4.0), _voice(1, 1.0, 3.0)]
		speaking = _speaking([0, 0, 0, 0])
		_, counts = cooccurrence(segments, speaking, person_ids=[10, 11])
		assert counts.tolist() == [[2, 0], [0, 0]]


class TestFuse:
	def test_clean_one_to_one(self):
		segments = [_voice(0, 0.0, 5.0), _voice(1, 5.0, 10.0)]
		speaking = _speaking([0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
		result = fuse(segments, speaking, person_ids=[10, 11])
		assert result.speaker_to_person() == {0: 10, 1: 11}
		assert all(m.confidence == 1.0 for m in result.matches)

	def test_two_voices_on_one_face_both_map_there(self):
		# The over-split case: the diariser cut one person into two voices.
		# A strict one-to-one matching would force them onto different faces
		# and bury the mistake.
		segments = [_voice(0, 0.0, 5.0), _voice(1, 5.0, 10.0)]
		speaking = _speaking([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
		result = fuse(segments, speaking, person_ids=[10, 11])
		assert result.speaker_to_person() == {0: 10, 1: 10}
		assert any("split in two" in n for n in result.notes)

	def test_one_voice_across_two_faces_is_flagged(self):
		# The merged case: one voice label covering two different people.
		segments = [_voice(0, 0.0, 10.0)]
		speaking = _speaking([0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
		result = fuse(segments, speaking, person_ids=[10, 11])
		assert any("merged" in n for n in result.notes)

	def test_voice_with_no_visible_speaker_is_left_unmatched(self):
		segments = [_voice(0, 0.0, 5.0), _voice(1, 5.0, 10.0)]
		speaking = _speaking([0, 0, 0, 0, 0, -1, -1, -1, -1, -1])
		result = fuse(segments, speaking, person_ids=[10, 11])
		assert result.speaker_to_person() == {0: 10}
		assert any("never speaks while a face" in n for n in result.notes)

	def test_a_face_nobody_speaks_for_is_flagged(self):
		segments = [_voice(0, 0.0, 5.0)]
		speaking = _speaking([0, 0, 0, 0, 0])
		result = fuse(segments, speaking, person_ids=[10, 11])
		assert any("nobody's voice matched person 11" in n for n in result.notes)

	def test_hungarian_resolves_a_weak_tie_globally(self):
		# Voice 1 leans slightly towards face 0, but face 0 is overwhelmingly
		# voice 0's; the globally optimal assignment gives voice 1 face 1.
		segments = [_voice(0, 0.0, 10.0), _voice(1, 10.0, 20.0)]
		speaking = _speaking([0] * 10 + [0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
		result = fuse(segments, speaking, person_ids=[10, 11])
		assert result.speaker_to_person()[0] == 10
		assert result.speaker_to_person()[1] == 11

	def test_nothing_to_match_is_not_a_crash(self):
		assert fuse([], _speaking([]), person_ids=[]).matches == []
		assert fuse([], _speaking([]), person_ids=[10]).matches == []

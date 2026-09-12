"""Tests for the presence threshold that decides what counts as a person.

Detection and clustering need real footage and are exercised end to end; this
covers the arithmetic that decides which clusters survive, which is what let
six junk "people" into the cast screen on a full-length episode.
"""

from pipeline.faces import MIN_DETECTIONS, MIN_PRESENCE


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

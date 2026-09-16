import cv2
import numpy as np
import soundfile as sf

from pipeline.faces import _sample_frames

# Fixed regardless of episode length, so the payload size is predictable --
# 2000 floats as JSON is small, whether the episode is 5 minutes or 3 hours.
WAVEFORM_BUCKETS = 2000

# One thumbnail every 5-15 seconds reads as a scrubbable overview without
# needing hundreds of images for a long episode; the floor keeps a short clip
# from getting only one or two.
MIN_THUMBNAILS = 12
MAX_THUMBNAILS = 120
THUMBNAIL_SECONDS_PER_FRAME = 8

# These tile across a UI strip only ~14-40px tall, not a detail view, so a
# much smaller width and a lower JPEG quality than the face crops (which get
# viewed close up) are fine here.
THUMBNAIL_WIDTH = 160
THUMBNAIL_JPEG_QUALITY = 80


def compute_waveform_peaks(wav_path: str, buckets: int = WAVEFORM_BUCKETS) -> list[float]:
	"""RMS amplitude envelope of the whole episode, downsampled to a fixed
	number of time buckets, normalised so the loudest bucket is 1.0.

	Reads the already-extracted 16kHz mono wav rather than the source video --
	it's already decoded and on disk by the time this runs (see
	`extract_wav`), so there's nothing to gain from decoding the recording a
	second time.
	"""
	samples, _ = sf.read(wav_path, dtype="float32", always_2d=True)
	mono = samples.mean(axis=1)
	n = len(mono)
	if n == 0:
		return []

	# A clip shorter than the requested bucket count (test fixtures, a very
	# short recording) gets one sample per bucket instead of empty chunks.
	actual_buckets = min(buckets, n)
	chunks = np.array_split(mono, actual_buckets)
	rms = [float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2))) for chunk in chunks]

	peak = max(rms)
	if peak <= 0:
		# Silence (or a near-empty clip): every bucket is already 0, and
		# dividing by peak here would be a divide-by-zero.
		return [0.0] * len(rms)
	return [r / peak for r in rms]


def compute_timeline_thumbnails(video_path: str, duration: float) -> list[bytes]:
	"""Small JPEG thumbnails sampled at even intervals across the episode, for
	the timeline overview strip's scrubber.

	Reuses `_sample_frames` (the same frame-reading loop `detect_and_track_faces`
	uses) rather than a second `cv2.VideoCapture` read loop.
	"""
	count = max(MIN_THUMBNAILS, min(MAX_THUMBNAILS, round(duration / THUMBNAIL_SECONDS_PER_FRAME)))
	interval_s = duration / count

	thumbnails = []
	for _, frame in _sample_frames(video_path, interval_s):
		h, w = frame.shape[:2]
		new_w = THUMBNAIL_WIDTH
		new_h = max(1, round(h * new_w / w))
		resized = cv2.resize(frame, (new_w, new_h))
		_, buf = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, THUMBNAIL_JPEG_QUALITY])
		thumbnails.append(buf.tobytes())
		if len(thumbnails) >= count:
			break
	return thumbnails

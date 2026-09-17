import urllib.request
from dataclasses import dataclass, field

import cv2
import numpy as np
from sklearn.cluster import DBSCAN

from .paths import DATA_DIR, SERVER_DIR

# Small enough to commit (232KB), so it ships inside the app bundle and is
# only ever read -- see package.json's extraResources.
DETECTION_MODEL = SERVER_DIR / ".models" / "face_detection_yunet.onnx"
# Downloaded on first use rather than committed, so it's written at runtime
# and belongs with the rest of this install's data, not in the bundle. See
# paths.py for why that distinction matters.
MODELS_DIR = DATA_DIR / ".models"
RECOGNITION_MODEL = MODELS_DIR / "face_recognition_sface_2021dec.onnx"
RECOGNITION_MODEL_URL = (
	"https://github.com/opencv/opencv_zoo/raw/main/models/"
	"face_recognition_sface/face_recognition_sface_2021dec.onnx"
)

# Cosine distance below which two face embeddings are treated as the same person.
# Measured on real footage: four participants separated by 0.66-0.91, while
# fragments of the SAME person sat far below this. Anywhere in 0.3-0.6 gave an
# identical answer, so the exact value is not load-bearing.
IDENTITY_DISTANCE = 0.4

# A "person" seen in fewer sampled frames than this is discarded. Mirrors
# Immich's "Minimum Recognized Faces" setting. Catches false positives --
# on the test footage a hand was detected as a face twice and clustered into
# its own identity; this is what removes it.
#
# The floor, for clips too short for a proportion to mean anything.
MIN_DETECTIONS = 3

# What actually scales: a real participant is on screen for most of an
# episode, and a false positive is not. Measured on the 53-minute episode --
# all four participants appeared in 3,164-3,172 of 3,181 sampled frames
# (>99%), while six junk clusters appeared in 3 to 12 (<0.4%). A fixed floor
# of 3 keeps every one of those; anything in the low percentages separates
# them cleanly, so the exact value is not load-bearing.
MIN_PRESENCE = 0.05


@dataclass
class BBox:
	x: float
	y: float
	width: float
	height: float


@dataclass
class Detection:
	t: float
	bbox: BBox


@dataclass
class Person:
	"""One real human, assembled from however many detection fragments the
	tracker produced for them."""

	id: int
	thumbnail_jpeg: bytes
	keyframes: list[Detection] = field(default_factory=list)
	detection_count: int = 0


def _ensure_recognition_model(progress=None) -> None:
	"""SFace is ~38MB -- too big to commit, so it downloads on first use, the
	same way the Whisper model already does.

	`progress(label, fraction)` fires as bytes arrive, if given -- a real
	fraction is cheap here (this is a plain HTTP download this project
	controls), unlike the Whisper/pyannote model loads, where the same
	honesty would mean guessing at a total.
	"""
	if RECOGNITION_MODEL.exists():
		return
	MODELS_DIR.mkdir(parents=True, exist_ok=True)
	tmp = RECOGNITION_MODEL.with_suffix(".onnx.part")
	label = "downloading the face recognition model (first run only, ~38MB)"
	print(f"[faces] {label} to {RECOGNITION_MODEL} ...")

	def reporthook(block_num: int, block_size: int, total_size: int) -> None:
		if progress is not None and total_size > 0:
			progress(label, min(1.0, block_num * block_size / total_size))

	try:
		urllib.request.urlretrieve(RECOGNITION_MODEL_URL, tmp, reporthook=reporthook)
		tmp.replace(RECOGNITION_MODEL)
		print("[faces] face recognition model ready.")
	except Exception as err:
		tmp.unlink(missing_ok=True)
		raise RuntimeError(
			f"Could not download the face recognition model from {RECOGNITION_MODEL_URL}. "
			f"Download it manually and save it to {RECOGNITION_MODEL}. Original error: {err}"
		) from err


def _iou(a: BBox, b: BBox) -> float:
	ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.width, a.y + a.height
	bx1, by1, bx2, by2 = b.x, b.y, b.x + b.width, b.y + b.height
	inter_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
	inter_h = max(0.0, min(ay2, by2) - max(ay1, by1))
	inter = inter_w * inter_h
	union = a.width * a.height + b.width * b.height - inter
	return inter / union if union > 0 else 0.0


def _sample_frames(video_path: str, interval_s: float):
	cap = cv2.VideoCapture(video_path)
	fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
	frame_interval = max(1, round(fps * interval_s))
	idx = 0
	while True:
		ok, frame = cap.read()
		if not ok:
			break
		if idx % frame_interval == 0:
			yield idx / fps, frame
		idx += 1
	cap.release()


def _crop_thumbnail(frame: np.ndarray, bbox: BBox, pad: float = 0.4) -> bytes:
	h, w = frame.shape[:2]
	pad_w, pad_h = bbox.width * pad, bbox.height * pad
	x1 = max(0, int(bbox.x - pad_w))
	y1 = max(0, int(bbox.y - pad_h))
	x2 = min(w, int(bbox.x + bbox.width + pad_w))
	y2 = min(h, int(bbox.y + bbox.height + pad_h))
	_, buf = cv2.imencode(".jpg", frame[y1:y2, x1:x2], [cv2.IMWRITE_JPEG_QUALITY, 88])
	return buf.tobytes()


def _normalize(v: np.ndarray) -> np.ndarray:
	n = float(np.linalg.norm(v))
	return v / n if n > 0 else v


def get_video_dimensions(video_path: str) -> tuple[int, int]:
	cap = cv2.VideoCapture(video_path)
	w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
	h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
	cap.release()
	return w, h


def get_video_duration(video_path: str) -> float:
	cap = cv2.VideoCapture(video_path)
	fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
	frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
	cap.release()
	return frame_count / fps if fps else 0.0


def get_video_fps(video_path: str) -> float:
	cap = cv2.VideoCapture(video_path)
	fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
	cap.release()
	return float(fps)


def detect_and_track_faces(
	video_path: str,
	interval_s: float = 1.0,
	iou_threshold: float = 0.3,
	max_gap_s: float = 3.0,
	identity_distance: float = IDENTITY_DISTANCE,
	min_detections: int = MIN_DETECTIONS,
	min_presence: float = MIN_PRESENCE,
	progress=None,
	download_progress=None,
) -> list[Person]:
	"""Find the distinct people in a video, not just face rectangles.

	Three stages:

	1. **Detect** faces on sampled frames (YuNet), keeping the five facial
	   landmarks -- SFace needs them to align each crop before embedding.
	2. **Track** detections frame-to-frame by bounding-box overlap. This is
	   only good for short-term continuity: a hand passing over a face or a
	   head turn breaks the chain and starts a new track, so one person
	   routinely produces several fragments.
	3. **Recognise** -- embed every detection with SFace, average per track,
	   and cluster the track embeddings with DBSCAN. That collapses the
	   fragments back into one identity per real human, which is what stage 2
	   alone can never do. Same approach Immich uses for its people view
	   (embedding + DBSCAN), with a smaller, permissively-licensed model.

	On real four-person footage this turned 9 raw tracks into 4 people plus
	one junk cluster (a hand), which `min_detections` then drops.

	`download_progress(label, fraction)` fires while the recognition model is
	being fetched, only on a first run where it isn't cached yet.
	"""
	_ensure_recognition_model(download_progress)

	# Frames are streamed, never collected into a list. At one sample a second
	# a 53-minute 1080p episode is ~3,200 frames, ~20GB held at once: measured,
	# a list here pushed a 16GB machine deep into swap two minutes into a real
	# full-length episode, while 5-minute test clips never showed it.
	expected_frames = max(1, int(get_video_duration(video_path) / interval_s))
	detector = None
	recognizer = cv2.FaceRecognizerSF.create(str(RECOGNITION_MODEL), "")

	next_id = 0
	active: dict[int, dict] = {}
	finished: list[dict] = []
	sampled_frames = 0

	for i, (t, frame) in enumerate(_sample_frames(video_path, interval_s)):
		sampled_frames = i + 1
		if detector is None:
			h, w = frame.shape[:2]
			detector = cv2.FaceDetectorYN.create(str(DETECTION_MODEL), "", (w, h), score_threshold=0.6)
		if progress is not None and i % 10 == 0:
			progress(min(1.0, i / expected_frames))

		_, raw = detector.detect(frame)
		rows = [] if raw is None else list(raw)
		boxes = [BBox(x=float(r[0]), y=float(r[1]), width=float(r[2]), height=float(r[3])) for r in rows]
		# alignCrop needs the full 15-value row (bbox + 5 landmarks + score),
		# which is exactly why detection can't throw the landmarks away.
		embeddings = [
			_normalize(np.asarray(recognizer.feature(recognizer.alignCrop(frame, r))).flatten())
			for r in rows
		]

		candidates = [
			(_iou(track["last_bbox"], box), track_id, bi)
			for track_id, track in active.items()
			for bi, box in enumerate(boxes)
		]
		candidates = [c for c in candidates if c[0] > iou_threshold]
		candidates.sort(reverse=True)

		matched_tracks: set[int] = set()
		matched_boxes: set[int] = set()
		for _score, track_id, bi in candidates:
			if track_id in matched_tracks or bi in matched_boxes:
				continue
			matched_tracks.add(track_id)
			matched_boxes.add(bi)
			box = boxes[bi]
			track = active[track_id]
			track["last_bbox"] = box
			track["last_seen"] = t
			track["keyframes"].append(Detection(t=t, bbox=box))
			track["embeddings"].append(embeddings[bi])
			area = box.width * box.height
			if area > track["best_area"]:
				track["best_area"] = area
				track["thumbnail"] = _crop_thumbnail(frame, box)

		for track_id in list(active.keys()):
			if track_id not in matched_tracks and t - active[track_id]["last_seen"] > max_gap_s:
				finished.append(active.pop(track_id))

		for bi, box in enumerate(boxes):
			if bi in matched_boxes:
				continue
			active[next_id] = {
				"id": next_id,
				"last_bbox": box,
				"last_seen": t,
				"keyframes": [Detection(t=t, bbox=box)],
				"embeddings": [embeddings[bi]],
				"best_area": box.width * box.height,
				# Store the encoded thumbnail, not the frame -- holding full
				# 1920x1080 frames per track balloons memory on long videos.
				"thumbnail": _crop_thumbnail(frame, box),
			}
			next_id += 1

	finished.extend(active.values())
	tracks = [tr for tr in finished if tr["embeddings"]]
	if not tracks:
		return []

	track_embeddings = np.array([_normalize(np.mean(tr["embeddings"], axis=0)) for tr in tracks])
	labels = DBSCAN(eps=identity_distance, min_samples=1, metric="cosine").fit_predict(track_embeddings)

	people: list[Person] = []
	for label in sorted(set(labels)):
		members = [tracks[i] for i in range(len(tracks)) if labels[i] == label]
		keyframes: dict[float, Detection] = {}
		for m in members:
			for kf in m["keyframes"]:
				# Fragments of one person can overlap in time if detection
				# double-fired; keep the largest box for any given instant.
				prev = keyframes.get(kf.t)
				if prev is None or kf.bbox.width * kf.bbox.height > prev.bbox.width * prev.bbox.height:
					keyframes[kf.t] = kf
		count = sum(len(m["keyframes"]) for m in members)
		# Scales with episode length: a fixed floor of 3 is a high bar on a
		# 60-second clip and no bar at all on a 53-minute episode, where six
		# junk clusters cleared it and turned up in the cast screen as people
		# to name.
		if count < max(min_detections, round(sampled_frames * min_presence)):
			continue
		best = max(members, key=lambda m: m["best_area"])
		people.append(
			Person(
				id=len(people),
				thumbnail_jpeg=best["thumbnail"],
				keyframes=sorted(keyframes.values(), key=lambda k: k.t),
				detection_count=count,
			)
		)

	# Most-present people first: in a podcast the participants are on screen
	# far more than anyone who wanders through, so this puts the real
	# participants at the top of the labelling UI.
	people.sort(key=lambda p: -p.detection_count)
	for i, p in enumerate(people):
		p.id = i
	return people

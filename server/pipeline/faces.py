from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

MODEL_PATH = Path(__file__).parent.parent / ".models" / "face_detection_yunet.onnx"


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
class FaceTrack:
	id: int
	thumbnail_jpeg: bytes
	keyframes: list[Detection] = field(default_factory=list)


def _iou(a: BBox, b: BBox) -> float:
	ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.width, a.y + a.height
	bx1, by1, bx2, by2 = b.x, b.y, b.x + b.width, b.y + b.height
	inter_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
	inter_h = max(0.0, min(ay2, by2) - max(ay1, by1))
	inter = inter_w * inter_h
	union = a.width * a.height + b.width * b.height - inter
	return inter / union if union > 0 else 0.0


def _sample_frames(video_path: str, interval_s: float) -> list[tuple[float, np.ndarray]]:
	cap = cv2.VideoCapture(video_path)
	fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
	frame_interval = max(1, round(fps * interval_s))

	frames: list[tuple[float, np.ndarray]] = []
	idx = 0
	while True:
		ok, frame = cap.read()
		if not ok:
			break
		if idx % frame_interval == 0:
			frames.append((idx / fps, frame))
		idx += 1
	cap.release()
	return frames


def _detect_in_frame(detector: cv2.FaceDetectorYN, frame: np.ndarray) -> list[BBox]:
	_, faces = detector.detect(frame)
	if faces is None:
		return []
	return [BBox(x=float(f[0]), y=float(f[1]), width=float(f[2]), height=float(f[3])) for f in faces]


def _crop_thumbnail(frame: np.ndarray, bbox: BBox, pad: float = 0.15) -> bytes:
	h, w = frame.shape[:2]
	pad_w, pad_h = bbox.width * pad, bbox.height * pad
	x1 = max(0, int(bbox.x - pad_w))
	y1 = max(0, int(bbox.y - pad_h))
	x2 = min(w, int(bbox.x + bbox.width + pad_w))
	y2 = min(h, int(bbox.y + bbox.height + pad_h))
	crop = frame[y1:y2, x1:x2]
	_, buf = cv2.imencode(".jpg", crop)
	return buf.tobytes()


def get_video_dimensions(video_path: str) -> tuple[int, int]:
	cap = cv2.VideoCapture(video_path)
	w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
	h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
	cap.release()
	return w, h


def detect_and_track_faces(
	video_path: str,
	interval_s: float = 1.0,
	iou_threshold: float = 0.3,
	max_gap_s: float = 3.0,
	min_keyframes: int = 2,
) -> list[FaceTrack]:
	"""Detect faces on sampled frames and link them into persistent tracks.

	No face-identity/embedding model here (that's a heavier ask than we need) —
	just greedy IOU matching frame-to-frame, which is enough for a mostly
	static single-camera podcast shot. A track that isn't matched for more
	than max_gap_s is closed out (handles someone leaving frame and a new
	person entering later without merging them into the same track).
	"""
	frames = _sample_frames(video_path, interval_s)
	if not frames:
		return []

	h, w = frames[0][1].shape[:2]
	detector = cv2.FaceDetectorYN.create(str(MODEL_PATH), "", (w, h), score_threshold=0.6)
	detector.setInputSize((w, h))

	next_id = 0
	active: dict[int, dict] = {}
	finished: list[dict] = []

	for t, frame in frames:
		boxes = _detect_in_frame(detector, frame)

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
			area = box.width * box.height
			if area > track["best_area"]:
				track["best_area"] = area
				track["best_frame"] = frame
				track["best_bbox"] = box

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
				"best_area": box.width * box.height,
				"best_frame": frame,
				"best_bbox": box,
			}
			next_id += 1

	finished.extend(active.values())

	tracks = [
		FaceTrack(
			id=tr["id"],
			thumbnail_jpeg=_crop_thumbnail(tr["best_frame"], tr["best_bbox"]),
			keyframes=tr["keyframes"],
		)
		for tr in finished
		if len(tr["keyframes"]) >= min_keyframes
	]
	return sorted(tracks, key=lambda tr: tr.keyframes[0].t)

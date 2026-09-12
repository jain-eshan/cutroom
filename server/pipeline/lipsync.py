"""Which face is speaking, from the picture rather than the sound.

Diarisation says *when* each voice talks; it has no idea which body that voice
came out of. This says, per face, how much it looks like that mouth is
producing the audio right now. The two signals fail independently -- one voice
landing on two faces means the diariser merged people, two voices landing on
one face means it split someone in half -- which is what makes pairing them
worth doing (see fuse.py).

Model is LR-ASD (MIT), AVA weights. See lrasd/NOTICE.md.
"""

import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from scipy.fft import dct
from scipy.io import wavfile

MODELS_DIR = Path(__file__).parent.parent / ".models"
WEIGHTS = MODELS_DIR / "lrasd_pretrain_AVA.model"
WEIGHTS_URL = "https://raw.githubusercontent.com/Junhua-Liao/LR-ASD/main/weight/pretrain_AVA.model"

# The model was trained at 25fps video against 100fps audio features. Source
# footage is whatever it is, so frames are resampled onto this grid.
MODEL_FPS = 25
AUDIO_FEATURE_FPS = 100

# Seconds of video scored per forward pass. Also the memory unit: crops for one
# window are (people x 100 x 112 x 112) bytes -- about 5MB for four people.
# Holding the whole episode instead, the way a 3-minute benchmark can get away
# with, is ~4GB for 53 minutes.
WINDOW_SECONDS = 4

# Crop geometry, matching what the weights were trained on: the box is the face
# plus 40% margin, with more headroom below than above (mouths, not eyes).
CROP_MARGIN = 0.4
CROP_PAD_VALUE = 110

# +-2 frames. Raw per-frame scores flicker; the question is who is speaking,
# not who moved their lip this frame.
SMOOTH_FRAMES = 5


@dataclass
class LipSync:
	"""Per-face speaking scores, one row per person, one column per 25fps frame.
	Positive means the model thinks that face is talking."""

	person_ids: list[int]
	scores: np.ndarray

	def speaking_per_second(self) -> np.ndarray:
		"""Index into person_ids of whoever is most likely speaking each second,
		or -1 for nobody. Per second rather than per frame because that is the
		granularity the voice side can actually be matched at."""
		if self.scores.ndim != 2 or self.scores.size == 0:
			return np.empty(0, dtype=int)
		seconds = self.scores.shape[1] // MODEL_FPS
		if seconds == 0:
			return np.empty(0, dtype=int)
		per_second = self.scores[:, : seconds * MODEL_FPS].reshape(
			len(self.person_ids), seconds, MODEL_FPS
		).mean(2)
		return np.where(per_second.max(0) > 0, per_second.argmax(0), -1)


def _ensure_weights() -> Path:
	"""3.3MB, downloaded on first use rather than committed -- the same
	arrangement as the SFace recognition model."""
	if WEIGHTS.exists():
		return WEIGHTS
	MODELS_DIR.mkdir(parents=True, exist_ok=True)
	tmp = WEIGHTS.with_suffix(".part")
	print(f"[lipsync] downloading LR-ASD weights (~3.3MB) to {WEIGHTS} ...")
	try:
		urllib.request.urlretrieve(WEIGHTS_URL, tmp)
		tmp.replace(WEIGHTS)
	except (urllib.error.URLError, OSError) as err:
		tmp.unlink(missing_ok=True)
		raise RuntimeError(
			f"Could not download the lip-sync model from {WEIGHTS_URL}. "
			f"Download it manually and save it to {WEIGHTS}. Original error: {err}"
		) from err
	return WEIGHTS


_model = None
_head = None


def _load_model(device: str):
	"""Weights only, and only the model classes are imported -- none of the
	upstream repo's scripts are executed."""
	global _model, _head
	if _model is None:
		import torch

		from .lrasd import ASD_Model

		state = torch.load(_ensure_weights(), weights_only=True, map_location="cpu")
		model = ASD_Model()
		model.load_state_dict(
			{k[len("model.") :]: v for k, v in state.items() if k.startswith("model.")}, strict=True
		)
		# The speaking/not-speaking head lives outside ASD_Model in the training
		# code, so it is rebuilt here from the same checkpoint.
		head = torch.nn.Linear(128, 2)
		head.load_state_dict({"weight": state["lossAV.FC.weight"], "bias": state["lossAV.FC.bias"]})
		model.eval().to(device)
		head.eval().to(device)
		_model, _head = model, head
	return _model, _head


def mfcc(signal: np.ndarray, sample_rate: int = 16000, block_frames: int = 8192) -> np.ndarray:
	"""13-coefficient MFCC matching python_speech_features' defaults, which is
	what the weights were trained against: rectangular window, power spectrum
	over nfft, 26 mel filters, DCT-II ortho, lifter 22, and c0 replaced by log
	frame energy.

	Reimplemented rather than adding the dependency, and framed in blocks: the
	framed view of a 53-minute episode is ~1GB in one allocation, while the
	output it reduces to is ~33MB.
	"""
	winlen, winstep, numcep, nfilt, nfft, preemph, lifter = 0.025, 0.010, 13, 26, 512, 0.97, 22

	signal = signal.astype(np.float64)
	signal = np.append(signal[0], signal[1:] - preemph * signal[:-1])
	flen, fstep = int(round(winlen * sample_rate)), int(round(winstep * sample_rate))
	count = 1 if len(signal) <= flen else 1 + int(np.ceil((len(signal) - flen) / fstep))
	signal = np.concatenate([signal, np.zeros((count - 1) * fstep + flen - len(signal))])

	def hz_to_mel(hz):
		return 2595 * np.log10(1 + hz / 700.0)

	def mel_to_hz(mel):
		return 700 * (10 ** (mel / 2595.0) - 1)

	edges = np.floor(
		(nfft + 1)
		* mel_to_hz(np.linspace(hz_to_mel(0), hz_to_mel(sample_rate / 2), nfilt + 2))
		/ sample_rate
	)
	filters = np.zeros((nfilt, nfft // 2 + 1))
	for j in range(nfilt):
		for i in range(int(edges[j]), int(edges[j + 1])):
			filters[j, i] = (i - edges[j]) / (edges[j + 1] - edges[j])
		for i in range(int(edges[j + 1]), int(edges[j + 2])):
			filters[j, i] = (edges[j + 2] - i) / (edges[j + 2] - edges[j + 1])

	out = np.empty((count, numcep))
	for start in range(0, count, block_frames):
		stop = min(start + block_frames, count)
		idx = np.arange(flen)[None, :] + fstep * np.arange(start, stop)[:, None]
		power = np.abs(np.fft.rfft(signal[idx], nfft)) ** 2 / nfft
		energy = power.sum(1)
		energy[energy == 0] = np.finfo(float).eps
		feat = power @ filters.T
		feat[feat == 0] = np.finfo(float).eps
		feat = dct(np.log(feat), type=2, axis=1, norm="ortho")[:, :numcep]
		feat *= 1 + (lifter / 2.0) * np.sin(np.pi * np.arange(numcep) / lifter)
		feat[:, 0] = np.log(energy)
		out[start:stop] = feat
	return out


def _face_at(keyframes: list[dict], t: float) -> tuple[float, float, float]:
	"""Face centre and half-size at an arbitrary time, interpolated from the
	one-per-second keyframes the face pass already produced.

	No per-frame face detection: running the detector on every frame of a
	full-length episode costs about an hour, and it buys precision that is
	thrown away immediately afterwards -- the reference implementation median-
	filters these positions over 13 frames, half a second, because a seated
	person does not move meaningfully within one.
	"""
	times = [kf["t"] for kf in keyframes]
	boxes = [kf["bbox"] for kf in keyframes]
	centres_x = [b["x"] + b["width"] / 2 for b in boxes]
	centres_y = [b["y"] + b["height"] / 2 for b in boxes]
	sizes = [max(b["width"], b["height"]) / 2 for b in boxes]
	return (
		float(np.interp(t, times, centres_x)),
		float(np.interp(t, times, centres_y)),
		float(np.interp(t, times, sizes)),
	)


def _crop_face(gray: np.ndarray, cx: float, cy: float, half: float) -> np.ndarray:
	"""112x112 mouth-centred crop, padding only what falls outside the frame.

	The reference pads the entire frame before cutting, once per person per
	frame; on 1080p that is four full-frame copies a frame for no gain."""
	x0 = int(round(cx - half * (1 + CROP_MARGIN)))
	x1 = int(round(cx + half * (1 + CROP_MARGIN)))
	y0 = int(round(cy - half))
	y1 = int(round(cy + half * (1 + 2 * CROP_MARGIN)))

	h, w = gray.shape
	patch = gray[max(0, y0) : max(0, y1), max(0, x0) : max(0, x1)]
	top, left = max(0, -y0), max(0, -x0)
	bottom, right = max(0, y1 - h), max(0, x1 - w)
	if top or bottom or left or right:
		patch = cv2.copyMakeBorder(
			patch, top, bottom, left, right, cv2.BORDER_CONSTANT, value=CROP_PAD_VALUE
		)
	if patch.size == 0:
		return np.full((112, 112), CROP_PAD_VALUE, np.uint8)
	return cv2.resize(patch, (224, 224))[56:168, 56:168]


def analyse(
	video_path: str,
	wav_path: str,
	people: list[dict],
	device: str = "cpu",
	progress=None,
) -> LipSync:
	"""Score every person's face against the audio, a window at a time.

	`people` are the entries the face pass produced: an `id` and `keyframes`.
	"""
	import torch

	# Face recognition found nobody -- a slideshow, an empty room, a recording
	# where the camera never sees a face. Nothing to score against.
	if not people:
		return LipSync(person_ids=[], scores=np.zeros((0, 0)))

	model, head = _load_model(device)

	sample_rate, audio = wavfile.read(wav_path)
	if audio.ndim > 1:
		audio = audio[:, 0]
	features = mfcc(audio, sample_rate)

	capture = cv2.VideoCapture(video_path)
	source_fps = capture.get(cv2.CAP_PROP_FPS) or MODEL_FPS
	total_frames = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
	duration = total_frames / source_fps if source_fps else 0.0
	# Whichever of picture and sound runs out first bounds the analysis.
	duration = min(duration, len(features) / AUDIO_FEATURE_FPS) if duration else len(
		features
	) / AUDIO_FEATURE_FPS

	person_ids = [p["id"] for p in people]
	window_frames = WINDOW_SECONDS * MODEL_FPS
	scores: list[np.ndarray] = [[] for _ in people]

	slot = 0  # next 25fps slot to fill
	buffer = np.zeros((len(people), window_frames, 112, 112), np.uint8)
	filled = 0
	windows_done = 0
	total_windows = max(1, int(np.ceil(duration / WINDOW_SECONDS)))

	def score_window(count: int) -> None:
		nonlocal windows_done
		if count == 0:
			return
		start_feature = windows_done * WINDOW_SECONDS * AUDIO_FEATURE_FPS
		audio_window = features[start_feature : start_feature + count * 4]
		if len(audio_window) < 4:
			windows_done += 1
			return
		with torch.no_grad():
			audio_tensor = torch.FloatTensor(audio_window).unsqueeze(0).to(device)
			embed_a = model.forward_audio_frontend(audio_tensor)
			for person in range(len(people)):
				visual = torch.FloatTensor(buffer[person, :count]).unsqueeze(0).to(device)
				embed_v = model.forward_visual_frontend(visual)
				out = model.forward_audio_visual_backend(embed_a, embed_v)
				scores[person].append(head(out)[:, 1].cpu().numpy())
		windows_done += 1
		if progress is not None:
			progress(min(1.0, windows_done / total_windows))

	while True:
		ok, frame = capture.read()
		if not ok:
			break
		# Resample whatever the source runs at onto the model's 25fps grid by
		# taking the first frame that reaches each slot.
		frame_time = capture.get(cv2.CAP_PROP_POS_FRAMES) / source_fps
		if frame_time < slot / MODEL_FPS:
			continue

		gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
		t = slot / MODEL_FPS
		for person, entry in enumerate(people):
			cx, cy, half = _face_at(entry["keyframes"], t)
			buffer[person, filled] = _crop_face(gray, cx, cy, half)
		slot += 1
		filled += 1

		if filled == window_frames:
			score_window(filled)
			filled = 0
	capture.release()
	score_window(filled)

	# A clip shorter than one window, or with no usable audio, scores nothing.
	if not any(rows for rows in scores):
		return LipSync(person_ids=person_ids, scores=np.zeros((len(person_ids), 0)))

	stacked = np.array(
		[
			np.convolve(
				np.concatenate(rows), np.ones(SMOOTH_FRAMES) / SMOOTH_FRAMES, mode="same"
			)
			for rows in scores
		]
	)
	return LipSync(person_ids=person_ids, scores=stacked)

import threading
from dataclasses import dataclass

import soundfile as sf

from .paths import SERVER_DIR

DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1"
DIARIZATION_SETUP_URL = f"https://huggingface.co/{DIARIZATION_MODEL}"

# Ships with the app, like the YuNet detector: six files, 31MB, and every one
# of them inside that single repo -- community-1's own config.yaml refers to
# `$model/segmentation`, `$model/embedding` and `$model/plda`, all relative to
# itself, so there is nothing left to fetch once the folder is on disk.
#
# It used to download from Hugging Face on first use, which is the only reason
# this app ever asked for a token: the repo is gated behind a form, so running
# it meant creating an account, accepting the terms and pasting a token in
# before anything could be edited. community-1 is CC-BY-4.0, which allows
# redistribution with attribution (see NOTICE.md beside the weights), so the
# app ships them and credits pyannote instead of sending every new person
# through a sign-up. Nothing here reads HF_TOKEN any more.
BUNDLED_MODEL_DIR = SERVER_DIR / ".models" / "diarization"
BUNDLED_CONFIG = BUNDLED_MODEL_DIR / "config.yaml"

# An overlap shorter than this is real speech but not an edit. community-1
# resolves overlap far more finely than the old detector did -- on a 10-minute
# slice it found 10 overlaps totalling 2.6s, every one of them between 0.02s
# and 0.31s. Those are interjections ("yeah", "mhm"), and cutting to a
# two-person composite for a fifth of a second reads as a flash, not as two
# people talking over each other. The data is right; the edit decision is what
# needs a floor.
MIN_OVERLAP_SECONDS = 1.0


@dataclass
class SpeakerSegment:
	start: float
	end: float
	speaker: int


@dataclass
class OverlapWindow:
	start: float
	end: float
	speakers: list[int]


@dataclass
class Diarization:
	"""Both outputs of one pass. Overlap used to be a second model that had to
	be cross-referenced against the speaker segments to guess who was involved;
	community-1 is overlap-aware, so the two people talking over each other are
	simply two segments covering the same instant, and "who" is exact rather
	than inferred."""

	segments: list[SpeakerSegment]
	overlaps: list[OverlapWindow]


class DiarizationUnavailable(Exception):
	"""Raised when the diarisation model cannot run: the bundled weights are
	missing, or the model fails to load. Unlike the old optional overlap
	detection, this is fatal -- without speaker turns there is nothing to
	edit."""


MISSING_MODEL_MESSAGE = (
	f"The speaker detection model is missing from this install. It should be at "
	f"{BUNDLED_MODEL_DIR}. Reinstall Cutroom, or download "
	f"{DIARIZATION_MODEL} into that folder."
)


def diarization_configured() -> bool:
	"""Whether the bundled model is actually on disk.

	Always true in a sound install -- the weights ship with the app. It stays
	a check rather than an assumption because a partial download, a blocked
	copy or a hand-assembled install would otherwise fail minutes into a job
	instead of before it starts. Cheap enough to call on every health poll.
	"""
	return BUNDLED_CONFIG.exists()


_pipeline = None
# Same reasoning as transcribe.py's _lock: nothing limits concurrent jobs, so
# two jobs racing on a fresh install could both see _pipeline as None and
# both load community-1 (several hundred MB) at once.
_lock = threading.Lock()


def _best_device():
	import torch

	# Measured on a 10-minute slice: 398s on CPU vs 53s on MPS, for byte-identical
	# output (3 speakers, 90 turns either way). 35 minutes per episode versus 5.
	if torch.backends.mps.is_available():
		return torch.device("mps")
	if torch.cuda.is_available():
		return torch.device("cuda")
	return torch.device("cpu")


def _get_pipeline(on_loading=None):
	global _pipeline
	if _pipeline is not None:
		return _pipeline
	if not diarization_configured():
		raise DiarizationUnavailable(MISSING_MODEL_MESSAGE)
	with _lock:
		if _pipeline is None:
			from pyannote.audio import Pipeline

			# Reading 31MB off local disk, not downloading it, so this label no
			# longer has to hedge about which of the two is happening.
			if on_loading is not None:
				on_loading("loading the speaker detection model")
			try:
				pipeline = Pipeline.from_pretrained(BUNDLED_CONFIG)
			except Exception as err:
				raise DiarizationUnavailable(
					f"Could not load the speaker detection model from {BUNDLED_MODEL_DIR}: {err}"
				) from err
			pipeline.to(_best_device())
			_pipeline = pipeline
		return _pipeline


def diarize(wav_path: str, on_loading=None) -> Diarization:
	"""Who speaks when, on the single mixed track.

	No speaker count is passed. Forcing one was measured to invent speakers:
	asking for four on a ten-minute window where the fourth participant barely
	talks split one person into two. The roster is confirmed by a human at the
	cast step instead, which is the one place that actually knows.

	`on_loading(message)` fires once, only if the model isn't already loaded
	in this process.
	"""
	import torch

	pipeline = _get_pipeline(on_loading)

	# Decoded here rather than handed over as a path. pyannote 4 reads audio via
	# torchcodec, whose prebuilt libraries link against FFmpeg 4-7; on FFmpeg 9
	# none of them load and the pipeline cannot open a file at all. We already
	# have a 16kHz mono wav by this point, so there is nothing to gain from
	# letting it decode its own.
	samples, sample_rate = sf.read(wav_path, dtype="float32", always_2d=True)
	waveform = torch.from_numpy(samples.T)  # (channels, samples)

	output = pipeline({"waveform": waveform, "sample_rate": sample_rate})
	annotation = getattr(output, "speaker_diarization", output)

	tracks = list(annotation.itertracks(yield_label=True))
	# Model labels are strings ("SPEAKER_00"); the rest of the codebase speaks
	# in ints. Sorted so the mapping is deterministic across runs.
	label_ids = {label: i for i, label in enumerate(sorted({label for _, _, label in tracks}))}

	segments = sorted(
		(
			SpeakerSegment(start=turn.start, end=turn.end, speaker=label_ids[label])
			for turn, _, label in tracks
		),
		key=lambda s: (s.start, s.end),
	)
	return Diarization(segments=segments, overlaps=overlap_windows(segments))


def overlap_windows(
	segments: list[SpeakerSegment], min_duration: float = MIN_OVERLAP_SECONDS
) -> list[OverlapWindow]:
	"""Stretches where two or more speakers are active at the same instant, and
	stay that way long enough to be worth cutting to.

	A boundary sweep rather than pairwise intersection: the same approach as
	build_render_segments, and it handles three-way overlaps without special
	cases. Merging happens before the length filter, so a long overlap
	interrupted by boundary noise isn't thrown away in pieces."""
	boundaries = sorted({s.start for s in segments} | {s.end for s in segments})

	windows: list[OverlapWindow] = []
	for a, b in zip(boundaries, boundaries[1:]):
		if b - a <= 1e-6:
			continue
		mid = (a + b) / 2
		active = sorted({s.speaker for s in segments if s.start <= mid < s.end})
		if len(active) < 2:
			continue
		last = windows[-1] if windows else None
		if last is not None and last.speakers == active and abs(last.end - a) <= 1e-6:
			windows[-1] = OverlapWindow(start=last.start, end=b, speakers=active)
		else:
			windows.append(OverlapWindow(start=a, end=b, speakers=active))
	return [w for w in windows if w.end - w.start >= min_duration]

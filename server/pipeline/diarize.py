import os
from dataclasses import dataclass

import soundfile as sf

DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1"
DIARIZATION_SETUP_URL = f"https://huggingface.co/{DIARIZATION_MODEL}"

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
	"""Raised when the diarisation model cannot run: no HF_TOKEN, or the model
	fails to load. Unlike the old optional overlap detection, this is fatal --
	without speaker turns there is nothing to edit."""


MISSING_TOKEN_MESSAGE = (
	"HF_TOKEN is not set. Speaker diarisation needs a Hugging Face access "
	"token: create one at https://huggingface.co/settings/tokens, accept the "
	f"model licence at {DIARIZATION_SETUP_URL}, then set HF_TOKEN in "
	"server/.env and restart the service."
)


def diarization_configured() -> bool:
	"""Whether the token diarisation needs is set at all.

	This can't prove the model licence was accepted -- that only shows when
	the model loads -- but it catches the common case (no token) before a
	multi-minute transcription instead of after it. Cheap enough to call on
	every health poll.
	"""
	return bool(os.environ.get("HF_TOKEN"))


_pipeline = None


def forget_pipeline() -> None:
	"""Drop the loaded model, so the next job loads it with the current token."""
	global _pipeline
	_pipeline = None


def _best_device():
	import torch

	# Measured on a 10-minute slice: 398s on CPU vs 53s on MPS, for byte-identical
	# output (3 speakers, 90 turns either way). 35 minutes per episode versus 5.
	if torch.backends.mps.is_available():
		return torch.device("mps")
	if torch.cuda.is_available():
		return torch.device("cuda")
	return torch.device("cpu")


def _get_pipeline():
	global _pipeline
	if _pipeline is None:
		if not diarization_configured():
			raise DiarizationUnavailable(MISSING_TOKEN_MESSAGE)
		token = os.environ["HF_TOKEN"]
		from pyannote.audio import Pipeline

		try:
			pipeline = Pipeline.from_pretrained(DIARIZATION_MODEL, token=token)
		except Exception as err:
			raise DiarizationUnavailable(
				f"Could not load {DIARIZATION_MODEL}: {err}. The licence at "
				f"{DIARIZATION_SETUP_URL} has to be accepted by the account the token "
				"belongs to."
			) from err
		pipeline.to(_best_device())
		_pipeline = pipeline
	return _pipeline


def diarize(wav_path: str) -> Diarization:
	"""Who speaks when, on the single mixed track.

	No speaker count is passed. Forcing one was measured to invent speakers:
	asking for four on a ten-minute window where the fourth participant barely
	talks split one person into two. The roster is confirmed by a human at the
	cast step instead, which is the one place that actually knows.
	"""
	import torch

	pipeline = _get_pipeline()

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

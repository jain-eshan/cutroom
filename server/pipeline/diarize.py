import os
from dataclasses import dataclass

import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score

RESEMBLYZER_SAMPLE_RATE = 16000

OVERLAP_MODEL = "pyannote/overlapped-speech-detection"
OVERLAP_SETUP_URL = f"https://huggingface.co/{OVERLAP_MODEL}"


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


_encoder: VoiceEncoder | None = None


def get_encoder() -> VoiceEncoder:
	global _encoder
	if _encoder is None:
		_encoder = VoiceEncoder()
	return _encoder


def diarize(
	wav_path: str,
	num_speakers: int | None = None,
	max_speakers: int = 6,
) -> list[SpeakerSegment]:
	"""Cluster sliding-window voice embeddings into speaker turns.

	No per-speaker audio to lean on, so this is audio-only diarization on the
	single mixed track: embed overlapping windows, cluster them by voice
	similarity, then collapse consecutive same-cluster windows into segments.
	"""
	wav = preprocess_wav(wav_path)
	encoder = get_encoder()
	_, partial_embeds, wav_splits = encoder.embed_utterance(wav, return_partials=True, rate=1.3)

	if len(partial_embeds) < 2:
		return [SpeakerSegment(start=0.0, end=len(wav) / RESEMBLYZER_SAMPLE_RATE, speaker=0)]

	k = num_speakers or _estimate_speaker_count(partial_embeds, max_speakers)
	k = max(1, min(k, len(partial_embeds)))

	if k == 1:
		labels = np.zeros(len(partial_embeds), dtype=int)
	else:
		clustering = AgglomerativeClustering(n_clusters=k, metric="cosine", linkage="average")
		labels = clustering.fit_predict(partial_embeds)

	segments: list[SpeakerSegment] = []
	for label, split in zip(labels, wav_splits):
		start = split.start / RESEMBLYZER_SAMPLE_RATE
		end = split.stop / RESEMBLYZER_SAMPLE_RATE
		speaker = int(label)
		if segments and segments[-1].speaker == speaker and start - segments[-1].end < 0.3:
			segments[-1] = SpeakerSegment(start=segments[-1].start, end=end, speaker=speaker)
		else:
			segments.append(SpeakerSegment(start=start, end=end, speaker=speaker))
	return segments


class OverlapDetectionUnavailable(Exception):
	"""Raised when HF_TOKEN isn't configured. Caller should treat this as a
	soft failure (no overlap data) rather than a hard error -- everything
	else in /transcribe works fine without it."""


_overlap_pipeline = None


def _get_overlap_pipeline():
	global _overlap_pipeline
	if _overlap_pipeline is None:
		token = os.environ.get("HF_TOKEN")
		if not token:
			raise OverlapDetectionUnavailable(
				f"HF_TOKEN is not set. Overlap detection needs a Hugging Face "
				f"access token: create one at https://huggingface.co/settings/tokens, "
				f"accept the model license at {OVERLAP_SETUP_URL}, then set HF_TOKEN "
				f"in your environment (e.g. server/.env) and restart the service."
			)
		from pyannote.audio import Pipeline

		_overlap_pipeline = Pipeline.from_pretrained(OVERLAP_MODEL, use_auth_token=token)
	return _overlap_pipeline


def detect_overlap(wav_path: str, speaker_segments: list[SpeakerSegment]) -> list[OverlapWindow]:
	"""Find stretches where two or more people are talking at once.

	pyannote.audio's overlapped-speech-detection model finds WHEN multiple
	voices are active -- it doesn't know WHICH of our speaker ids (assigned
	separately, by diarize() above) are involved, since that's a different
	model with no shared vocabulary of speaker identity. Cross-reference: for
	every detected overlap region, collect the distinct speaker ids from
	`speaker_segments` whose time range intersects it. In practice,
	window-based clustering (diarize()) tends to flip between the two
	dominant voices from one window to the next during a real overlap, which
	recovers >=2 distinct ids. If fewer than 2 ids are recovered, the overlap
	region is dropped -- there's no usable "who" signal to build a composite
	from, and a single-speaker "overlap" is a contradiction anyway.

	Raises OverlapDetectionUnavailable if HF_TOKEN isn't configured -- callers
	should catch this and fall back to an empty list, not fail the request.
	"""
	pipeline = _get_overlap_pipeline()
	output = pipeline(wav_path)

	windows: list[OverlapWindow] = []
	for region in output.get_timeline().support():
		speakers = sorted(
			{
				seg.speaker
				for seg in speaker_segments
				if seg.start < region.end and seg.end > region.start
			}
		)
		if len(speakers) >= 2:
			windows.append(OverlapWindow(start=region.start, end=region.end, speakers=speakers))
	return windows


def _estimate_speaker_count(embeds: np.ndarray, max_speakers: int) -> int:
	best_k, best_score = 2, -1.0
	upper = min(max_speakers, len(embeds) - 1)
	for k in range(2, max(upper, 2) + 1):
		clustering = AgglomerativeClustering(n_clusters=k, metric="cosine", linkage="average")
		labels = clustering.fit_predict(embeds)
		if len(set(labels)) < 2:
			continue
		score = silhouette_score(embeds, labels, metric="cosine")
		if score > best_score:
			best_k, best_score = k, score
	return best_k

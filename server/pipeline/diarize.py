from dataclasses import dataclass

import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score

RESEMBLYZER_SAMPLE_RATE = 16000


@dataclass
class SpeakerSegment:
	start: float
	end: float
	speaker: int


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

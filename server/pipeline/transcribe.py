from dataclasses import dataclass

from faster_whisper import WhisperModel


@dataclass
class Word:
	start: float
	end: float
	text: str


@dataclass
class TranscribedSegment:
	start: float
	end: float
	text: str
	words: list[Word]


_model: WhisperModel | None = None


def get_model(model_size: str = "small") -> WhisperModel:
	global _model
	if _model is None:
		_model = WhisperModel(model_size, device="cpu", compute_type="int8")
	return _model


def transcribe(
	wav_path: str, model_size: str = "small", progress=None, on_segment=None
) -> list[TranscribedSegment]:
	"""Transcribe with word timings.

	`on_segment(segment, duration)` fires per segment as it is produced, which
	is what lets the UI show the transcript arriving rather than only a bar
	moving -- segments are yielded lazily, so there is real output to show
	minutes before the pass finishes.
	"""
	model = get_model(model_size)
	segments, info = model.transcribe(wav_path, word_timestamps=True, vad_filter=True)

	# faster-whisper yields segments lazily, so how far the last one reached
	# is a real measure of progress through the audio.
	duration = getattr(info, "duration", 0.0) or 0.0

	result: list[TranscribedSegment] = []
	for seg in segments:
		if progress is not None and duration > 0:
			progress(min(1.0, seg.end / duration))
		words = [Word(start=w.start, end=w.end, text=w.word.strip()) for w in (seg.words or [])]
		item = TranscribedSegment(start=seg.start, end=seg.end, text=seg.text.strip(), words=words)
		result.append(item)
		if on_segment is not None:
			on_segment(item, duration)
	return result

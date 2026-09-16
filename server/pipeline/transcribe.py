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


def get_model(model_size: str = "small", on_loading=None) -> WhisperModel:
	global _model
	if _model is None:
		# Whether this downloads (first run) or loads from an existing cache
		# (every run after) isn't worth telling apart here: either way it's a
		# real pause the "transcribing speech" stage can't otherwise explain,
		# and this stays honest in both cases rather than guessing which one
		# is happening.
		if on_loading is not None:
			on_loading("loading the speech model (downloads once, the first time)")
		_model = WhisperModel(model_size, device="cpu", compute_type="int8")
	return _model


def transcribe(
	wav_path: str, model_size: str = "small", progress=None, on_segment=None, on_loading=None
) -> list[TranscribedSegment]:
	"""Transcribe with word timings.

	`on_segment(segment, duration)` fires per segment as it is produced, which
	is what lets the UI show the transcript arriving rather than only a bar
	moving -- segments are yielded lazily, so there is real output to show
	minutes before the pass finishes. `on_loading(message)` fires once, only
	if the model isn't already loaded in this process.
	"""
	model = get_model(model_size, on_loading)
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

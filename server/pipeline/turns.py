from dataclasses import dataclass

from .diarize import SpeakerSegment
from .transcribe import TranscribedSegment


@dataclass
class Turn:
	speaker: int
	start: float
	end: float
	text: str


def _speaker_at(t: float, speaker_segments: list[SpeakerSegment]) -> int:
	for seg in speaker_segments:
		if seg.start <= t <= seg.end:
			return seg.speaker
	if not speaker_segments:
		return 0
	return min(speaker_segments, key=lambda s: min(abs(s.start - t), abs(s.end - t))).speaker


def build_turns(
	segments: list[TranscribedSegment],
	speaker_segments: list[SpeakerSegment],
	max_gap: float = 2.0,
) -> list[Turn]:
	"""Merge word-level, speaker-tagged output into dialogue turns.

	A turn breaks on a speaker change, or on a pause longer than max_gap even
	from the same speaker (keeps very long monologues readable in the UI).
	"""
	turns: list[Turn] = []
	for seg in segments:
		if seg.words:
			for word in seg.words:
				mid = (word.start + word.end) / 2
				speaker = _speaker_at(mid, speaker_segments)
				if turns and turns[-1].speaker == speaker and word.start - turns[-1].end <= max_gap:
					turns[-1] = Turn(
						speaker=speaker,
						start=turns[-1].start,
						end=word.end,
						text=f"{turns[-1].text} {word.text}".strip(),
					)
				else:
					turns.append(Turn(speaker=speaker, start=word.start, end=word.end, text=word.text))
		else:
			mid = (seg.start + seg.end) / 2
			speaker = _speaker_at(mid, speaker_segments)
			turns.append(Turn(speaker=speaker, start=seg.start, end=seg.end, text=seg.text))
	return turns

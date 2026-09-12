from dataclasses import dataclass
from pathlib import Path

import pysubs2

from .transcribe import Word

# Subtitle line-length guideline (broadcast captioning conventions land around
# 32-42 chars/line for a single line at this font size). A long, uninterrupted
# monologue would otherwise become one giant cue with no natural break.
MAX_LINE_CHARS = 42
# Cap how long a single cue sits on screen even if the line is short -- reading
# speed, not just length, bounds a caption's welcome.
MAX_CUE_DURATION = 3.5
# A pause this long between words reads as a new thought; breaking the cue
# there instead of mid-flow matches how captions are actually authored.
BREAK_ON_PAUSE = 0.6

FONT_NAME = "Arial"


@dataclass
class CaptionCue:
	start: float
	end: float
	text: str


def _clean(text: str) -> str:
	# `{` / `}` are ASS override-block delimiters; strip them so stray
	# punctuation in a transcript can't be read as a formatting tag.
	return text.replace("{", "").replace("}", "").strip()


def build_caption_cues(
	words: list[Word],
	max_line_chars: int = MAX_LINE_CHARS,
	max_cue_duration: float = MAX_CUE_DURATION,
	break_on_pause: float = BREAK_ON_PAUSE,
) -> list[CaptionCue]:
	"""Group word-level timestamps into readable caption cues.

	Using word timestamps (rather than the coarser per-turn or per-segment
	timing) is the whole point -- it lets a cue start and end exactly when
	speech does, instead of inheriting a turn's boundaries which can run many
	seconds past the words that justify a caption being on screen.
	"""
	cues: list[CaptionCue] = []
	current: list[Word] = []

	def flush() -> None:
		if not current:
			return
		text = _clean(" ".join(w.text for w in current))
		if text:
			cues.append(CaptionCue(start=current[0].start, end=current[-1].end, text=text))
		current.clear()

	for word in words:
		text = word.text.strip()
		if not text:
			continue

		if current:
			pause = word.start - current[-1].end
			candidate_text = " ".join(w.text for w in [*current, word])
			duration = word.end - current[0].start
			if pause >= break_on_pause or len(candidate_text) > max_line_chars or duration > max_cue_duration:
				flush()

		current.append(word)

	flush()
	return cues


def write_ass(cues: list[CaptionCue], path: Path, frame_w: int, frame_h: int) -> None:
	"""Burn-in caption track sized relative to the export's own frame, so it
	reads the same whether the source is 1080p or 4K."""
	subs = pysubs2.SSAFile()
	subs.info["PlayResX"] = str(frame_w)
	subs.info["PlayResY"] = str(frame_h)

	style = pysubs2.SSAStyle()
	style.fontname = FONT_NAME
	style.fontsize = round(frame_h * 0.045)
	style.bold = True
	style.primarycolor = pysubs2.Color(255, 255, 255)
	style.outlinecolor = pysubs2.Color(0, 0, 0)
	style.borderstyle = 1
	style.outline = max(1, round(frame_h * 0.003))
	style.shadow = 0
	style.alignment = 2  # bottom-centre
	style.marginv = round(frame_h * 0.07)
	subs.styles["Caption"] = style

	for cue in cues:
		subs.events.append(
			pysubs2.SSAEvent(
				start=int(round(cue.start * 1000)),
				end=int(round(cue.end * 1000)),
				text=cue.text,
				style="Caption",
			)
		)

	subs.save(str(path), format_="ass")

"""Tests for turning word-level timestamps into caption cues -- the pure
grouping logic. ASS file writing (write_ass) just delegates to pysubs2, so
it isn't re-tested here."""

from pipeline.captions import build_caption_cues
from pipeline.transcribe import Word


def _word(text: str, start: float, end: float) -> Word:
	return Word(start=start, end=end, text=text)


class TestBuildCaptionCues:
	def test_short_phrase_becomes_one_cue(self):
		words = [_word("hello", 0.0, 0.3), _word("there", 0.3, 0.6)]
		cues = build_caption_cues(words)
		assert len(cues) == 1
		assert cues[0].text == "hello there"
		assert cues[0].start == 0.0
		assert cues[0].end == 0.6

	def test_breaks_on_a_long_pause(self):
		words = [_word("hello", 0.0, 0.3), _word("there", 5.0, 5.3)]
		cues = build_caption_cues(words, break_on_pause=0.6)
		assert len(cues) == 2
		assert cues[0].text == "hello"
		assert cues[1].text == "there"

	def test_breaks_when_line_gets_too_long(self):
		words = [_word(w, i * 0.3, i * 0.3 + 0.2) for i, w in enumerate(["one", "two", "three", "four", "five", "six", "seven", "eight"])]
		cues = build_caption_cues(words, max_line_chars=15)
		assert len(cues) > 1
		for cue in cues:
			assert len(cue.text) <= 15

	def test_breaks_when_cue_duration_exceeds_cap(self):
		words = [_word("word", i * 1.0, i * 1.0 + 0.5) for i in range(10)]
		cues = build_caption_cues(words, max_cue_duration=3.0, max_line_chars=1000)
		assert len(cues) > 1
		for cue in cues:
			assert cue.end - cue.start <= 3.0 + 1e-6

	def test_blank_words_are_skipped(self):
		words = [_word("hello", 0.0, 0.3), _word("  ", 0.3, 0.4), _word("there", 0.4, 0.7)]
		cues = build_caption_cues(words)
		assert len(cues) == 1
		assert cues[0].text == "hello there"

	def test_no_words_gives_no_cues(self):
		assert build_caption_cues([]) == []

	def test_braces_are_stripped_to_avoid_ass_override_tags(self):
		words = [_word("{hi}", 0.0, 0.3)]
		cues = build_caption_cues(words)
		assert cues[0].text == "hi"

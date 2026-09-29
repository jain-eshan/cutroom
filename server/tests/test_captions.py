"""Tests for turning word-level timestamps into caption cues -- the pure
grouping logic. ASS file writing (write_ass) just delegates to pysubs2, so
it isn't re-tested here."""

from pipeline.captions import CaptionCue, build_caption_cues, cues_for_edit, srt_text
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


class TestSubtitleFile:
	def test_cues_move_earlier_by_what_was_cut_before_them(self):
		words = [Word(0.0, 0.5, "Hello"), Word(5.0, 5.5, "again")]
		cues = cues_for_edit(words, [(1.0, 4.0)])
		assert [(c.start, c.end, c.text) for c in cues] == [(0.0, 0.5, "Hello"), (2.0, 2.5, "again")]

	def test_a_cue_that_was_entirely_cut_is_dropped(self):
		words = [Word(0.0, 0.5, "Right"), Word(2.0, 2.3, "um"), Word(4.0, 4.5, "so")]
		cues = cues_for_edit(words, [(1.9, 2.4)])
		assert [c.text for c in cues] == ["Right", "so"]

	def test_srt_numbers_cues_and_uses_comma_milliseconds(self):
		text = srt_text([CaptionCue(1.5, 3.25, "Hi"), CaptionCue(3661.0, 3662.001, "Later")])
		assert text == "1\n00:00:01,500 --> 00:00:03,250\nHi\n\n2\n01:01:01,000 --> 01:01:02,001\nLater\n\n"

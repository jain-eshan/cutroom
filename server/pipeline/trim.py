"""Dead-air and filler-word ranges to cut from an export.

Conservative on purpose, same reasoning as the rest of this pipeline: cutting
something that shouldn't be cut (a real word, a natural pause someone needed)
is a worse failure than leaving in a pause that runs a little long. Both
thresholds below are picked to only catch the unambiguous cases, and a long
pause is trimmed down rather than removed entirely -- a hard cut to total
silence reads as a jump cut; a human editor leaves a short beat.

Not measured against real footage the way framing.py's constants are (see
docs/STATUS.md) -- there's no reference edit to measure a "how long is too
long a pause" cutoff against. Treat these as reasoned defaults to validate
once real footage and real editor feedback exist, not as settled numbers.
"""

from .transcribe import Word


def merge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
	"""Sort and coalesce overlapping or touching ranges into the minimal
	covering set. Shared by dead-air's turn-union step and by combining
	dead-air with filler-word ranges before handing them to the renderer."""
	if not ranges:
		return []
	ordered = sorted(ranges)
	merged = [ordered[0]]
	for start, end in ordered[1:]:
		last_start, last_end = merged[-1]
		if start <= last_end:
			merged[-1] = (last_start, max(last_end, end))
		else:
			merged.append((start, end))
	return merged

# Deliberately narrow: words Whisper tends to transcribe as their own
# standalone disfluency. Excludes words that are *sometimes* filler ("like",
# "so", "actually", "right") -- there's no way to tell filler "like" from
# literal "like" from the word alone, and cutting the wrong one removes real
# meaning instead of dead air.
FILLER_WORDS = {"um", "umm", "uh", "uhh", "uhm", "erm", "er", "hmm", "mhm"}

# A pause shorter than this reads as natural breathing room, not dead air --
# not worth the risk of a cut for.
MIN_SILENCE_TO_TRIM = 1.2  # seconds
# How much of a long pause survives the cut. Trimming to exactly zero is what
# makes an automated cut look automated.
SILENCE_KEEP = 0.35  # seconds
# Small padding kept on either side of a cut filler word, so the cut doesn't
# clip the tail of the sound immediately before or after it.
FILLER_PAD = 0.05  # seconds


def dead_air_ranges(
	turn_bounds: list[tuple[float, float]],
	duration: float,
	min_silence: float = MIN_SILENCE_TO_TRIM,
	keep: float = SILENCE_KEEP,
) -> list[tuple[float, float]]:
	"""Pauses between/around turns longer than `min_silence`, each trimmed
	down to `keep` seconds rather than cut out entirely.

	`turn_bounds` doesn't need to be sorted or non-overlapping -- turns can
	overlap in principle (two people both getting a turn during genuinely
	simultaneous speech), so this treats it as a set of "someone was talking"
	intervals and looks for gaps in their union, not gaps between consecutive
	entries in whatever order they arrived in.
	"""
	if not turn_bounds:
		if duration > min_silence:
			pad = keep / 2
			return [(pad, duration - pad)] if duration - pad > pad else []
		return []

	merged = merge_ranges(turn_bounds)
	gaps: list[tuple[float, float]] = []
	prev_end = 0.0
	for start, end in merged:
		if start > prev_end:
			gaps.append((prev_end, start))
		prev_end = max(prev_end, end)
	if duration > prev_end:
		gaps.append((prev_end, duration))

	ranges = []
	for g0, g1 in gaps:
		if g1 - g0 <= min_silence:
			continue
		pad = keep / 2
		cut_start, cut_end = g0 + pad, g1 - pad
		if cut_end > cut_start:
			ranges.append((cut_start, cut_end))
	return ranges


def filler_word_ranges(words: list[Word], pad: float = FILLER_PAD) -> list[tuple[float, float]]:
	"""Ranges covering each detected filler word, from word-level timestamps
	(the same data captions.py cuts cues from) -- not available from turn
	boundaries alone."""
	ranges = []
	for w in words:
		token = w.text.strip().lower().strip(".,!?-")
		if token in FILLER_WORDS:
			ranges.append((max(0.0, w.start - pad), w.end + pad))
	return ranges


def remap_time(t: float, drop_ranges: list[tuple[float, float]]) -> float:
	"""Where a timestamp on the ORIGINAL (untrimmed) timeline lands once
	`drop_ranges` are cut out of it. Used to keep caption cues in sync when
	captions and trimming are both requested for the same export -- a cue's
	timestamp was computed against the untrimmed source and has to shift left
	by however much was already cut out before it."""
	shift = 0.0
	for d0, d1 in drop_ranges:
		if d1 <= t:
			shift += d1 - d0
		elif d0 < t:
			shift += t - d0
	return t - shift

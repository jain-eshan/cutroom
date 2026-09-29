"""What an export cuts out, and where times land once it has.

The cuts themselves -- long pauses and standalone filler words -- are worked
out in the editor (`src/features/timeline/cuts.ts`), where they are shown on
the timeline, skipped in the preview and can be put back one by one. The
export is handed that exact list and cuts nothing else, so what renders is
what was seen. This module only checks the list and keeps timings (captions,
subtitle files) in step with it.
"""


def merge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
	"""Sort and coalesce overlapping or touching ranges into the minimal
	covering set."""
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


class BadCuts(ValueError):
	"""The cut list isn't a list of {start, end} spans in seconds."""


def parse_cuts(cuts: object, duration: float) -> list[tuple[float, float]]:
	"""The editor's cut list, checked rather than trusted: clipped to the
	recording, empty spans dropped, and overlaps merged, since the renderer
	needs sorted, disjoint ranges. Anything that isn't a span is refused
	outright -- guessing at a malformed cut would silently remove the wrong
	part of someone's episode."""
	if not isinstance(cuts, list):
		raise BadCuts("cuts must be a list")
	spans = []
	for cut in cuts:
		try:
			start, end = float(cut["start"]), float(cut["end"])
		except (TypeError, KeyError, ValueError) as err:
			raise BadCuts(f"not a cut: {cut!r}") from err
		start, end = max(0.0, start), min(duration, end)
		if end > start:
			spans.append((start, end))
	return merge_ranges(spans)


def keep_ranges(drop_ranges: list[tuple[float, float]], duration: float) -> list[tuple[float, float]]:
	"""The parts of [0, duration] that survive `drop_ranges` (sorted and
	disjoint, as `parse_cuts` returns them)."""
	kept = []
	cursor = 0.0
	for start, end in drop_ranges:
		if start > cursor:
			kept.append((cursor, start))
		cursor = max(cursor, end)
	if cursor < duration:
		kept.append((cursor, duration))
	return kept


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

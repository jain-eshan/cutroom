"""Pair voices to faces, using each signal to catch the other's mistakes.

Diarisation knows when a voice talks but not whose body it came from. Lip-sync
knows which mouth is moving but has no notion of identity across time. Matching
them is what turns both into "this person said this".

The pairing also exposes each side's characteristic failure, which neither can
see alone:

  one voice spread across two faces   the diariser merged two people
  two voices landing on one face      the diariser split one person in half

Both happened on the real episode, which is why this is a cross-check rather
than a lookup.
"""

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

from .diarize import SpeakerSegment

# A voice whose seconds land on one face this much of the time is taken at its
# word, even if that face already belongs to another voice -- that collision is
# the over-split signal, not an error to be resolved away.
DOMINANT_SHARE = 0.6

# Below this, there is not enough co-occurrence to claim anything. A voice that
# only ever speaks off-camera, or over a face the model never scores, is left
# unmatched for the human to answer rather than guessed at.
MIN_JUDGED_SECONDS = 3


@dataclass
class VoiceFaceMatch:
	speaker: int
	person_id: int | None
	confidence: float
	judged_seconds: int


@dataclass
class Note:
	"""Something worth the editor's attention, as data rather than a sentence.

	The wording is the UI's job because only the UI knows what these people are
	called -- the editor names them on the same screen. A note that says
	"person 2" while the screen says "Priya" is worse than no note.
	"""

	kind: str  # over_split | voice_unmatched | person_unmatched | low_confidence
	speakers: list[int] = field(default_factory=list)
	person_ids: list[int] = field(default_factory=list)


@dataclass
class Fusion:
	matches: list[VoiceFaceMatch]
	notes: list[Note] = field(default_factory=list)

	def speaker_to_person(self) -> dict[int, int]:
		return {m.speaker: m.person_id for m in self.matches if m.person_id is not None}


def cooccurrence(
	segments: list[SpeakerSegment], speaking: np.ndarray, person_ids: list[int]
) -> tuple[list[int], np.ndarray]:
	"""Seconds where voice v is heard and face p is the one visibly talking.

	Second-by-second rather than by turn: a turn can span a stretch where the
	camera subject changes, and the whole point is to catch a turn that belongs
	to two different people.
	"""
	voices = sorted({s.speaker for s in segments})
	counts = np.zeros((len(voices), len(person_ids)), dtype=int)
	voice_index = {v: i for i, v in enumerate(voices)}

	for second, face in enumerate(speaking):
		if face < 0:
			continue
		middle = second + 0.5
		heard = {s.speaker for s in segments if s.start <= middle < s.end}
		# Ambiguous while two people talk at once -- no evidence about either.
		if len(heard) != 1:
			continue
		counts[voice_index[heard.pop()], face] += 1

	return voices, counts


def fuse(
	segments: list[SpeakerSegment], speaking: np.ndarray, person_ids: list[int]
) -> Fusion:
	"""Match each voice to a face."""
	voices, counts = cooccurrence(segments, speaking, person_ids)
	if not voices or not person_ids:
		return Fusion(matches=[])

	# Hungarian first: the usual case really is one voice per person, and a
	# globally optimal assignment beats per-voice greed when two voices both
	# lean towards the same face for want of a better option.
	rows, cols = linear_sum_assignment(-counts)
	assigned = {int(r): int(c) for r, c in zip(rows, cols)}

	matches: list[VoiceFaceMatch] = []
	for i, voice in enumerate(voices):
		judged = int(counts[i].sum())
		if judged < MIN_JUDGED_SECONDS:
			matches.append(VoiceFaceMatch(voice, None, 0.0, judged))
			continue

		dominant = int(counts[i].argmax())
		share = counts[i][dominant] / judged
		# Dominance wins over the 1:1 assignment. Forcing this voice somewhere
		# else to keep the matching one-to-one is precisely how an over-split
		# speaker gets hidden.
		face = dominant if share >= DOMINANT_SHARE else assigned.get(i, dominant)
		confidence = counts[i][face] / judged
		matches.append(VoiceFaceMatch(voice, person_ids[face], confidence, judged))

	return Fusion(matches=matches, notes=_notes(matches, voices, counts, person_ids))


def _notes(
	matches: list[VoiceFaceMatch], voices: list[int], counts: np.ndarray, person_ids: list[int]
) -> list[Note]:
	notes: list[Note] = []

	by_person: dict[int, list[int]] = {}
	for match in matches:
		if match.person_id is not None:
			by_person.setdefault(match.person_id, []).append(match.speaker)
	for person_id, speakers in sorted(by_person.items()):
		if len(speakers) > 1:
			notes.append(Note(kind="over_split", speakers=speakers, person_ids=[person_id]))

	for i, match in enumerate(matches):
		if match.person_id is None:
			notes.append(Note(kind="voice_unmatched", speakers=[match.speaker]))
		elif 0 < match.confidence < DOMINANT_SHARE and len(counts[i]) > 1 and sorted(counts[i])[-2]:
			notes.append(
				Note(kind="low_confidence", speakers=[match.speaker], person_ids=[match.person_id])
			)

	unmatched = sorted(set(person_ids) - set(by_person))
	if unmatched:
		notes.append(Note(kind="person_unmatched", person_ids=unmatched))

	return notes

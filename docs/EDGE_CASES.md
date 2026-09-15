# Edge cases

This is everything a real recording can throw at the automatic edit. For each
case it says what Cutroom does today and what it should do. It was written
on 2026-09-15, after the founder watched a 47-minute, four-person episode and
saw the edit cut to people who only said a word or two.

Use it three ways:

- Before building a framing feature, find its cases here and turn each one
  into a test.
- When a host reports a bad cut, find the case (or add it) before changing
  code.
- When a case is decided or built, update its **Today** line rather than
  deleting it.

Every **Today** line was checked against the code on 2026-09-15.
Priorities: **P1** shows up in most multi-person episodes, **P2** on some
shows, **P3** is rare or out of scope for now.

## 1. What goes wrong today, in one example

All automatic framing comes from one function, `suggestRegions` in
`src/features/timeline/regions.ts`. The renderer (`render.py`) only carries
out the shots the editor holds, so every rule in this document lives in that
function.

Its rules are simple:

- Every line in the transcript gets a close-up of whoever said it.
- When two or more people talk over each other for at least 1 second
  (`MIN_OVERLAP_SECONDS`), everyone involved goes on screen together.
- Anything between lines is wide.

Nothing looks at how long a line is, who was talking first, or how many cuts
all of this adds up to.

This is the real output of today's code on a made-up conversation, where A
and B talk and C chips in:

| What was said | Shot it gets today |
|---|---|
| A talks, 0:00–0:20 | Close on A |
| *0.3 s pause* | **Wide** |
| C says "right", 0:20.3–0:20.9 | **Close on C** |
| *0.1 s pause* | **Wide** |
| A carries on, 0:21–0:40 | Close on A |
| *0.5 s pause* | **Wide** |
| B answers, 0:40.5–0:55 | Close on B |
| B and C overlap, 0:55–0:57 | B and C side by side. B is on the left because B's speaker number is lower, not because of who started first |
| B alone, 0:57–1:00 | Close on B |
| *2.5 s pause* | **Wide** |
| B again, 1:02.5–1:10 | Close on B |

That's four cuts in under a second around C's one word, and a flash of the
wide shot at every hand-off. It's the problem the founder saw.

## 2. The rules Cutroom should follow

These are proposals, not decisions. Every number is a starting point to check
against professional edits, the same way `framing.py`'s crop sizes were
measured instead of guessed.

1. **Someone holds the floor.** Whoever is already talking keeps the shot
   until they stop. Another voice doesn't take it just by making a sound.
2. **Short lines don't cut.** A line under about 1.5 s, or of three words or
   fewer, from someone who doesn't hold the floor stays off screen. That
   covers "yeah", "right", a laugh, a one-word answer. The line still shows in
   the transcript.
3. **Overlap favours whoever started first.** When two people talk at once,
   the floor holder stays on screen. The other person joins the shot only if
   the overlap lasts about 2 s and they're saying words, not laughing or
   murmuring. In a layout with one large pane, the floor holder gets it.
4. **A takeover is one cut.** If the interrupter keeps going and the first
   speaker stops, cut once, straight to the new speaker. Don't pass through a
   two-person shot for the couple of seconds they overlapped.
5. **No shot shorter than about 2 s.** Anything shorter is absorbed into the
   shot around it. In a fast exchange where every line is shorter than that,
   the whole exchange becomes one shot of everyone in it, instead of a cut
   per line.
6. **Pauses don't go wide.** A shot runs until the next speaker starts. Only
   a long silence (about 3 s or more) cuts to wide.
7. **Side-by-side panes follow the seating.** Whoever sits on the left of the
   frame is in the left pane, every time, so people don't swap sides between
   shots.
8. **The editor chooses how much framing there is.** Each episode gets a
   style:
   - *Wide only*: no automatic framing at all.
   - *Gentle*: close-ups only for longer stretches, and wide through quick
     exchanges.
   - *Dynamic*: all of the rules above.

   Changing the style never touches shots the editor made.

All of these rules work from the word timings Cutroom already has. None of
them needs a new model.

## 3. The catalogue

### A. Conversation: who is talking

**A1. Murmurs under someone's line** ("mhm", "yeah" while A talks), overlapping for under a second. P1.
- Today: ignored for framing, because overlaps under 1 s are dropped.
  Whisper usually doesn't write the word either. This works.
- Should: stay as it is.

**A2. A short line in someone else's pause** (A talks, C says "right", A carries on). P1. *This is the founder's case.*
- Today: C gets a close-up, with a wide flash on either side (section 1).
- Should: hold on A (rules 1, 2 and 5).

**A3. A third person's one-liner during a two-person exchange.** P1.
- Today: a close-up flash of the third person, or all three on screen if
  the line overlaps for 1 s or more.
- Should: stay on the two people talking (rule 2). Show the third person only
  if the line is long or they keep talking.

**A4. An interruption.** A is talking and B cuts in. P1.
- Today: an overlap of 1 s or more puts both on screen, ordered by speaker
  number. Each word said during the overlap goes to whichever speaker segment
  was found first (`_speaker_at` in `turns.py`), and Whisper mostly writes
  only the louder voice.
- Should: A keeps the shot if the interruption is short. If it goes on, show
  both, with A in the large pane (rule 3) and the panes in seating order
  (rule 7).

**A5. A takeover.** B interrupts and A gives up. P1.
- Today: both on screen for the overlap, then close on B. That's two cuts.
- Should: one cut, to B (rule 4). *Decision needed:* cut where B starts, or
  where A stops. Editors usually cut on the new speaker's first word, but that
  shows B before A has finished.

**A6. Three or four people talking at once** (laughing, arguing). P2.
- Today: everyone active goes on screen. With three or more, the layout has
  one large pane, and it goes to the lowest speaker number.
- Should: usually the wide shot. Everyone is already in it, and a grid of
  crops of the same room looks busy. Otherwise a group layout with the floor
  holder large. See C3.

**A7. Rapid back-and-forth** (lines of 1–3 s alternating). P1.
- Today: a cut on every line.
- Should: one shot of both people for the whole exchange, whenever cuts would
  come faster than rule 5 allows.

**A8. Laughter and other sounds that aren't words.** P2.
- Today: the speaker detection can count laughter as speech. No words get
  written, so there's no transcript line, but it can still create an overlap
  and put someone on screen for laughing.
- Should: an overlap counts only when the second person says words in it
  (rule 3). A laugh can become a reaction shot later (A10).

**A9. A long monologue** (several minutes from one person). P2.
- Today: one close-up for the whole stretch, broken by a wide shot wherever
  they pause for more than 2 s (`build_turns` starts a new line there).
- Should: no wide breaks for pauses (rule 6). Adding variety, like a wide
  shot or a listener's reaction every 20–40 s, is the deferred "Vary shot
  length" item in [FEATURES.md](FEATURES.md).

**A10. Reaction shots.** A listener laughs, nods or pulls a face. P3.
- Today: listeners are never shown unless they speak.
- Should: later, and optional. Lip-sync scores and face movement could find
  these moments. Not for the first version.

**A11. Pauses between speakers.** P1.
- Today: any gap between two lines renders wide, even a 0.1 s one
  (section 1).
- Should: the outgoing shot holds until the next person starts (rule 6).

**A12. Cuts landing slightly early or late.** P2.
- Today: speaker boundaries come from the speaker detection and can be off by
  a few tenths of a second, so a cut can land mid-word.
- Should: move automatic cuts onto word boundaries, just before the new
  speaker's first word. The editor's snapping already does this for manual
  drags.

**A13. The loud voice wins the transcript.** P3.
- Today: when people talk over each other, Whisper writes the dominant voice.
  The quieter person's words go missing or are credited to the wrong person.
- Should: flag long overlaps for review. The "TALKING OVER" chip in the
  transcript already does this.

### B. Identity: which voice is which face

**B1. Several people detected as one voice** (four people heard as two). P1, measured.
- Today: on the 53-minute episode, four people came out as two speakers
  across 34 lines, so the framing follows the wrong person for whole
  stretches. A face that never gets a voice is flagged on the cast screen,
  which is often the sign of this. But a merged voice can't be split.
- Should: use lip-sync moment by moment, not once per voice. When a merged
  voice's mouth movement is on a different face, frame that face.

**B2. One person detected as two voices.** P2.
- Today: caught. The pairing step (`fuse.py`) notices two voices on one face
  and maps both to the same person.
- Should: stay as it is.

**B3. A voice with no face** (a producer behind the camera, a phone-in guest). P2.
- Today: their lines go wide. The editor can name the voice.
- Should: *Decision needed:* hold the current shot while they talk, or go
  wide. Holding usually reads better, because cutting to wide for an
  off-camera question looks like a mistake.

**B4. A face with no voice** (a silent guest, crew, a face on a poster or TV). P2.
- Today: faces seen only briefly are filtered out (`MIN_PRESENCE`). A poster
  is in view the whole time, though, so it survives. It never gets a shot of
  its own, because it never speaks.
- Should: a "not part of the show" option on the cast screen. Someone who
  never spoke should never be put in a group shot.

**B5. A remote guest on a laptop or monitor in the frame.** P3.
- Today: treated as a face. The close-up is usually small and soft.
- Should: allowed, but flagged when the crop hits the enlargement limit
  (B10).

**B6. Look-alikes, or the same person after changing glasses or a hat.** P3.
- Today: faces are told apart by comparing each face's recognition
  fingerprint. On real footage the four participants were 0.66–0.91 apart,
  well clear of the 0.4 cut-off, but these particular cases haven't been
  tested.
- Should: the cast screen's controls cover it. Add a test clip if a host
  reports one.

**B7. Someone leaves the frame, stands up, or swaps seats.** P2.
- Today: the crop uses the nearest sighting of the face, however old, so a
  close-up can show an empty chair. This is item 6b in
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
- Should: know whether each person is visible right now. If they aren't,
  fall back to wide or to the other people.

**B8. People move during a long shot** (leaning, swivelling). P2.
- Today: each shot's crop is fixed at its start, in the preview and the
  export alike, so a face can drift to the edge during a long close-up.
- Should: re-aim the crop within a shot, smoothly, and only when the face
  nears the edge. No constant jitter.

**B9. Faces the detector loses** (profile, hands on face, masks, sunglasses, dim light). P3.
- Today: there are gaps in the sightings, and the nearest sighting fills
  them. That's usually fine for someone sitting still.
- Should: covered by B7.

**B10. People small in the frame** (a wide room, five or six guests). P2.
- Today: `framing.py` won't enlarge a crop past 2.6×, so the close-up comes
  out looser and can include the people next to them.
- Should: if the loosest allowed crop is nearly the whole frame anyway, stay
  wide instead of zooming by a pointless amount.

**B11. The wrong face, matched confidently** (lip-sync fooled by chewing, nodding or a hand). P2.
- Today: the cast screen shows uncertain matches. A confident wrong match
  gets through.
- Should: fixed with the per-shot person picker (C4), plus the
  moment-by-moment matching in B1.

### C. Layouts: what's on screen

**C1. Pane order doesn't follow the seating.** P1.
- Today: automatic side-by-side shots order people by speaker number, and
  "+ Both on screen" puts the selected line's speaker first. People can swap
  sides from one shot to the next.
- Should: order panes by where people sit in the frame (rule 7).

**C2. Who gets the large pane with three people.** P2.
- Today: the first person in the shot's list, which is the lowest speaker
  number.
- Should: the floor holder. Moving someone into the large pane is a cut, so
  rule 5 applies to it too.

**C3. Four or more people.** P2. *Already an open question in DESIGN_SYSTEM.md.*
- Today: there's no limit. With four people, one large pane sits beside
  three small ones stacked on top of each other, and with five or more the
  small panes get tiny. The design handoff limits a shot to three people.
- Should: *Decision needed:* a 2×2 grid, one large pane, or wide once
  everyone is involved. Recommendation: wide when everyone talks at once, and
  a 2×2 grid only when the editor asks for it.

**C4. The editor wants to choose who's on screen.** P1.
- Today: "+ Both on screen" always picks the selected line's speaker plus
  whoever spoke nearest in time. There's no way to pick the people, or more
  than two, even though the export can show any number.
- Should: a person picker on the selected shot. It belongs in the shot
  settings panel planned under "Editing basics: precision" in
  [STATUS.md](STATUS.md).

**C5. No automatic framing at all.** P1, and cheap.
- Today: the only way is to delete every shot one at a time, and "Reset to
  suggested" brings them all back.
- Should: a *Wide only* style (rule 8), plus a "Clear all shots" action.

**C6. Automatic framing for only part of an episode** (wide for the intro, framed for the interview). P3.
- Today: possible by hand.
- Should: editing shots covers it. Build styles per section only if hosts
  ask.

**C7. Portrait recordings.** P2.
- Today: the output keeps the source's shape, so two people side by side in
  a portrait frame become thin slivers.
- Should: stack panes top and bottom when the frame is taller than it is
  wide. The same logic serves 9:16 clips later.

**C8. The preview shows names that the export doesn't.** P3.
- Today: the preview labels each pane with a name. The exported video has no
  names on screen.
- Should: fine as an editing aid. If on-screen name captions are ever built,
  they go here.

### D. Editing after the automatic pass

**D1. Fixing the cast after editing** (renaming a voice, reassigning a face). P2.
- Today: there's no way back from the editor to the cast screen. Shots are
  suggested once, when the cast is confirmed.
- Should: the editor can reopen the cast screen. Afterwards, the automatic
  shots are suggested again and the editor's own shots are kept.

**D2. Changing the framing style after editing.** P1, once styles exist.
- Should: only shots marked "suggested" are replaced. Shots marked "yours"
  always survive.

**D3. Trim dead air shrinks shots, and the preview doesn't show it.** P2.
- Today: trimming only happens at export. The preview plays the untrimmed
  episode, so a shot that trimming cuts down to a sliver looks fine in the
  editor and flashes in the video.
- Should: apply rule 5 after trimming, and eventually preview the trimmed
  version.

**D4. Cutting words out of the transcript** (text-based editing, not built yet). P2 later.
- Should: same as D3. Cuts can leave slivers, so the shot rules run again
  after cutting.

**D5. Undo history resets after the publish screen.** P3.
- Today: known, and noted in STATUS.md.

### E. The recording itself

**E1. Audio only.**
- Today: no faces are found, a screen says so, and the whole episode stays
  wide.

**E2. An already-edited video** (switches between cameras, or has cuts in it). P2, and probably common.
- Today: framing assumes one fixed camera. After a camera switch, the stored
  face positions are wrong and crops land on the wrong spot.
- Should: detect cuts in the video during processing. Then either turn off
  automatic framing and explain why, or treat each camera angle separately.
  At the very least, warn.

**E3. The camera moves or zooms** (handheld, or an operator zooming). P3.
- Today: faces are sighted about once a second and crops are fixed per shot,
  so a zoom in the middle of a shot throws the framing off.
- Should: covered by B8, plus E2's cut detection.

**E4. Phone recordings: HDR colour and rotated files.** P2.
- Today: a 53-minute 1080p episode exported frame-exact (95,436 frames in
  and out). HDR colour and files with rotation information haven't been
  checked.
- Should: add one of each to the test footage before the host test.

**E5. Very long or very large files** (2+ hours, 4K at 60fps). P2.
- Today: the 53-minute 1080p episode needed 4.5 GB of memory to process.
  Nothing larger has been run.
- Should: run one before release. Batched processing is on the roadmap for
  this.

**E6. Inserted material** (screen shares, slides, b-roll, ads, music intros). P3.
- Today: there are no faces during these, so they stay wide. That's fine
  unless a face appears in the inserted material.
- Should: covered by E2's cut detection.

**E7. Languages other than English, or switching language mid-episode.** P2.
- Today: no language is set, so Whisper guesses it once, from the start of
  the recording, and a later switch isn't noticed. The speaker detection
  doesn't depend on language. Filler-word trimming only knows English
  (`FILLER_WORDS` in `trim.py`).
- Should: test one non-English episode and one mixed-language episode.
  Filler trimming should say it's English-only, or switch itself off for
  other languages.

**E8. Audio recorded separately** (a field recorder synced later). P3.
- Out of scope for a single-camera tool.

## 4. Decisions needed

1. **What counts as a short line:** under a length, under a word count, or
   both. Recommendation: both, since "No." and "Absolutely not, that's wrong"
   aren't the same kind of line.
2. **Where a takeover cuts:** where the new speaker starts, or where the old
   one stops (A5).
3. **Off-camera voices:** hold the current shot or go wide (B3).
   Recommendation: hold.
4. **Four or more people:** a grid, one large pane, or wide (C3).
5. **Default style for a new episode:** Gentle or Dynamic (rule 8).
6. **Reaction shots and shot variety:** in the first version, or later (A9,
   A10). Recommendation: later.

## 5. How to build it

A suggested order. Where it sits on the roadmap is a separate decision.

1. **Shot rules in `suggestRegions`**: rules 1–7, covering A2, A3, A4, A5,
   A7, A8, A11, A12 and C1. Each case becomes a test made of invented lines,
   like the table in section 1, run with `npm test`. One snag first:
   `regions.ts` imports through the `@/` shortcut, which Node's test runner
   can't follow. The check in section 1 worked from a copy of the file.
2. **Framing style**, including Wide only (C5, D2).
3. **Choosing who's on screen**: the person picker (C4), in the shot
   settings panel.
4. **Knowing who's visible, and re-aiming crops** (B7, B8). This is the
   existing item 6b.
5. **Three or more people** (C2, C3, A6), once decision 4 is made.
6. **Detecting cuts in already-edited videos** (E2).

To tell whether the rules work, measure real episodes before and after:
cuts per minute, shots under 2 s, and wide flashes under a second. Then
compare against a professional edit of a similar show, the way `framing.py`'s
numbers were measured.

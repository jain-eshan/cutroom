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
- ~~Today: C gets a close-up, with a wide flash on either side (section 1).~~
  **Done, 2026-09-17.** `regions.ts`'s `earnsItsOwnShot`/`floorHeldAcross`:
  a line sandwiched by the same other speaker, both gaps under 3s and
  shorter than that speaker's resumption, holds on A. Measured on the exact
  table in section 1: 6 shots / 9 cuts (including this one) down to 3
  shots / 3 cuts. See STATUS.md's 2026-09-17 entry.
- Should: hold on A (rules 1, 2 and 5).

**A3. A third person's one-liner during a two-person exchange.** P1.
- Today: a close-up flash of the third person, or all three on screen if
  the line overlaps for 1 s or more.
- Should: stay on the two people talking (rule 2). Show the third person only
  if the line is long or they keep talking.

**A4. An interruption.** A is talking and B cuts in. P1.
- **Partly done, 2026-09-17.** A keeps the shot if the interruption is short
  (A2's floor-holding) or if it's genuine but doesn't earn its own shot --
  the overlap still shows both, ordered by seating (rule 7, C1). Not done:
  the large/small pane split -- 2-person layouts are symmetric today
  (`DUO_SPLIT_MAX` in `EditorView.tsx`); only 3+ layouts have a large pane
  (`SPEAKER_FOCUS_MAIN_FRACTION`), so "A in the large pane" for a 2-person
  overlap has nowhere to go without a layout change.
- Should: A keeps the shot if the interruption is short. If it goes on, show
  both, with A in the large pane (rule 3) and the panes in seating order
  (rule 7).

**A5. A takeover.** B interrupts and A gives up. P1.
- ~~Today: both on screen for the overlap, then close on B. That's two cuts.~~
  **Done, 2026-09-17.** `regions.ts`'s `takeoverAt`: a two-turn handoff where
  the incoming turn earns a shot on its own is one cut, at the overlap
  detector's own start time, not the composite. Decided: cuts on the new
  speaker's first word (`window.start`), not where the old one stops.
  Verified against a real case in the fixture data (a 0.4s overlap at a
  genuine handoff), live in the browser, both classified correctly under
  Dynamic (takeover) and Gentle (not, since the incoming turn doesn't clear
  its higher cutoff).
- Should: one cut, to B (rule 4). Decided: the new speaker's first word.

**A6. Three or four people talking at once** (laughing, arguing). P2.
- Today: everyone active goes on screen. With three or more, the layout has
  one large pane, and it goes to the lowest speaker number.
- Should: usually the wide shot. Everyone is already in it, and a grid of
  crops of the same room looks busy. Otherwise a group layout with the floor
  holder large. See C3.

**A7. Rapid back-and-forth** (lines of 1–3 s alternating). P1.
- **Improved, 2026-09-17, not built as prescribed.** No more cut on every
  line: each short line either fails the length cutoff outright or is
  floor-held (A2's mechanism can trigger both directions in a strict
  alternation), so a genuinely rapid exchange renders wide throughout --
  confirmed directly: a 5-line alternating exchange, none of them singly
  earning a shot, produces zero regions rather than five. That reaches the
  same outcome A7 wants (no rapid-fire cutting) by a different path than
  prescribed: staying wide rather than a synthesised both-on-screen shot for
  the exchange. No code builds the latter.
- Should: one shot of both people for the whole exchange, whenever cuts would
  come faster than rule 5 allows.

**A8. Laughter and other sounds that aren't words.** P2.
- Today: the speaker detection can count laughter as speech. No words get
  written, so there's no transcript line, but it can still create an overlap
  and put someone on screen for laughing.
- Should: an overlap counts only when the second person says words in it
  (rule 3). A laugh can become a reaction shot later (A10).

**A9. A long monologue** (several minutes from one person). P2.
- **Improved, 2026-09-17, not fully.** `WIDE_AFTER_SILENCE_S` (rule 6) holds
  through any pause under 3s, including the 2-3s band where `build_turns`
  already split the monologue into two turns -- narrower than A9's literal
  "no wide breaks for pauses", since a pause of 3s or more still goes wide.
- Should: no wide breaks for pauses (rule 6). Adding variety, like a wide
  shot or a listener's reaction every 20–40 s, is the deferred "Vary shot
  length" item in [FEATURES.md](FEATURES.md).

**A10. Reaction shots.** A listener laughs, nods or pulls a face. P3.
- Today: listeners are never shown unless they speak.
- Should: later, and optional. Lip-sync scores and face movement could find
  these moments. Not for the first version.

**A11. Pauses between speakers.** P1.
- ~~Today: any gap between two lines renders wide, even a 0.1 s one
  (section 1).~~ **Done, 2026-09-17.** `holdUntil` in `regions.ts`: a shot
  holds until the next one starts, or a real silence (3s+), whichever comes
  first. Measured on section 1's table: the 0.3s and 0.5s gaps that used to
  flash wide no longer do.
- Should: the outgoing shot holds until the next person starts (rule 6).

**A12. Cuts landing slightly early or late.** P2.
- Today: speaker boundaries come from the speaker detection and can be off by
  a few tenths of a second, so a cut can land mid-word. Not addressed in
  general -- A5's takeover fix uses the overlap detector's own timestamp
  instead of the transcribed turn boundary, but only for that specific
  handoff shape, not automatic cuts generally.
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
- **Decided and done, 2026-09-18: hold.** Cutting wide for an off-camera
  question looks like a mistake. Turned out to need no new code: a speaker
  with no `personId` was already excluded from `shots` in `suggestRegions`
  (`regions.ts`), and rule 6's existing `holdUntil` already carries the
  current shot across any turn that doesn't earn its own -- off-camera or
  not -- unless a real silence (rule 6's own threshold) intervenes. This
  "Today" line was stale: it described the pre-rule-6 behaviour. Pinned with
  three tests (`regions.test.ts`): holds through an off-camera line with no
  gap, still cedes to a genuine silence around one, and stays wide when an
  off-camera voice opens the episode with nothing yet to hold. The editor
  can still name the voice, unchanged.

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
- ~~Today: automatic side-by-side shots order people by speaker number, and
  "+ Both on screen" puts the selected line's speaker first. People can swap
  sides from one shot to the next.~~ **Done, 2026-09-17.** `orderBySeat` in
  `regions.ts` sorts by each person's median keyframe centre-x, applied to
  both the automatic overlap-derived splits and "+ Both on screen". A person
  with no keyframes sorts last rather than jumping ahead of a known
  position. Tested against a case built specifically to discriminate this
  from the old id-based order, not one that happens to agree with it.
- Should: order panes by where people sit in the frame (rule 7).

**C2. Who gets the large pane with three people.** P2.
- Today: the first person in the shot's list, which is the lowest speaker
  number.
- Should: the floor holder. Moving someone into the large pane is a cut, so
  rule 5 applies to it too.

**C3. Four or more people.** P2. *Already an open question in DESIGN_SYSTEM.md.*
- **Decided and done (the suggestion half), 2026-09-18:** wide once everyone
  active is involved. `suggestRegions` (`regions.ts`) no longer proposes a
  composite for a genuine overlap past `MAX_SUGGESTED_COMPOSITE` (3) people
  -- the window still punches a hole in whichever close-up would otherwise
  cover it (so the moment genuinely goes wide, rather than silently reading
  as whoever's shot the boundary happened to land on), it just isn't
  suggested as a composite of its own. An editor can still add a
  four-or-more "+ Both on screen" by hand -- C4's picker doesn't exist yet,
  so today that means editing a region's `personIds` directly, or a future
  C4 picker -- and `render.py`'s existing speaker-focus layout (one large
  pane, everyone else stacked down the side) still renders it; **the 2x2
  grid mentioned as an alternative when the founder made this decision is
  not built**, and isn't needed unless a real four-person show actually asks
  an editor to hand-compose a four-way shot. Pinned with four tests
  (`regions.test.ts`): three people still gets the composite, four goes
  genuinely wide (not silently absorbed into a neighbour), and a manual
  four-person addition still works, unaffected -- this only governs what's
  *suggested*.

**C4. The editor wants to choose who's on screen.** P1.
- Today: "+ Both on screen" always picks the selected line's speaker plus
  whoever spoke nearest in time. There's no way to pick the people, or more
  than two, even though the export can show any number.
- Should: a person picker on the selected shot. It belongs in the shot
  settings panel planned under "Editing basics: precision" in
  [STATUS.md](STATUS.md).

**C5. No automatic framing at all.** P1, and cheap.
- **Mostly done, 2026-09-17.** A *Wide only* framing style exists
  (`suggestRegions` in `regions.ts` returns nothing for it, not even a
  both-on-screen composite for a genuine overlap). Not built: a distinct
  "Clear all shots" action -- switching to Wide only only clears
  `"suggested"` shots (`reconcileWithStyle`, by design, see D2); a shot the
  editor made by hand still has to be deleted one at a time, same as before.
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
- **Done, 2026-09-17,** the same day styles were built. `reconcileWithStyle`
  in `regions.ts`: folds every `"user"` region into a fresh suggestion under
  the new style, the same subtract-then-insert `addRegion` already used for
  one region at a time, generalised to every user region at once. Verified
  live: manually framing one line, then switching styles, kept that exact
  shot (confirmed via its own "You set this to..." label) while every other
  line picked up a fresh suggestion under the new style. Deliberately
  different from the pre-existing "Reset to suggested" button, which stays a
  full reset that does discard user shots, on purpose, when the editor
  explicitly asks for it.
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

Five of six decided as of 2026-09-17; the founder decided the remaining two
on 2026-09-18 (off-camera voices, and reaction shots for later) -- see each
item's own case for how it was built. Only C3 (four or more people, also
decided 2026-09-18: wide by default, a grid only on request) remains
unbuilt, tracked in "How to build it" below.

1. ~~**What counts as a short line**~~: **decided.** Both length and content:
   under 4s (Dynamic) or 12s (Gentle), or made only of backchannel words
   ("yeah", "right", "mhm") -- "no" and "yes" excluded, since those are real
   answers. See A2.
2. ~~**Where a takeover cuts**~~: **decided.** The new speaker's first word
   (the overlap detector's own start time). See A5.
3. ~~**Off-camera voices**~~: **decided and done, 2026-09-18.** Hold the
   current shot. See B3.
4. **Four or more people: decided, 2026-09-18.** Wide by default; a 2x2 grid
   only if the editor asks for it. Not yet built -- see C3 and "How to build
   it" below.
5. ~~**Default style for a new episode**~~: **decided.** Gentle. See rule 8.
6. ~~**Reaction shots and shot variety**~~: **decided, 2026-09-18: later.**
   No evidence yet that editors want this, and it adds real complexity to
   the framing rules. See A9/A10.

## 5. How to build it

A suggested order. Where it sits on the roadmap is a separate decision.

1. ~~**Shot rules in `suggestRegions`**~~: **done, 2026-09-17.** Rules 1, 2,
   4, 5, 6 and 7 are built (A2, A5, A11, C1 fully; A4, A7, A9 improved but
   not exactly as prescribed -- see each case). A3, A8, A12 untouched. The
   `@/` import snag this item warned about was fixed the same day (see
   STATUS.md's editing-precision entry) -- `regions.test.ts` imports
   normally now.
2. ~~**Framing style**, including Wide only (C5, D2).~~ **Done, 2026-09-17.**
   Wide only, Gentle, Dynamic; D2's reconcile-not-replace behaviour built
   alongside it, not deferred.
3. **Choosing who's on screen**: the person picker (C4), in the shot
   settings panel. Still open.
4. **Knowing who's visible, and re-aiming crops** (B7, B8). This is the
   existing item 6b. Still open.
5. **Three or more people** (C2, C3, A6). **C3 done, 2026-09-18** (see its
   own case). **C2 (who gets the large pane) and A6 (usually wide for a
   3-4 person moment, otherwise floor-holder-large) are still open** --
   C3's fix only covers four-or-more; a 3-person composite still puts
   whoever's listed first (seat order, since rule 7/C1) in the large pane
   rather than the floor holder.
6. **Detecting cuts in already-edited videos** (E2). Still open.

To tell whether the rules work, measure real episodes before and after:
cuts per minute, shots under 2 s, and wide flashes under a second. Then
compare against a professional edit of a similar show, the way `framing.py`'s
numbers were measured. **Not done yet** -- 2026-09-17's verification used the
section 1 table and fixture data, not a real recording; the founder's own
"We have to improve the video editing a lot" complaint hasn't had a
real-footage retest since these fixes landed.

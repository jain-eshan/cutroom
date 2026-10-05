# What a professional conversation edit is made of, measured, and the spec for Cutroom to match it

Status: **proposal for the founder to review, written 2026-10-05.** Nothing here is
built or adopted. It feeds [PLATFORM_ROADMAP.md](PLATFORM_ROADMAP.md) (the plan for clips,
covers and a Library) and answers the open item in [EDGE_CASES.md](EDGE_CASES.md) section 5:
"compare against a professional edit of a similar show... Not done yet."

The reference is one episode, edited by an agency: a 44-minute, four-person conversation,
2560x1440 at 30 fps. The people on it are described by role (guest, host 1, host 2, host 3)
because this is an open-source repo.

**Founder decisions, 2026-10-05**

1. The source was a single clip, and the closer shots were made by zooming in. This confirms section 3.1.
2. **Professional is the default for every new episode.** An episode saved earlier keeps the style it was saved with. Light and Wide only stay available.
3. The hook montage (a trailer in front of the episode, then the show name and an introduction of the speakers and guests) is something editors in general want, and it is **deprioritised** behind the items marked Now and Next in section 11. It is parked, not cut.

Tags used below:

| Tag | Meaning |
|---|---|
| **[M]** | Measured by machine over the whole video. |
| **[S]** | Seen: I looked at the images. |
| **[I]** | Inferred from the above; could be wrong. |
| **[H]** | A hypothesis to test with hosts. |

---

## 0. The findings on one screen

1. **The edit has five parts, not one.** A 24-second hook montage, a flash and a 0.6-second
   black beat, a 22-second "who's who" of name cards, 43 minutes of conversation, and a 22-second
   outro from a separate clip. [M][S] (section 2)
2. **The "three cameras" are one camera, zoomed in.** The founder confirmed it: the source was a
   single clip and the closer shots were made by zooming. My measurement agrees: at 13 of 14 cuts
   from the wide shot to a closer shot, the closer frame lines up inside the wide frame with a
   correlation of 0.96 to 1.00, at two repeated zoom levels (about 2.0x and about 3.1x). [M]
   So **Cutroom can reproduce the whole camera grammar from one recording**, limited only by the
   source's resolution. (section 3.1)
3. **Wide is home.** The wide shot is 52% of screen time, 43% of all cuts return to it, and the
   editor ping-pongs wide, closer, wide. Close-ups are only ever of the guest. [M]
4. **The rhythm is fast, and it has an arc.** 6.9 cuts a minute in the conversation, one every 8.7
   seconds. It is fastest in the first 15 minutes (median shot about 5 to 6 seconds) and slows to
   about 10 to 11 seconds after minute 30. Run on this same file, Cutroom's own pipeline suggests
   0.31 cuts a minute, 22 times fewer. [M]
5. **The agency cuts inside people's turns, not when the speaker changes.** 92% of its cuts (276
   of 299) fall inside one person's turn; only 8% are within a second of someone starting to
   speak. Inside the long answers (the 31 minutes made of turns a minute or longer) it cuts 7.2
   times a minute. Cutroom's framing waits for a new speaker, so it has almost nothing to do in
   this kind of conversation. **This is the biggest gap.** [M]
6. **Cuts happen in pauses.** 80% of picture cuts land inside a gap in the speech and 5%
   in the middle of speech. [M]
7. **The editor tightened the pauses.** In 43 minutes of conversation there are 4 pauses longer
   than 1.2 seconds and none longer than 2 seconds. [M]
8. **Text callouts replace captions.** At least 13 of them, about one every 3 minutes: 2 to 5 words,
   1.5 to 2.5 seconds, a giant keyword with small tracked words around it, in one of three colours
   chosen to read against the background, placed in empty space away from the face. No captions
   are burned in. [M][S]
9. **The hook montage is the most designed part.** Every spoken word is animated in time with the
   speech, over b-roll matched to the meaning (an MRI scanner for "MRI", blood samples for "blood
   work"). It stitches the guest's strongest passage, the same one I picked as the best hook for your
   Shorts. About 65% of its time is b-roll. [S][I]
10. **Name cards use a cut-out "sticker" look:** each person cut out with a red outline on paper
   texture, name in a distressed heavy type, 2.2 to 3 seconds each, alternating with a normal shot of them. [S]
11. **Sound is plain.** Loudness is -16.8 LUFS and steady (1.3 LU spread by the minute). No music in the conversation.
    Sharp high-frequency sounds (146 in 28 seconds, some of them speech) only in the hook. Peaks reach -0.1 dBFS, so there is no headroom. [M]
12. **What it does not have:** no b-roll in the conversation, no lower-thirds in the conversation, no
    logo bug, no music, no slow zooms, no transitions except one dissolve, one flash and one fade. [M][S]

**What this means for Cutroom.** The gap is almost entirely editing rules and finishing, not
hardware. The largest single gap is the cutting model: Cutroom cuts to whoever speaks, and the
agency cuts for rhythm inside each person's turn. After that come pauses, the hook and cards,
then callouts. The roadmap in section 11 orders them that way.

---

## 1. How the video was read

"Frame by frame" cannot mean looking at 80,263 frames with eyes. What I did instead:

| What | How |
|---|---|
| Every frame | Scored for picture change (all 80,263). This finds every hard cut, jump cut and on-screen graphic. [M] |
| Every half second | 5,351 frames at 960 px for faces, on-screen text and colour. [M] |
| Audio | Loudness every 100 ms, speech energy every 10 ms for pauses, spectrograms of the hook, the conversation and the ending. [M] |
| Shot types | 331 shots grouped by visual similarity; one example from each group viewed. [M][S] |
| Moments that matter | Looked at images of: the whole hook at 5 frames a second, every shot in the first 50 seconds, the first minutes of the conversation, the ending, each name card, each text callout I could find, and the small picture changes. [S] |
| The camera question | Template matching of the closer frame inside the wide frame at 14 cuts. [M] |
| Cutroom itself | Cutroom's own pipeline run on the same file in a scratch folder (transcript, voices, faces, voice-to-face matching), and its own `suggestRegions` function run on the result (section 7). |

Limits, stated plainly:

- **One episode, one agency, one brand.** The look is a style, not a law. The crimson and the
  paper texture are this show's brand.
- **Fonts are named by class, not by name.** I can describe them and suggest open-licence
  equivalents; I cannot read the exact typeface from an image.
- **The callout count is a floor.** I found the yellow and maroon ones by colour and some white ones by eye.
  Others may exist.
- **Speech-to-text is imperfect**, and some questions below depend on it.
- **I did not hear the audio.** Sound claims come from measurements and spectrograms.

The evidence images are in `Fin/Claude outputs/pro-edit-analysis/`, outside the repo because they
show people. Their numbers are in the same folder as `practo-reference-edit.json` (shot list,
callout times, name cards, loudness and pause statistics; timings and labels only, no footage
or transcript).

---

## 2. The edit in five parts

| Part | Time | Length | What is in it |
|---|---|---|---|
| Hook montage | 0:00 to 0:23.6 | 23.6 s | About 17 shots, mean 1.4 s. 7 show the speakers, 10 are b-roll. Words animate in time with speech. Dense sharp sounds under it. |
| Flash and black beat | 0:23.6 to 0:24.3 | 0.7 s | One overexposed flash frame, then 0.63 s of black. |
| Who's who | 0:24.3 to 0:45.9 | 21.5 s | 10 shots. The guest, then each host: a normal shot, then a cut-out name card. Audio is short soundbites (the guest's joke, the hosts' questions). |
| Conversation | 0:45.9 to 44:12.9 | 43:27 | About 300 cuts. Wide, closer shots, reaction shots, 13+ text callouts. |
| Host outro | 44:12.9 to 44:35.4 | 22.5 s | A separate talking-head clip, in another room, with a call to action. Dissolve in, fade to black at the end. |

---

## 3. The conversation: its grammar

### 3.1 Shot vocabulary, and the camera question

| Code | Shot | Zoom vs wide | Share of time | Shots | Average length | Shows |
|---|---|---|---|---|---|---|
| W | Wide | 1.0x | 51.8% | 128 | 10.6 s | All four people |
| M | Two-shot, guest side | about 2.0x | 31.5% | 88 | 9.4 s | Guest and host 1 |
| C | Close-up | about 3.1x | 9.5% | 46 | 5.4 s | Guest only |
| R | Two-shot, other side | about 1.6x | 6.2% | 35 | 4.7 s | Hosts 2 and 3 |
| T | Three-person medium | n/a | 0.9% | 3 | 7.6 s | Guest, host 1, host 2 |

(Percentages are of the conversation, minutes 1 to 44. [M])

**The test that the extra "cameras" are crops.** At each of 14 cuts from the wide shot to a closer
shot, I took the last frame before the cut and the first frame after, and searched for the closer
frame inside the wide frame at every zoom from 1.3x to 3.3x. 13 of 14 matched with a correlation of
0.96 to 1.00. The matches sat at two repeated zooms: 1.95 to 2.15x (two-shots) and 3.05 to 3.25x
(close-ups). [M]

This is now confirmed by the founder: one clip, and the closer shots were made by zooming in. One
caveat on my own measurement, for anyone repeating it: a static room matches itself, so a control
comparison (a closer frame from a different moment) also scored high, 0.84 to 0.93. The real pairs
beat it, and the repeated, fixed zoom levels fit digital zooms, which is why I read it as zooms
before it was confirmed.

Image 7 in the analysis folder puts the agency's real two-shot and close-up next to crops I cut from
their wide shot. They look the same in framing and background, with the crops slightly softer.

**What this does to the plan:** one wide recording at 4K is enough to reproduce this edit. At the
agency's 3.1x close-up, a 4K source needs an upscale of about 1.5x to reach 1080p. A 1440p source
would need about 2.3x. Cutroom already caps upscaling at 2.6x (`MAX_UPSCALE`), which fits.

### 3.2 Rhythm, and the arc

Shot length across the conversation: mean 8.1 s, median 6.8 s, 10th percentile 2.1 s,
90th percentile 15.8 s, longest 50.6 s. [M]

| Minutes | Shots | Median shot | Mean shot |
|---|---|---|---|
| 1 to 6 | 35 | 6.9 s | 8.6 s |
| 6 to 11 | 50 | 5.3 s | 6.0 s |
| 11 to 16 | 43 | 5.3 s | 6.9 s |
| 16 to 21 | 42 | 6.3 s | 7.4 s |
| 21 to 26 | 35 | 6.6 s | 9.0 s |
| 26 to 31 | 27 | 9.6 s | 10.2 s |
| 31 to 36 | 24 | 11.0 s | 13.2 s |
| 36 to 41 | 28 | 9.2 s | 10.4 s |
| 41 to 44 | 16 | 9.8 s | 13.0 s |

The editor cuts about twice as often in the first third as in the last. That is a viewer-attention
choice: pull people in, then settle.

Spread of shot lengths (all 331 shots): under 2 s: 30, 2 to 3 s: 34, 3 to 5 s: 60, 5 to 8 s: 74,
8 to 12 s: 72, 12 to 20 s: 45, over 20 s: 16. [M]

### 3.3 Transitions: the pattern

Of 299 cuts in the conversation [M]:

| From to | Count |
|---|---|
| Wide to two-shot (M) | 70 |
| Two-shot (M) to wide | 67 |
| Close-up to wide | 37 |
| Wide to close-up | 31 |
| Wide to reaction (R) | 25 |
| Reaction to wide | 24 |
| Two-shot (M) to close-up | 10 |
| Reaction to two-shot (M) | 9 |
| Two-shot (M) to reaction | 8 |
| Close-up to two-shot (M) | 4 |
| Everything else | 14 |

Reading it: **85% of cuts go between wide and something closer.** 43% of cuts (128) return to
wide. Close-up to close-up happened twice. The rule an editor is following is "never cut between
two shots of nearly the same size". The smallest jump they use is M to C, about 1.5x.

### 3.4 Where cuts fall, and what happened to the pauses

- **80% of picture cuts land inside a pause** (within 50 ms), 90% within a quarter second of one,
  and 5% in the middle of speech. [M] Cuts mostly sit where a person stops, which is also where
  a viewer expects a change.
- **Pauses were tightened.** Pauses of 0.15 s or more run at about 23 a minute. Of those, 24 were
  0.8 s or longer, **4 were 1.2 s or longer, and the longest was 1.93 s.** [M] Natural
  conversation has many more long pauses than that. Cutroom's dead-air option already trims
  pauses over 1.2 s to 0.35 s, so the rule exists but is off by default.

### 3.5 Jump cuts

About 15 to 20 small picture changes inside the close-up shot are consistent with jump cuts: the
same shot, a small change in head and hand position. [S][I] The editor does not use jump cuts
across wide or two-shots; there the cut is hidden by switching zoom. That is the technique to copy:
**when you remove a pause, change shot size at the cut.**

### 3.6 Who is on screen while someone speaks

Using Cutroom's own voice detection on this file (the guest's voice is 78% of all speech; 23
turns of the guest's voice, median 66 s, longest 257 s; 30 turns of the others, median 11 s):

| While this voice speaks | Wide | Two-shot (guest side) | Close-up | Reaction two-shot | Other |
|---|---|---|---|---|---|
| The guest (2,048 s) | 53% | 30% | 12% | 3% | 1% |
| A host (548 s) | 47% | 35% | 1% | 17% | 0% |

So **the speaker is not always featured.** Even while the guest talks, the editor stays on the wide
shot for more than half the time and goes to a close-up for one second in eight. The close-up is
saved for emphasis.

**Cuts and turns.** Of 299 cuts in the conversation, 276 (92%) fall inside one person's turn and 23
(8%) within a second of a speaker change. Inside the 13 turns of a minute or longer (31 minutes
in all) there are 223 cuts: 7.2 a minute.

**At a handoff** (48 speaker changes), 38 have a cut within 4 seconds. Relative to the new speaker's
first word, the cut's timing is spread widely: 10th percentile 1.5 s early, median 0.03 s early,
90th percentile 1.9 s late. About a third lead by more than a quarter second, a third land
within a quarter second, a third follow. [M] Handoffs are loosely synchronised; no word-exact rule.

Reaction shots (6% of time) are split about evenly between a host speaking (91 s) and the guest
speaking (72 s).

---

## 4. Text and graphics

### 4.1 The callout card (conversation)

Examples seen, with their lines: "VUPIM"; "WAR"; "WE COULD / SLOW DOWN"; "HEALTHCARE / IS A
BLACKBOX"; "IF THAT THING IS / PAINFUL / ENOUGH"; "WE / IMPORT / WAY TOO MUCH"; "TESTS / ARE
EXPENSIVE"; "ITS A LOT OF / LOGISTICS"; "DID NOT SCALE"; "NOT HIT / DODGE A FEW"; "NEEDS TO /
UNDERSTAND"; "BUILDING / SOMETHING / THEN / ABANDONING" (on a host's line); and a Hindi phrase
written in English letters, left in the speaker's own words. [S]

What they have in common, as rules:

| Property | Observed |
|---|---|
| How often | At least 13 in 43 minutes, about one every 3 minutes. Concentrated on claims and contrasts. |
| How long | 1.5 to 2.5 seconds. |
| How many words | 2 to 5, taken from the speaker's own words. |
| Layout | Two tiers: one giant keyword in heavy condensed capitals, and 1 to 3 small, widely spaced capitals around it that finish the phrase. |
| Size | Keyword about 10% to 18% of the frame's height (estimated from the images). Context words about 2.5% to 3%. |
| Colour | Three, picked to read against what is behind: neon yellow `#FAFF08` over busy or mid-tone areas, white over dark, deep maroon `#540B13` over light stone. |
| Place | In empty space, away from the speaker's face and hands, high on one side or low on the other. Never over the face. |
| On whom | On the guest mostly, but also a host's line when it carries the point. |
| Sound | No sound effect tied to them (11 callouts tested against random half-seconds: no consistent difference). [M] |

### 4.2 The type system (by class)

| Use | Class | Open-licence stand-ins that fit |
|---|---|---|
| Callout keyword | Heavy condensed, all capitals | Anton, Bebas Neue |
| Callout context words | Light geometric sans, capitals, wide tracking | Poppins, Montserrat |
| Hook hero words | High-contrast display serif, sometimes italic | Playfair Display, DM Serif Display |
| Hook emphasis | Heavy sans in yellow, or italic serif in red | as above |
| Name cards | Heavy sans with a worn, stamped edge | Alfa Slab One with a texture, or Anton with a texture |

All the stand-ins are under the SIL Open Font Licence, which fits Cutroom being MIT: bundle them
and credit them in the app's Credits screen, the way the model weights are.

### 4.3 Palette

Yellow `#FAFF08`, maroon `#540B13`, white, paper `#E6E4E5`, and a crimson outline for the cut-out
cards. This is the show's brand; Cutroom's design system also has its own rules, so in the app
these must be user settings (a brand kit), not Cutroom's colours.

---

## 5. The hook montage

Twenty-four seconds before the conversation begins. It is built from a re-ordered cut of the
guest's best passage (the answer about full-body MRI), so the audio is already the strongest
thing in the episode. [S][I]

Observed structure, second by second:

| Time | Picture | Words on screen |
|---|---|---|
| 0.0 to 3.0 | The speaker, in black and white and blurred as a backdrop | "cent" (big serif), "is not really a typical", "diagnostic" (yellow), "business" |
| 3.1 to 5.5 | 3D animation of an MRI scanner | "product that a / it uses is / diagnostic (yellow) machine" |
| 5.5 to 7.6 | Illustrated stopwatch and a seated figure | "the best chance of surviving (serif) cancer (red italic)" |
| 7.6 to 9.6 | A knee MRI scan on black | "the second level / insight (yellow) / behind that" |
| 9.7 to 12.0 | The two-shot of the speakers | white words directly on the speakers: "what is the best way to detect this as early as possible" |
| 12.0 to 14.3 | Hospital scanner, then blood sample tubes | "that's an MRI (red) / no blood work can tell you enough" |
| 14.3 to 19.1 | Glowing scanner tunnel animation | "the best science available / Detecting (red) as early as possible / It would detect (red italic) / cancer" |
| 19.1 to 20.8 | Macro of red tissue | "but an abnormal (yellow) growth anywhere in the body" |
| 20.8 to 23.3 | Wide, then two-shots | white words on the speakers: "So the core of cent is that full body MRI" |
| 23.6 | One overexposed frame | none |
| 23.7 to 24.3 | Black | none |

What to take from it:

- **Word-by-word timing.** Each word appears with, or just before, the spoken word. Hero words
  are large, connectors tiny. Text enters with a soft fade and a slight slide.
- **Colour has a job.** White and black are neutral; yellow marks the keyword; red marks the
  stakes ("cancer", "detect").
- **Picture follows meaning.** Abstract or visual ideas get b-roll that matches them; functional
  phrases stay on the speaker.
- **Cuts at phrase boundaries** (1 to 5 seconds per b-roll).
- **A signature end:** flash, then a beat of black, then the interview starts with a close-up.
- **Sound:** 146 sharp high-frequency sounds in 28 seconds, about one per word. Speech consonants account for some of them, so I read it as clicks timed to the words, not proof. [M][I]

---

## 6. Sound and finish

| Aspect | Observed |
|---|---|
| Loudness | -16.8 LUFS integrated, loudness range 6.0 LU. By the minute, the spread is 1.3 LU. The hook averages about -15.8 LUFS (momentary); the conversation averages about -22 LUFS (momentary, pauses included). [M] |
| Peaks | -0.1 dBFS. No headroom, so any platform that re-encodes may clip. [M] |
| Music | None in the conversation. A rhythmic bed or clicks in the hook only. [M] |
| Pauses | See 3.4. |
| Ending | The audio level falls over the last few seconds, and the picture fades to black. The host outro is dissolved in. [M][S] |
| Look | The three "angles" match to within about 10 points of brightness, because they are the same camera. No heavy grade; no vignette or zoom drift detected. [M] |

---

## 7. Cutroom against it, on this very episode

I ran Cutroom's real pipeline on the agency's file (the same local code the app uses, in a
scratch folder so it could not touch a real library), then ran its own framing function,
`suggestRegions`, on the result. It took about 40 minutes on this Mac.

**What the pipeline found**

| | Result |
|---|---|
| Transcript | 7,990 words |
| Voices | 5, for 4 real people (one person split across voices) |
| People (faces) | **2 of 4**: the guest and host 1 |
| Voice to face | The guest's voice to person 0 (confidence 1.0, 1,841 s judged); three other voices all to person 1 |
| Turns | 53: 23 on the guest's voice, 30 on the others |

Why 2 of 4 faces, my reading [I]: the agency's picture moves between 1.0x and 3.1x zoom, so one
face is 125 px tall in the wide shot and 333 px in a close-up, and two of the hosts are seen small
most of the time. Cutroom assumes a fixed frame. On a raw single-camera recording this should not
arise in the same way (a 47-minute four-person iPhone recording found all four people earlier). It is evidence for
PE9 (already-edited input), not a verdict on raw footage.

**What its framing suggests.** "Gentle" and "Dynamic" came out identical here, because the turns
are long.

| | Agency | Cutroom |
|---|---|---|
| Shots | 331 | 14, plus one 1-second wide at the end |
| Cuts per minute | 6.9 | **0.31** (22 times fewer) |
| Median shot | 6.8 s | 63 s |
| Longest shot | 50.6 s | 874 s (14.6 minutes on the guest) |
| Time on the wide shot | 52% | 0% |
| Shots under 2 s | 30 | 1 |

**Reading it honestly.** Some of this is the 2-of-4 identification problem, but not most of it.
STATUS.md measured the same effect on its own reference episode: 33 to 37 shots in 53 minutes
(about 0.6 to 0.7 cuts a minute) with all four people found. Two causes, both in how the rules work:

1. **It cuts when the speaker changes** (and after a hold). The agency's cuts are 92% inside a turn.
   When one person talks for a minute or more, which is most of this conversation, Cutroom has
   nothing to cut to.
2. **Its only non-wide choice is a close-up on the speaker,** held until the next change. The
   agency stays wide about half the time even while the guest speaks (3.6).

**Everything else the agency has and Cutroom does not**

| Capability | Agency | Cutroom today |
|---|---|---|
| Hook montage | Yes, 24 s | None |
| Who's who cards | Yes, 4 | None |
| Text callouts | 13 or more | None (text annotations are a stub, feature #11) |
| Pause policy | Pauses held under 2 s | Option "Trim dead air", off by default (pauses over 1.2 s become 0.35 s) |
| Loudness | -16.8 LUFS, steady | Untouched: the original audio is copied through |
| Fade out | Yes | None |
| Reaction shots | 6% of time | None |
| Outro clip | Yes | None |
| Burned-in captions | None | Optional (libass) |

---

## 8. The spec: "Pro conversation" preset, v1

Parameters come from the measurements above, widened by about a quarter so they are bands,
not points. Each can be a setting; the preset is a starting position.

### 8.1 Framing and rhythm

| # | Rule | Value | Source |
|---|---|---|---|
| R1 | Angles | Three scales cut from the one recording: wide 1.0x, medium about 2.0x (two people), close about 3.0x (one person). A scale is offered only if the upscale to the output stays at or under 2.6x. | 3.1 |
| R2 | Home shot | Wide, 45% to 55% of screen time. | 3.1 |
| R3 | Who gets which shot | Close-ups only of the featured people (default: the guest). Everyone else gets medium. Over the episode, while the guest speaks: about 50% wide, 30% medium, 12% close, a few percent reaction; while a host speaks: about 45% wide, 35% medium, 15% reaction. The speaker is not always on screen. | 3.1, 3.6 |
| R4 | Alternation | Consecutive shots differ in scale by at least 1.4x, or show a different subject. Cuts between wide and a closer shot are at least 80% of all cuts. Same-scale cuts at most 5%. | 3.3 |
| R5 | Rhythm, independent of who speaks | A clock, not a speaker change, decides when the next cut is due. 5 to 9 cuts a minute overall, and **about 7 a minute inside a long answer.** First 15 minutes: 7 to 9. After minute 30: 4 to 6. Median shot 5 to 8 s early, 9 to 11 s late. No shot over 45 s. No shot under 1.2 s. The next cut then waits for the nearest pause (R7). | 3.2, 3.6 |
| R6 | Return to wide | 38% to 48% of cuts go to wide. A closer shot is held at most 12 s before the next pause sends it back. | 3.3 |
| R7 | Cut points | At least 80% of cuts inside a pause of 80 ms or more, at most 5% mid-speech. | 3.4 |
| R7b | Handoffs | When someone new starts speaking, show them within about 2 seconds of their first word (the agency's cut falls between 1.5 s before and 1.9 s after). No word-exact rule; an early cut is as good as a late one. | 3.6 |
| R8 | Reaction shots | 5% to 8% of screen time, 3 to 6 s each, of a person who is listening while a featured speaker talks, only when that person's face is visible, at most once a minute. | 3.1 |
| R9 | Pauses | Any pause over 1.0 s becomes 0.4 to 0.6 s, with the cut hidden under a change of shot size. Same-shot jump cuts only in close-ups, at most half a cut a minute. On by default in this preset. | 3.4, 3.5 |
| R10 | Overlapping speech | Keep today's rules (EDGE_CASES.md). The agency's edit does not speak to it. | n/a |

### 8.2 Text and graphics

| # | Rule | Value |
|---|---|---|
| R11 | Callouts | 0.25 to 0.5 per minute. 2 to 5 words from the speaker's own words, 1.5 to 2.5 s. Two-tier layout, three templates (left stack, right stack, top centre). Colour from the brand palette chosen by the brightness behind the text. Placed in the largest empty area away from faces (face boxes already exist). Never in the lowest 12% of the frame. Each is a suggestion the person accepts, edits or deletes. |
| R12 | Callout candidates | Rule-based, no cloud: numbers; contrasts ("not X, but Y"); strong verbs and negations; a phrase repeated within 30 s; the words just after "the real problem is", "the best", "the only"; a loud stretch of speech. Spaced at least 90 s apart. The person always sees why a phrase was suggested. |
| R13 | Hook montage | 20 to 28 s. Built from 2 to 4 soundbites of the episode's own strongest passage, picked from a ranked list the person approves. Every word animated in time with speech: hero words large, connectors small, one emphasis colour. Backdrop: the speaker in black and white and blurred, or media the person drops in. Ends with a flash and 0.5 s of black. Optional. **Parked for now (section 11).** |
| R14 | Who's who | 2 to 3 s per person, right after the hook, each following a normal shot of that person: name, affiliation, a framed or cut-out portrait, on paper texture. v1 without segmentation; cut-out in v2. **Parked for now (section 11).** |
| R15 | Captions | Optional per destination. The agency's conversation has none; its callouts do that work. Short formats keep captions on by default. |

### 8.3 Sound and finish

| # | Rule | Value |
|---|---|---|
| R16 | Loudness | -16 to -14 LUFS integrated, range at most 7 LU, true peak at most -1 dBTP, spread by the minute at most 1.5 LU. |
| R17 | Music | None under the conversation. |
| R18 | Fades | Picture and sound fade out for at least 1 s at the end. |
| R19 | Outro | Optional separate clip, dissolved in over at least 0.3 s. |
| R20 | Export | Keep source resolution and frame rate. |

### 8.4 The scorecard (how we know it works)

A script that reads any finished video and prints these. The agency's values are the reference.

| Metric | Agency | Pass band |
|---|---|---|
| Cuts per minute (conversation) | 6.9 | 5 to 9 |
| Cuts per minute inside turns of 60 s or longer | 7.2 | 5 to 9 |
| Share of cuts inside a turn (not at a speaker change) | 92% | 80% or more |
| Median shot length | 6.8 s | 5 to 9 s |
| Share of time on wide | 52% | 45% to 55% |
| Cuts that return to wide | 43% | 38% to 48% |
| Cuts inside a pause | 80% | 75% or more |
| Cuts mid-speech | 5% | 8% or less |
| Pauses over 1.2 s, per 10 minutes | 1 | 2 or fewer |
| Longest pause | 1.9 s | under 2.5 s |
| Callouts per minute | 0.3 | 0.25 to 0.5 |
| Shots in the first 25 s, if a hook exists | 20 | 15 or more |
| Integrated loudness | -16.8 LUFS | -16 to -14 |
| True peak | -0.1 dB | -1 dB or lower |

---

## 9. The editing experience

What the person sees and does, so that getting to this level is easy and stays in their hands.

1. **A style, not a threshold.** Replace "Stay wide / Long answers / Most answers" with three
   plain presets: *Wide only*, *Light*, *Professional*. *Professional* is the default for every new
   episode (decided 2026-10-05); an episode saved earlier keeps its own style. Each says in one sentence what it does and shows the scorecard numbers it will
   produce ("about 7 cuts a minute, half the time on the wide shot"). This replaces the
   "Gentle and Dynamic barely differ" problem recorded in STATUS.md.
2. **A rhythm panel for people who want control.** Four settings: cuts per minute (3 to 9),
   home shot (wide or medium), who gets close-ups (tick the people), pause limit (off, 1.0 s, 0.6 s).
   Changing one re-suggests only the shots the person has not touched; their own edits stay
   (this is the reconcile-not-replace behaviour already built).
3. **A review lane.** Suggested shots and callouts show as ghosts on the timeline. `A` accepts,
   `X` rejects, `Tab` goes to the next, "Accept all" confirms the rest. The count shows ("31 left to
   review").
4. **A live scorecard bar** under the preview: cuts a minute, share on wide, cuts on a pause,
   longest pause, loudness. Each in words and numbers, with a plain "in range / out of range", not
   colour alone.
5. **A callouts lane.** Click a suggestion to edit the words, pick the emphasised word, switch
   template or colour, and see the safe area on the preview. "Add callout" from selected transcript words.
6. **An Opening tab.** Ranked moments to build the hook from, drag to reorder, names and roles for
   the who's-who cards, one switch to turn each part off.
7. **Smooth preview.** The editor drops to about 4 frames a second while a cropped shot plays
   (STATUS.md). Scrubbing a 7-cuts-a-minute edit with callouts needs that fixed first.
8. **Everything saved.** Callouts, cards and the hook go in the saved edit and the `.cutroom`
   file, with the same version check and plain refusal for newer files.
9. **Preview equals export,** with a shared-numbers test on both sides for every new overlay, as
   already done for crops.

---

## 10. What to copy, what to adapt, what to skip

| Copy | Adapt | Skip |
|---|---|---|
| The shot grammar and rhythm (R1 to R9) | B-roll becomes media the person supplies, or the blurred black-and-white speaker the agency used for the first 3 seconds | Stock or generated b-roll |
| Callouts (R11, R12) | Brand colours and fonts become a brand kit | Music beds |
| Hook structure (R13) | Per-word clicks become an optional set of clicks generated inside the app | 3D scanner animations and illustrations |
| Who's who (R14) | Cut-out "sticker" becomes a framed portrait in v1, segmentation in v2 | Colour grading |
| Loudness and fade rules | The paper and maroon look is one brand, not Cutroom's | Advice to shoot with several cameras |

---

## 11. Roadmap

This is a track inside [PLATFORM_ROADMAP.md](PLATFORM_ROADMAP.md), whose section 8 holds the single
priority order for everything. This track supplies the engines that clips, covers and overlays
(epics D, E, G) need, and it improves the main product, the full episode, whose quality is what
the north star ("episodes a host would publish without asking for help") depends on. Sizes:
S = days, M = 1 to 2 weeks, L = 3 to 4 weeks, XL = longer. They are guesses.

**Priority, updated 2026-10-05** after the founder's decisions: **Now** is the host-test window
(about 2 weeks); **Next** ships Professional as the default; **Then** follows once the Library and
clip work start; **Parked** is a decision, with the spec kept.

| Priority | # | Item | What it fixes | Scope | Size | Depends on | Done when |
|---|---|---|---|---|---|---|---|
| Now | PE0 | Reference and scorecard | Nothing to measure against | The reference file and a script that prints section 8.4's metrics for any video; run on Cutroom's output to record a baseline | S to M | none | Baseline numbers for current Cutroom are written in STATUS.md |
| Now | PE1 prototype | Not knowing how the new cutting feels | The Professional cutting model as a script: writes the shots, renders them through today's export, scored by PE0, on this episode and one more recording. Also the clip shown in the blind comparison at the host test | M | PE0 | Scorecard in band on both recordings |
| Next | PE1 | Cutting only on speaker changes; 22x too few cuts on this episode | A rhythm clock that cuts inside a turn (R5), synthesized angles (R1), home shot, alternation, return to wide, reaction shots, handoff rule (R2 to R8, R7b); replaces Gentle and Dynamic | L | PE0, preview fix | Scorecard in band on the reference and two other recordings |
| Next | PE2 | Long pauses; no loudness target; hard stop at the end | Pause policy on by default for Professional (R9), loudness target and peak limit (R16), fades (R18). Reuses the dead-air trimmer | S to M | none | Scorecard pause and loudness metrics in band |
| Next | PE3 | Presets don't explain themselves | **Professional becomes the default for new episodes.** Section 9 items 1 to 4 and 7 to 9 | M to L | PE1 | A first-time person gets Professional and understands what it did |
| Next | upkeep | Preview speed; footage variety | Fix playback while a cropped shot plays; a test set with raw and already-edited footage; telemetry events | M | none | Scrubbing a 7-cuts-a-minute edit is smooth |
| Then | PE4 | No emphasis, no guidance to the eye | Callout engine, R11 and R12; three templates; brand palette; bundled open fonts; face-aware placement; callouts lane | L | PE1, brand kit basics | Callouts per minute in band; a host keeps most suggestions |
| Then | PE5 | Abrupt ending | Outro clip import with dissolve (R19) | S | PE2 | The ending dissolves in |
| On demand | PE9 | Cutroom found 2 of 4 people on already-edited input | Detect existing cuts and zoom changes and track faces across them (EDGE_CASES E2) | M | none | All four people found on this file |
| **Parked** | PE6 | The first 25 seconds decide whether people stay | Trailer-style hook montage in front of the episode (R13) | L to XL | PE4, cut engine | Revisit after PE4 |
| **Parked** | PE7 | A video that starts cold with strangers | Show name and speaker introductions (R14 v1) | M | PE4, cast names | Revisit with PE6 |
| **Parked** | PE8 | The sticker look | Optional portrait cut-out, local model | L | PE7 | Only if hosts ask |

**Why this order.** The cutting model and the pause and loudness defaults change how every
episode feels, they are the largest measured gap, and they cost the least per unit of effect.
Callouts are visible but need the brand kit and a smooth preview. The hook and introductions are
real wins, and the founder has put the core edit first.

**How Professional becomes the default.** The framing style gets a new value, `professional`,
beside `wideOnly` and `gentle`. New episodes start on it. Saved edits keep what they were saved
with, and the saved-edit check already falls back to Gentle for a style a build does not know.
Until PE1 and PE3 ship there is nothing to default to, so new episodes keep Light until then.
Light and Wide only stay one click away, and the style picker's sentence says what Professional does
("about 7 cuts a minute, about half the time on the wide shot").

**Validation, not a gate on the default.** The scorecard bands (8.4) must hold on the reference and
two other recordings before PE3 ships. The blind comparison at the host test (the prototype
against today's edit, same episode) is how the bands get tuned. If a host finds it jumpy, tune the
scale-change and rhythm settings; the default stays.

**How it changes the platform roadmap.** The Pro-edit items now come before the Library, because
the full-episode edit is the product and the cut engine (epic D) is shared. See PLATFORM_ROADMAP
section 8 for the combined order.

**Capacity.** 80% new work and 20% upkeep, with a stop at 40% upkeep, as in the platform roadmap.
PE1 will create upkeep (shot choices need tuning on real footage); count that in the 20%.

### Do and do not

- **Do** measure every change with the scorecard on the reference and on at least two other recordings.
- **Do** keep every automatic choice a suggestion the person can see, change and undo.
- **Do** keep rules as settings, so another show's rhythm and brand can differ.
- **Do not** copy the brand look as Cutroom's own style.
- **Do not** add music, stock footage or generated imagery.
- **Do not** tune to one episode: three recordings before any threshold is called settled.
- **Do not** let callouts or cards cover faces, or the captions' area.

---

## 12. Risks, decisions and questions

| Risk | Why it matters | What to do |
|---|---|---|
| One reference episode, one agency | The numbers could be this editor's taste | Treat them as bands; test on two more recordings; ask hosts |
| Cutting between crops of one frame can look jumpy | Every cut is the same background | R4: at least 1.4x scale change; blind test with hosts before shipping |
| Source resolution | A 1080p recording cannot support a 3x close-up | Offer scales by resolution; say so in the editor |
| Preview speed | A 7-cuts-a-minute edit with overlays needs smooth scrubbing | Fix playback first |
| Fonts and brand | Bundled fonts need credits; the maroon and paper look is the agency's brand | Open fonts only; brand kit; Credits screen |
| Face and hand avoidance for text | Placing text well needs more than face boxes | Start with faces; add a person mask later |
| Face finding on changing zoom | Cutroom found 2 of 4 people on this file | PE9; the test set should include raw and edited footage |
| Cutting inside a turn can look arbitrary | Cuts with no speaker change need a reason the viewer feels | Cut on pauses (R7), change shot size by at least 1.4x (R4), and blind-test with hosts |

**Decisions recorded (2026-10-05)**

1. Professional is the default for every new episode.
2. The closer shots in the reference were made by zooming in on one clip, so the plan stands.
3. The hook montage and the speaker and show introductions are deprioritised, not cut.
4. The Pro-edit items go ahead of the Library and clips work.

**Still open**

1. Would the agency share brand-neutral versions of its callout and card templates? Optional; useful
   when PE4 starts.
2. When the hook comes back, what should it be: a trailer cut from the episode, a show-name card with
   speaker introductions, or both? The founder described both.

---

## 13. Appendix

- **Reference data:** `Fin/Claude outputs/pro-edit-analysis/practo-reference-edit.json`. Move it into
  `docs/reference/` if you want it in the repo.
- **Evidence images:** the same folder, numbered 01 to 14.
- **How the numbers were produced:** scene-change scoring with ffmpeg; face and text finding with
  Apple's Vision framework; loudness with ffmpeg's EBU R128 filter; pauses from 10 ms speech energy;
  shot grouping with k-means on small thumbnails; the camera test with OpenCV template matching.
  These were scratch scripts. Copies are in the analysis folder under `scripts/`, with Cutroom's raw
  output on this episode (`cutroom-run-on-this-episode.json`). PE0 turns them into one tested script.

# Status — where this project actually is

One page, current as of this branch. For *how* things work see
[ARCHITECTURE.md](ARCHITECTURE.md); for the design reasoning behind the
export phase see [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) and
[UX_PRD.md](UX_PRD.md).

---

## What works end to end, today

Drop in a recording and you get an edited MP4 out. The whole loop runs
locally, nothing is uploaded anywhere.

1. **Upload** — click or drag-and-drop, with real byte-level progress.
2. **Process** — one upload feeds transcription, speaker diarisation,
   optional overlapping-speech detection, and face recognition. Per-stage
   progress is polled and shown while it runs.
3. **Cast** — name each recognised person once. Voices are already matched to
   faces by lip-sync, so this is a confirmation with the uncertain ones
   flagged, not a grid of anonymous voices to work out by ear.
4. **Edit** — turn-by-turn transcript with real names, a live preview that
   uses the same framing maths as the export, per-turn layout override
   (wide / single / multi-person) and per-turn correction of who is on
   screen.
5. **Export** — a real MP4: hard cuts at turn boundaries, medium-shot
   framing, multi-person composites, source resolution preserved, original
   audio stream-copied, and optional burned-in captions cut from the Whisper
   word timestamps (not the coarser turn boundaries).

---

## Measured, not asserted

Everything below was measured on a real recording (a four-person, 53-minute
1080p episode at 14.1 Mbps), not estimated.

| Claim | Measurement |
|---|---|
| Face recognition merges fragments into people | **9 raw tracks → 4 people** on a 5-min cut; the 5th cluster it found was a hand, dropped by the minimum-detections filter |
| People are cleanly separable | cosine distance **0.66–0.91** between the four participants; stable for any threshold in 0.3–0.6 |
| Framing matches professional practice | reference frames from three podcast edits measured at **3.5x face height, face 0.32–0.39 down frame**; implementation now matches (was 2.5x and dead-centre) |
| Audio is not degraded | export audio bitrate **320009 bps in → 320009 bps out** (stream-copied, bit-identical) |
| Video re-encode is near-transparent | SSIM **0.986** at CRF 16 against pristine source; shipped at CRF 14 |
| Output preserves the source | 1920×1080 in → 1920×1080 out, duration exact, **1799 frames in → 1799 out** across 44 segments (no drift, no desync) |
| Processing is not slow | **12.5s end to end** for a 104 MB / 60s clip via curl; ≈1/5 of real time |
| Concurrency helps | 13s concurrent vs 16s sequential for transcribe + faces |
| Captions land where they should | burned-in cues verified frame by frame on a synthetic clip: text present during each cue, **absent during the pause between them**, 100 → 100 frames, duration exact |
| The GPU makes community-1 affordable | same 10-min slice, same venv: **398.4s on CPU (0.664x) → 53.3s on MPS (0.089x)**, and byte-identical output either way (3 speakers, 90 turns). **35 min → 4.7 min** for a 53-minute episode |
| Forcing a speaker count invents speakers | unconstrained gives **3 speakers / 90 turns** on the 10-min slice, on both devices; forcing `num_speakers=4` gave 4/87, splitting one person in two. The count is no longer passed |
| Real overlap is rarer than it looks | community-1 finds 10 overlaps in the 10-min slice totalling 2.65s — every one between **0.02s and 0.56s**. All interjections; none long enough to cut to a composite for. On this episode the split-screen never auto-triggers, and that is the correct answer, not a gap |
| Lip-sync picks the same face as the validated benchmark | on the same 3-min clip, **100% agreement** across the 145s where both say someone is talking (94% counting the silence boundary), per-face shares within 3 points — while skipping per-frame face detection entirely and streaming crops instead of holding 4GB of them |
| Voices get matched to faces without being asked | end to end on that clip: voice 0 → person 1 at **97%** over 114 judged seconds, voice 1 → person 0 at **100%** over 40. The cast screen starts filled in |
| The whole pipeline is affordable | **80s for a 3-minute clip** including transcription, diarisation, faces, lip-sync and matching — roughly 0.45x real time |
| The presence threshold drops junk without dropping people | same clip, **5 "people" → 4** once the threshold scales: the four kept appear in 179-180 of 180 sampled frames, and it is a four-person podcast |

**Full-length episode (53 min, four people, 1080p, 5.3GB), run 2026-09-12:**

| Claim | Measurement |
|---|---|
| Processing completes | **892s (~15 min)** end to end, ~0.28x real time, peak 4.5GB RAM |
| Face recognition holds up at length | all four participants found in **3,164-3,172 of 3,181** sampled frames; six junk clusters of 3-12 detections also survive `MIN_DETECTIONS` (fixed threshold does not scale with episode length) |
| Export completes and is faithful | **95,436 frames in -> 95,436 out**, duration exact, 1920x1080 preserved, audio stream-copied **bit-identical** (matching MD5), 3.5GB out, peak 949MB RAM |
| Diarisation does **not** hold up at length | 4 people -> **2 speakers, 34 turns in 53 min** (median turn 33s, longest 6.4 min). See "What's left" |

**Checks:** 23 backend tests passing, `tsc` clean, `oxlint` clean (two
deliberate, documented warnings), production build clean, full flow verified
in a real browser against real footage.

---

## Against the original epic

The epic's Next Steps, and where each landed:

| # | Epic step | Status |
|---|---|---|
| 1 | Crude export with multi-speaker framing | **Done, and well past "crude"** — measured framing, real composites, quality-preserving encode |
| 2 | Decision logging (`layoutChoices` → `decisions.jsonl`) | **Done** — written on successful export |
| 3 | **Real-world test: full episode, shown to a podcast host** | **Not done — this is the next milestone** |
| 4 | Then decide: smoothing layer vs `pyannote` upgrade | `pyannote` shipped (overlap detection). Smoothing still open, and should stay open until #3 says whether it matters |
| 5 | Rest of the roadmap | Two items pulled forward and done (live preview parity, overlap indicator); rest below |

Two things the epic listed as open questions are now answered:

- *"Does the pipeline even surface overlapping speech?"* — it did not. It
  does now, via `pyannote.audio` overlap detection (optional, needs a free
  Hugging Face token).
- *"Is the manual face-labelling step fine as-is?"* — no. It asked users to
  map faces to anonymous "Speaker 1" ids they had no way to identify.
  Replaced with naming people and matching voices by ear.

---

## What's left

Ordered by what unlocks the most, not by effort.

### Next
1. **Fix speaker diarisation.** *Voices: done. Which face: next.*

   The full-episode run (2026-09-12) found this is the blocker in front of
   everything else: on a four-person episode the pipeline heard **two**
   speakers and cut 34 turns in 53 minutes, so two participants never get a
   close-up. `resemblyzer` has now been replaced by community-1 on the GPU,
   which removed the separate overlap model as well. What remains is the
   other half of the fused design — lip-sync for *which face*, and the
   Hungarian matching that joins the two. Measured on the real episode:

   | Approach | Result |
   |---|---|
   | `resemblyzer` + average-linkage clustering (was shipping) | 99.5% of speech in one cluster at every k from 2 to 6. Removed |
   | WeSpeaker embeddings + k-means / spectral / Ward | stable labels (2-3% flips) but never a clean four-way split |
   | `sherpa-onnx` (pyannote segmentation 3.0 ONNX + WeSpeaker, no HF token) | 3 speakers when asked for 4 (89% in one), or 22 fragments unconstrained |
   | `pyannote` **community-1** (CC-BY-4.0, HF token) — **now shipping** | best of the audio-only options. On a 10-min slice, unconstrained: **3 speakers, 90 turns** (the old pipeline managed 34 in the whole episode). The speed objection is gone: **0.089x on MPS, 4.7 min per episode**, same output as CPU. Overlap-aware in one pass, so the separate overlap model is deleted |
   | **LR-ASD lip-sync** (MIT, AVA weights) | **validated on real footage** — tracked all four faces 100% of sampled frames, and its "who is speaking" call was confirmed correct by a human watching an annotated 3-minute clip. Independently showed the single dominant "voice" is really two different people |

   **Cross-checking the two settles the design.** On the same 10 minutes,
   community-1's voices versus the lip-sync model's "who is on screen
   talking":

   | community-1 voice | face the lip model picks |
   |---|---|
   | SPEAKER_00 | p0, 100% of 71s |
   | SPEAKER_01 | p2, 100% of 39s |
   | SPEAKER_02 | p0 again, 100% of 36s |

   Two voices map cleanly onto one face each; the third is the same person as
   the first, split in two because `num_speakers=4` was forced on a window
   where the fourth participant barely speaks. So each signal catches the
   other's failure: one voice pointing at two faces means merged speakers
   (split them), two voices pointing at one face means an over-split speaker
   (merge them). Neither can see its own error.

   No speaker count is forced any more, which removes the cause of that
   particular over-split. The roster gets confirmed by the one party that
   actually knows — the human at the cast step, who is already there naming
   faces — rather than guessed at by the model.

   **Still to build:** "which face" from lip-sync, paired to the voices with
   Hungarian matching (the approach in Adobe's patent US12125501B2). That
   also removes the manual voice-to-face step in the cast screen. Cost
   measured on a 3-minute clip: ~15 min per 53-min episode for the lip-sync
   pass, plus dense face detection (64 min unoptimised, expected to drop a
   lot by searching only where each seated person already is).

2. **Then show a full edit to a podcast host.** Still the milestone the whole
   roadmap is sequenced against, and still not done — an edit built on
   two-speaker diarisation is not worth a host's time.

### Then, informed by that
3. **Smarter cutting** — trim dead air and filler words, vary shot length so
   the edit doesn't feel metronomic. The epic's "decision quality before
   decoration" principle puts this ahead of everything below.
4. **Smoothing / scene-boundary layer** — the deferred Approach B. Only
   worth it if the real-world test says crop jitter is a real complaint.
5. **Jargon info-text annotations** — genuinely novel, nothing open-source
   covers it.
6. **Audio effects, intro/outro presets.**
7. **Voice ducking for overlapping speech** — still gated on a source-
   separation research spike. Isolating one voice from a single mixed track
   is a different, harder ML problem than anything in the pipeline today.
   Not a checkbox.
8. **Style learning from corrections** — the `decisions.jsonl` data is
   already being captured. Gated on evidence of repeat editors making repeat
   corrections; before that there is no pattern to learn from.
9. **Automatic social clips** — own offline scoring heuristic (pace,
   silence, turn density), deliberately avoiding a cloud-LLM dependency.
10. **Multi-camera support, desktop packaging (Electron).**

Automatic speaker-to-face matching used to sit at the bottom of this list as
"the hard one, deferred". It is now item 1: the fused design does it as a
side effect, and the full-episode run showed the manual cast step was
resting on diarisation that had already lost two of the four people.

### Separate passes, not roadmap items
- **Visual design language** — colours, typography, spacing, component
  system. Still entirely unaddressed. The epic recommended a
  `/design-consultation` pass after the real-world test.
- **Public-release readiness** — one-command setup (Docker), CI, cross-
  platform verification (macOS only so far), CONTRIBUTING.md, a demo GIF.
- **Agent-friendly / fixture mode** — a way to load canned state directly
  into the editor so UI changes can be checked without walking the whole
  upload flow. Would have saved real time during this phase.

---

## Known limitations

- **Zooming into a wide shot is inherently soft.** Framing now matches
  professional practice, which needs ~2.6x upscale on a 1080p wide shot of
  four people. The real fix is source resolution: shoot 4K, deliver 1080p,
  and punch-ins become genuinely sharp because the crop then holds more real
  pixels than the output needs.
- **Diarisation now requires a Hugging Face token.** community-1 replaced the
  token-free `resemblyzer` clustering, which was measured finding two
  speakers on a four-person episode — a fallback that produces a quietly
  wrong edit is worse than an error that says what to do, so there is no
  fallback. `/process` returns a 400 naming the token and the licence page.
- **Diarisation is still not perfect.** It can mis-assign a turn, and only
  finds speakers who actually speak in the window analysed. This is why
  per-turn correction exists in the editor.
- **pyannote 4 cannot read audio files on FFmpeg 9.** It decodes through
  torchcodec, whose prebuilt libraries link against FFmpeg 4-7, so on a
  modern ffmpeg every one of them fails to load. Worked around by decoding
  the wav ourselves and handing the pipeline a waveform, which is free — the
  pipeline already extracts a 16kHz mono wav before this point.
- **No automated frontend tests.** Backend has 23; the frontend is verified
  by typecheck, build, and real browser sessions.
- **Caption burn-in needs an ffmpeg the standard install doesn't give you.**
  Homebrew's regular `ffmpeg` formula (9.0) ships without libass — and
  without freetype, so `drawtext` is not a fallback — so the `ass` filter
  does not exist and no text can be rendered onto a frame. `brew install
  ffmpeg-full` has it, but that formula is keg-only, so point the server at
  it with `FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` in
  `server/.env` rather than reordering a global PATH. Export checks before
  starting the render and refuses with that advice, rather than spending 15
  minutes and handing back a video with no captions on it.
  (Installing `ffmpeg-full` upgrades x265, which leaves the regular `ffmpeg`
  linked against a libx265 that is no longer there: `brew reinstall ffmpeg`
  repairs it. Both can coexist afterwards.)
- ~~**Junk "people" survive on long episodes.**~~ Fixed: the threshold is now
  the larger of 3 detections and 5% of sampled frames, so it scales with
  episode length. On the 53-minute episode that separates the four
  participants (>99% of frames) from the six junk clusters (<0.4%) with three
  orders of magnitude to spare.
- **No pre-flight disk-space check.** A multi-GB upload plus extracted audio
  plus a same-or-larger render can transiently need a lot of temp space.
- **macOS only so far.** Nothing is knowingly platform-specific, but nothing
  else has been tried.

---

## Decisions worth not re-litigating

| Decision | Why |
|---|---|
| OpenCV **SFace** for face recognition, not InsightFace | Already inside the installed OpenCV (no new dependency), Apache-2.0 vs a non-commercial-research-only model licence that conflicts with this being MIT and public. 99.6% vs 99.8% LFW is irrelevant for four people in fixed chairs. The transferable idea from Immich — embed, then DBSCAN — is what was adopted. |
| **Person ids**, not diarisation speakers, across the API | The UI resolves who is on screen; the render pipeline never reasons about anonymous voice clusters. Removes a whole class of "which id is this?" bugs. |
| **One `/process` endpoint**, not two parallel ones | Two endpoints each took the file, so the browser uploaded the same recording twice — 10GB for a 5GB file. |
| **Stream-copy audio**, re-encode only as fallback | Audio is never edited, so paying a generation of loss for it was pure waste. Source is almost always already AAC. |
| Framing constants **measured from real edits** | Guessing produced the tight, face-centred crop that looked wrong on seated subjects. |
| **No cap on speakers** | Four-person podcasts are normal. What adapts is the layout (2 → split, 3+ → speaker-focus), not the guest list. |

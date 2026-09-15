# Status — where this project actually is

One page, current as of this branch. For *how* things work see
[ARCHITECTURE.md](ARCHITECTURE.md); for the design reasoning behind the
export phase see [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) and
[UX_PRD.md](UX_PRD.md).

---

## What works end to end, today

Drop in a recording and you get an edited MP4 out. The whole loop runs
locally, nothing is uploaded anywhere. `npm run dev` starts everything, and a
setup screen covers the one-time Hugging Face token.

1. **Upload** — click or drag-and-drop, with real byte-level progress.
2. **Process** — one upload feeds transcription, speaker diarisation,
   optional overlapping-speech detection, and face recognition. Per-stage
   progress is polled and shown while it runs.
3. **Cast** — name each recognised person once. Voices are already matched to
   faces by lip-sync, so this is a confirmation with the uncertain ones
   flagged, not a grid of anonymous voices to work out by ear.
4. **Edit** — the transcript with real names beside a live preview that uses
   the same framing maths as the export, and a timeline of framing regions
   (close-up, both on screen, wide) whose edges can be dragged independently
   of turn boundaries.
5. **Publish** — a real MP4: hard cuts where the framing changes, medium-shot
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

**Checks:** 119 backend tests passing, `tsc` clean, `oxlint` clean (two
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

Re-planned on 2026-09-15 from the product owner's side, after the first real
recordings ran through the whole pipeline. Ordered by the customer problem each
item solves, not by feature or effort. This is the source of truth for
ordering; [ARCHITECTURE.md](ARCHITECTURE.md)'s Roadmap mirrors it.

### Where things stand

- **Speaker diarisation, voices and faces both: done.** This sat at #1 here as
  unfinished; lip-sync plus Hungarian matching (`lipsync.py`, `fuse.py`) closed
  it. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Smarter cutting (dead air, filler words): done**, as an opt-in export
  option. Vary shot length stays deferred: no testable target without a real
  edit to compare against.
- **Real footage so far.** A 6-minute iPhone recording surfaced two bugs, both
  fixed: a missing Hugging Face token was only caught mid-job, and lip-sync
  crashed on the recording's last window while the app reported it as "Could
  not reach the local processing service" (ARCHITECTURE.md bugs #15 and #16).
  A 47-minute, four-person iPhone recording then processed end to end on the
  fixed code: all three stages finished and four people were found. How editing
  and export went on it hasn't been written up yet.
- **The host test still hasn't happened.** A host is lined up within two weeks.

### How progress is measured

No usage data is collected (local-first is the premise), so every measure
comes from test sessions:

- **North Star (proposed):** episodes a host would publish without asking for
  help.
- **Supporting measures:** runs on real recordings that finish; time from
  opening the app to the first export; share of framing decisions the editor
  changed (already recorded per region in `decisions.jsonl` as `source`).
- **Capacity rule:** roughly 80% new build, 20% fixes found by real footage.
  Two of the last four commits were such fixes, and longer recordings will
  find more. If fixes pass 40% of a cycle, new features stop until they're
  paid down.

### Next: the desktop app, then one host test

The founder's call on 2026-09-15 is the desktop app before any host sees the
product. (The recommendation was the host test first; the decision was app
first.) One risk to watch: the app is the largest item here, and the host is
free within two weeks.

1. **Processing that survives closing the window, and saved episodes.** Today
   a whole job lives inside one browser request, so closing or refreshing the
   tab loses up to an hour of work, and nothing about an edited episode is
   saved. Jobs move to the background with results saved to disk, and an
   episode reopens without reprocessing. The desktop app needs this anyway.
   - Problem: a long recording can't be processed reliably.
   - Evidence (founder, testing): "the localhost stopped again midway".
   - Measure: runs that finish.
2. **The desktop app (.dmg).** No terminal, `uv` or `ffmpeg` install. It reads
   the recording where it is instead of copying a 3 GB file into the service,
   renders to a folder instead of holding the whole MP4 in browser memory, and
   can use native notifications. Costs: an Apple Developer account for signing
   and notarisation, a 2 to 3 GB download, Apple Silicon in practice, and care
   with `ffmpeg`'s licence.
   - Problem: getting it running needs a terminal.
   - Evidence (founder): "make the tool in a way that the user does not have
     to leave the env in anyway".
   - Measure: time from opening the app to the first export.
   - **Licence check, done 2026-09-15.** `pyannote` community-1 is CC-BY-4.0,
     and every file the pipeline loads (segmentation, embedding, PLDA, config)
     is in that one repo. The Hugging Face gate is an automatic form that asks
     for contact details and a use case; its own text says the pipeline is
     CC-BY-4.0 and will stay freely accessible. It adds no licence term.
     CC-BY-4.0 allows redistribution with attribution, so the app can ship the
     weights, credit pyannote with a link to the licence, and drop the Hugging
     Face step entirely. This is a reading of the licence, not legal advice:
     confirm before release. The Whisper, YuNet/SFace and LR-ASD weights need
     the same check.
3. **Waiting that keeps people.** A notification when processing finishes, a
   live video preview that follows the transcript, a time estimate weighted by
   how long each stage really takes (on the 47-minute run, faces finished well
   before the transcript, and matching runs last), and visible progress for
   the first-run model downloads. Small, and fits alongside item 2.
   - Problem: a 35 to 40 minute wait with nothing to do.
   - Evidence (founder): "keep the users hooked instead of them coming back in
     an hour or so or maybe not returning at all".
   - Measure: runs that finish and then get opened.
4. **Host test, unassisted, with the app.** The milestone this project has
   always been sequenced against, now combined with the setup question
   [BUSINESS_MODEL.md](BUSINESS_MODEL.md) names: can a non-technical host
   install it, process their own episode, and get an edit they'd publish
   without help? If the app isn't ready inside the host's window, run the
   session on the founder's machine instead and keep the unassisted install
   for the next one. This is where the first real customer quotes come from,
   and everything below needs them.

### Then, ordered by what the host test shows

- **Batched processing for long recordings**, if the wait loses people. The
  hard part isn't cutting the file into chunks; it's keeping voice and face
  identities consistent across them.
- **Editor speed** (undo, keyboard shortcuts, a review queue you can step
  through), if fixing an edit feels slow. Today dragging a shot overwrites its
  neighbours and "Reset to suggested" is the only way back.
- **Text-based editing** (delete words in the transcript to cut them), if
  hosts want to cut content and not just framing. Word-level timings already
  exist.
- **Per-instant face visibility and crop smoothing**, if framing gets
  complaints. See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) item 6b.
- **The 3-pane cap**, decided with feedback from a real four-person show. See
  DESIGN_SYSTEM.md's open questions.
- **Real render progress.** The desktop app removes the re-upload on export;
  the render itself still reports nothing while it runs.
- **Landing page, and renaming the repo to Cutroom**, once the app exists, so
  the download button is true.

### Parked, with the reason

- **Jargon info-text annotations**: novel, but no evidence anyone needs them
  yet.
- **Audio effects, intro/outro presets**: no problem evidence yet.
- **Style learning from corrections**: needs repeat editors making repeat
  corrections. The `decisions.jsonl` data keeps being captured meanwhile.
- **Automatic social clips**: revisit after the host test. Publish already
  shows them as unbuilt.
- **Smoothing as a standalone layer**: folded into the framing item above.

### Cut from this horizon

- **Voice ducking for overlapping speech**: a source-separation research spike
  nobody has asked for.
- **Multi-camera support**: single camera is the whole positioning, and
  multi-track tools already serve that case better (see
  [MARKET_RESEARCH.md](MARKET_RESEARCH.md)).
- **Docker one-command setup**: replaced by the desktop app. Two install paths
  would be double the work.

### Separate passes, not roadmap items

- ~~**Visual design language**~~: done. See
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
- **Public-release readiness**: CI, cross-platform checks, CONTRIBUTING.md, a
  demo GIF. (Docker setup is cut above.)
- **Agent-friendly fixture mode**: a way to load canned state into the editor
  without walking the whole upload flow. Still worth doing.

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

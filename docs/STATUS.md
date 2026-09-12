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
3. **Cast** — name each recognised person once, then match each distinct
   voice to a person by listening to a sample of what they actually said.
4. **Edit** — turn-by-turn transcript with real names, a live preview that
   uses the same framing maths as the export, per-turn layout override
   (wide / single / multi-person) and per-turn correction of who is on
   screen.
5. **Export** — a real MP4: hard cuts at turn boundaries, medium-shot
   framing, multi-person composites, source resolution preserved, original
   audio stream-copied.

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
1. **Run a full episode end to end and show it to a podcast host.** The epic
   sequenced everything against this and it has never been done — the
   longest run so far is a 5-minute cut. It is the only thing that can tell
   us whether the edit decisions are actually good, as opposed to
   technically correct.

### Then, informed by that
2. **Smarter cutting** — trim dead air and filler words, vary shot length so
   the edit doesn't feel metronomic. The epic's "decision quality before
   decoration" principle puts this ahead of everything below.
3. **Captions** — done. ASS captions burned in at export from the Whisper
   word timestamps already being produced (`pysubs2`), grouped into cues by
   pause length and a max line length rather than inheriting a turn's
   (much coarser) boundaries. Toggleable per export. Cue-grouping logic has
   unit tests; the ffmpeg burn-in step itself hasn't been run against a real
   recording yet (see Known limitations).
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
10. **Automatic speaker-to-face matching** — the hard one, still correctly
    deferred. The cast step now takes under a minute, so the payoff shrank.
11. **Multi-camera support, desktop packaging (Electron).**

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
- **Overlap detection is optional** and needs a free Hugging Face token.
  Without it everything still works; the multi-person composite just has no
  automatic trigger (a manually forced Split still works).
- **Diarisation is voice-clustering, not perfect.** It can mis-assign a
  turn, and only finds speakers who actually speak in the window analysed.
  This is why per-turn correction exists in the editor.
- **No automated frontend tests.** Backend has 23; the frontend is verified
  by typecheck, build, and real browser sessions.
- **Captions haven't been rendered against a real recording.** The word-to-
  cue grouping is unit-tested, and the export pipeline wiring (ffmpeg's
  `ass` filter, form fields, dependency install) has been verified to
  import and build cleanly, but there is no test recording in this
  environment to run an actual export against and check the burned-in
  result looks right.
- **Never run on a full-length episode.** Longest verified run is 5 minutes.
  Expect ~10-12 minutes of processing for a 53-minute episode; untested.
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

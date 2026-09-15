# Features

Every feature, what it does for the person using it, and where it stands
today. For *why* each one works the way it does, see
[ARCHITECTURE.md](ARCHITECTURE.md) (system design) and
[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) (export/framing
design). For measured accuracy and performance numbers, see
[STATUS.md](STATUS.md) — this doc doesn't repeat those, it points to them.

| # | Feature | Status |
|---|---|---|
| 1 | [Upload](#1-upload) | Shipped |
| 2 | [Processing (transcription, diarization, face detection)](#2-processing) | Shipped |
| 3 | [Automatic casting (face recognition + voice matching)](#3-automatic-casting) | Shipped |
| 4 | [Auto-framing (zoom / split-screen)](#4-auto-framing) | Shipped |
| 5 | [Overlap detection](#5-overlap-detection) | Shipped |
| 6 | [Editor](#6-editor) | Shipped |
| 7 | [Export](#7-export) | Shipped |
| 8 | [Burned-in captions](#8-burned-in-captions) | Shipped |
| 9 | [Decision logging](#9-decision-logging) | Shipped, unused so far |
| 10 | [Text/bubble annotations](#10-text-bubble-annotations) | Stub |
| 11 | [Voice ducking for overlapping speech](#11-voice-ducking) | Not started |
| 12 | [Style learning from corrections](#12-style-learning) | Not started |
| 13 | [Automatic social clips](#13-automatic-social-clips) | Not started |
| 14 | [Multi-camera support](#14-multi-camera-support) | Not started |
| 15 | [Desktop packaging](#15-desktop-packaging) | Not started |

---

### 1. Upload

Drag a recording onto the page, or click to browse. Shows real upload
progress (actual bytes sent, not a spinner) because uploads of a multi-GB
recording can take a while and a static "uploading…" message is
indistinguishable from a hung app.

Accepts any video or audio file the browser will hand over — no format
restrictions beyond what your recording device produced.

*Implementation:* `src/features/upload/UploadScreen.tsx`.

### 2. Processing

One upload feeds transcription, speaker diarization, and face detection at
once (they used to be two separate uploads of the same file — fixed, see
[ARCHITECTURE.md](ARCHITECTURE.md)'s `/process` endpoint notes). A
progress screen shows each stage — extracting audio, transcribing,
identifying speakers, detecting faces — with a real fraction complete for
each, polled from the server while it runs.

Measured: roughly a fifth of the recording's real length, end to end, on a
laptop CPU; faster with a GPU. See
[STATUS.md](STATUS.md#measured-not-asserted) for exact numbers.

*Implementation:* `src/features/upload/ProcessingScreen.tsx` (frontend),
`server/pipeline/transcribe.py` + `diarize.py` + `faces.py` (backend).

### 3. Automatic casting

The hardest part of this problem — figuring out who's on screen and who's
talking, from a single mixed-audio, single-camera recording with no
per-speaker isolation — is mostly automatic now:

- **Face recognition:** faces are detected, tracked across the video, and
  *recognized* — so the same person showing up in different tracks (they
  turned their head, left frame and came back) collapses into one person,
  not one entry per fragment.
- **Automatic voice-to-face matching:** a lip-sync model works out which
  face is talking at any given moment; that gets matched against the
  diarized voices, so each voice is already assigned to a person before you
  see the screen.

What's left for the person using it is a confirmation step: name each
recognized person once, and fix any match the system flagged as uncertain.
That's a big change from the original design, where every voice had to be
matched to a face by ear — see [STATUS.md](STATUS.md) for the measured
before/after.

*Implementation:* `server/pipeline/faces.py` (detection/tracking/
recognition), `lipsync.py` (who's talking, from lip movement),
`fuse.py` (matching voices to faces), `src/features/faces/CastScreen.tsx`
(the confirmation UI).

### 4. Auto-framing

Three ways to show a turn, computed live from real detected face positions
and kept in sync with playback — not a fixed template:

- **Original** — the untouched wide shot.
- **Zoom** — a medium shot on whoever's talking, framed the way a
  professional podcast edit actually frames a seated subject (measured from
  real reference edits, not guessed — see
  [STATUS.md](STATUS.md#measured-not-asserted)).
- **Split** — a real multi-person composite, up to three people tiled
  side by side, for turns where more than one person needs to be on
  screen.

Layout is chosen automatically per turn (single speaker → Zoom, overlapping
speech → Split) and can be overridden per turn in the editor.

*Implementation:* `src/lib/faceCrop.ts` (live preview math),
`server/pipeline/framing.py` + `render.py` (export render math — same
formulas, kept in sync deliberately).

### 5. Overlap detection

A visual flag on the transcript wherever more than one person is talking at
once — independent of what layout is currently chosen for that stretch.
This is what actually decides when Split gets suggested automatically, and
it's a *visual* signal only: it doesn't touch audio (see
[#11](#11-voice-ducking) for why that's a separate, unsolved problem).

*Implementation:* part of the diarization pass in
`server/pipeline/diarize.py` — community-1 finds overlapping speech in the
same pass that identifies speakers, rather than needing a second model.

### 6. Editor

A turn-by-turn transcript, with real names (not anonymous speaker IDs), a
live video preview using the exact same framing math the export will use, a
per-turn layout override, and a per-turn fix for who's actually on screen
(diarization occasionally gets a turn wrong; this is the one-click
correction for that).

*Implementation:* `src/features/timeline/EditorView.tsx`.

### 7. Export

Renders a real MP4: hard cuts at turn boundaries, the medium-shot framing
from [#4](#4-auto-framing), real multi-person composites, source resolution
preserved, and the original audio stream-copied (not re-encoded — a
podcast's audio is never actually edited, so there's no reason to pay a
quality-loss generation for it). Verified frame-accurate and duration-exact
against real footage — see [STATUS.md](STATUS.md#measured-not-asserted).

*Implementation:* `server/pipeline/render.py`, `POST /export` in
`server/main.py`.

### 8. Burned-in captions

Optional captions rendered directly into the video, cut from Whisper's
word-level timestamps rather than the coarser turn boundaries — so caption
timing tracks actual speech, not just which turn it's part of. Needs an
`ffmpeg` build with `libass` (most default installs don't have this — see
[README.md](../README.md)'s Setup section); export checks for this up
front and refuses with the fix rather than silently producing a video with
no captions after a long render.

*Implementation:* `server/pipeline/captions.py`.

### 9. Decision logging

Every successful export writes a `decisions.jsonl` log of the layout
choices made for that episode (which turns got Zoom vs Split, and any
manual corrections). Not surfaced anywhere in the UI yet — it exists so
that if a future feature wants to learn from repeated manual corrections
(see [#12](#12-style-learning)), the data already exists rather than
needing to be built retroactively.

*Implementation:* `_log_decision()` in `server/main.py`, written to
`server/logs/<session_id>/decisions.jsonl` (gitignored).

### 10. Text/bubble annotations

The button exists in the editor and explains why it's disabled. No backend
support yet. Scoped as a later roadmap item — see
[STATUS.md § What's left](STATUS.md#whats-left).

### 11. Voice ducking

Lowering one person's audio so another's is clearer during overlapping
speech. Deliberately not scoped yet: isolating one voice from a single
mixed track (no per-speaker isolation, same constraint that makes the rest
of this project hard) is a genuinely open source-separation research
problem, not an engineering checkbox. Gated on a research spike, not on
priority.

### 12. Style learning

The idea: if a future editor repeatedly makes the same kind of correction
(e.g. always overriding Split back to Zoom in a particular situation),
learn from that pattern instead of asking every time. Gated on there being
evidence of repeat editors making repeat corrections — the data collection
for this already exists ([#9](#9-decision-logging)), the learning doesn't,
and building it before there's a pattern to learn from would be guessing.

### 13. Automatic social clips

Auto-selecting short, shareable clips from a full episode. Planned to use
an offline scoring heuristic (pace, silence, turn density) rather than a
cloud LLM call, to stay consistent with the local-first design. Not
started.

### 14. Multi-camera support

Cutting between multiple camera angles, not just one fixed frame. Noted as
a stretch goal from the start of the project; not begun.

### 15. Desktop packaging

Wrapping this as a standalone desktop app (e.g. via Electron) instead of
"run two local services and open a browser tab." The architecture already
supports this without a rewrite — the frontend only ever talks to
`localhost` over HTTP, so where that service actually runs doesn't change
anything about how the frontend is built. Not started.

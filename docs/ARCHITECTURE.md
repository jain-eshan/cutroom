# Podcast Editor — Project Documentation

Everything about this project in one place: the plan, what's actually built,
how it's architected, every dependency and why it's there, and what's still
missing. Written for whoever picks this up next — including future you.

- [The Plan](#the-plan)
- [What's Built](#whats-built)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Frontend Structure](#frontend-structure)
- [Backend Structure](#backend-structure)
- [Dependencies](#dependencies)
- [Setup / Local Dev](#setup--local-dev)
- [Known Limitations](#known-limitations)
- [Decisions & Bugs Worth Knowing About](#decisions--bugs-worth-knowing-about)
- [Roadmap](#roadmap)

---

## The Plan

**The problem:** editing a podcast video well — zooming to whoever's
talking, splitting the screen when two people talk over each other, cutting
between speakers cleanly — is manual, repetitive work. Existing tools that
do this (Riverside's Smart Reframe, Descript, Opus Clip) either require a
specific recording setup or are closed-source SaaS.

**The specific case this targets:** a single camera angle, multiple people
in one frame, one mixed audio track — not a multi-track recording where
each speaker already has an isolated mic and camera. That's the harder
version of the problem: you can't just check "which track has signal" to
know who's talking, and you don't know *where* that speaker is on screen
without figuring it out from the video itself. This was a deliberate choice
early on — the person building this doesn't have a multi-track setup, and
felt that most people who do wouldn't need this tool.

**The approach**, decided before any code was written:

1. Don't try to fully automate speaker-to-face matching from day one. That's
   a real computer-vision research problem (audio-visual active speaker
   detection — matching lip movement to who's making sound). Instead: detect
   faces automatically, but have a human do one 30-second labeling step per
   episode ("this face is Speaker 1"). Everything downstream is then
   automatic. This was the single highest-leverage scope cut in the whole
   plan — it turns a hard ML problem into an easy one.
2. Post-production only. This tool does not record anything — bring your
   own recording (Zoom, a phone, whatever), this only edits it. Building a
   reliable multi-party recorder is its own huge project already solved by
   other tools; the actual value here is the auto-editing intelligence.
3. Local-first. Transcription, diarization, and face detection all run on
   your own machine via a small local service, not a cloud API. Nothing
   about a podcast recording gets uploaded anywhere. This also keeps the
   project free to self-host.
4. Ship in phases, each one independently real and verified — not a big
   upfront design followed by a big-bang implementation. See below for
   what "verified" meant in practice (every backend piece was tested three
   ways: a direct function call, a raw HTTP request, and a real browser
   session driving a real file upload).

**What this project is not:** a fork of [Recordly](https://github.com/webadderallorg/recordly)
(an open-source screen recorder that this project's UI conventions took
inspiration from). Recordly's core "auto-zoom" is driven by cursor/click
activity on a screen recording — a completely different signal from
"zoom to whoever is talking in a multi-person video." No Recordly code was
copied in; only the general shape of a React + Vite editor UI with a
timeline and an export step was used as a reference point.

---

## What's Built

| Phase | Status | What it does |
|---|---|---|
| **1 — Transcript + speaker turns** | ✅ Done | Upload a video → get a speaker-labeled, timestamped, turn-by-turn transcript |
| **2 — Face *recognition* + cast setup** | ✅ Done | Detects faces, embeds them (SFace) and clusters identities (DBSCAN) so one person is one person rather than one track per head-turn; one-time "cast" screen to name everyone and match each voice to a person using audio evidence |
| **3 — Editor shell** | ✅ Done | Per-turn layout override (Original / Zoom / Split). All three are real, including a live multi-speaker composite preview for Split. Annotations remain a stub |
| **4 — Real export + multi-speaker framing** | ✅ Done | `POST /export` renders an actual MP4: hard cuts at turn boundaries, bust-shot zoom, a real up-to-3-pane composite for overlapping/forced-split turns, gapless duration-complete timeline, original audio preserved. See [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) and [UX_PRD.md](UX_PRD.md) for the full design |
| **5 — Stretch goals** | ⬜ Not started | Automatic speaker-to-face matching (no manual labeling step), multi-camera-angle support, desktop packaging, captions, jargon annotations |

Nothing here is faked to look more finished than it is — every placeholder
in the UI says so explicitly (e.g. "Split-screen preview — coming in a
later phase").

---

## Architecture

Two pieces: a browser-based frontend, and a local processing service it
talks to over HTTP. No cloud, no database, no accounts.

```
┌──────────────────────────────┐     HTTP (localhost:8787)    ┌───────────────────────────────────┐
│   Frontend (React + Vite)     │ ───────────────────────────▶│  Processing service (FastAPI)     │
│   localhost:3460              │◀─────────────────────────── │  Python, runs locally             │
│                               │        JSON responses        │                                   │
│  1. UploadScreen              │                              │  POST /process   (ONE upload)     │
│     — pick / drop a file      │                              │    extract audio (ffmpeg)         │
│                               │                              │    ├─ transcribe (faster-whisper) │
│  2. ProcessingScreen          │ ──── GET /progress/{id} ───▶ │    │  + diarize (resemblyzer)     │
│     — real upload bytes,      │                              │    │  + overlap (pyannote, opt.)  │
│       per-stage progress      │                              │    └─ faces: detect (YuNet)       │
│                               │                              │         → track (IOU)             │
│  3. CastScreen                │                              │         → embed (SFace)           │
│     — name each person        │                              │         → cluster ids (DBSCAN)    │
│     — match each VOICE to a   │                              │                                   │
│       person, with audio      │                              │  POST /export                     │
│                               │                              │    build gapless segments         │
│  4. EditorView                │                              │    → frame each person (framing)  │
│     — turn list w/ names      │                              │    → one ffmpeg filter_complex    │
│     — per-turn person fix     │                              │    → mux original audio (copy)    │
│     — live preview = export   │                              │                                   │
└──────────────────────────────┘                              └───────────────────────────────────┘
```

The frontend resolves *who is on screen* (diarisation suggests it, the user
corrects any turn) and sends **person ids** to `/export`. The render
pipeline never sees a diarisation speaker.

**Why a separate local service instead of doing everything in the
browser:** transcription, diarization, and face detection all need real
compute (ML models) that a browser tab can't reasonably run. Rather than a
cloud API (costs money, requires accounts, sends a user's recording
somewhere else), this runs a small FastAPI service on `localhost` that the
frontend calls like any other API. It's the same pattern Recordly itself
uses for its own local media server — and it means wrapping this in
Electron for a desktop build later is a small step, not a rewrite (the
frontend already only talks to `localhost` over HTTP; where that service
runs doesn't change).

**Data flow for a single upload**, end to end:

1. User picks a file in `UploadScreen`.
2. `App.tsx` calls `transcribe(file)` and `detectFaces(file)` **concurrently**
   (`Promise.all`) — both endpoints independently accept the same file,
   each extracting what they need from it.
3. `/transcribe`: ffmpeg pulls a mono 16kHz WAV out of the video → Whisper
   transcribes it with word-level timestamps → the same WAV is diarized
   (who's talking, when, as anonymous "Speaker 0/1/2...") → word timestamps
   and diarization segments are merged into dialogue **turns**
   (`{speaker, start, end, text}`).
4. `/detect-faces`: sample video frames roughly once a second → run a face
   detector on each → link detections across frames into persistent
   **tracks** by bounding-box overlap → return each track's best thumbnail
   plus its bounding box at every sampled timestamp.
5. Frontend now has turns (who said what, when) and face tracks (which
   face, where, when) — but **no link between them yet**. That's what
   `SpeakerLabelingScreen` collects: the user matches each face thumbnail
   to a "Speaker N" from the transcript, a `Record<trackId, speakerId>`
   that `App.tsx` inverts into `Record<speakerId, trackId>` for lookup.
6. `EditorView` can now, for any turn, look up which face track its
   speaker maps to, find that track's bounding box nearest the turn's
   start time, and compute a CSS `transform` that zooms the `<video>`
   element in on that box — a live, real preview of the "auto-zoom to
   whoever's talking" feature, without needing a full render pipeline yet.

---

## API Reference

Both endpoints live in [`server/main.py`](../server/main.py). CORS is
locked to `http://localhost:3460` / `http://127.0.0.1:3460` (the frontend's
dev server origin).

### `GET /health`

Returns `{"status": "ok"}`. Used to check the service is up before hitting
it with real work.

### `POST /transcribe`

**Request:** `multipart/form-data` with a `file` field (the video/audio
file). Optional query param `num_speakers` (int) to force a known speaker
count instead of letting diarization estimate it.

**Response:**

```json
{
  "turns": [
    { "speaker": 0, "start": 0.0, "end": 5.16, "text": "Welcome back to the show..." },
    { "speaker": 1, "start": 5.32, "end": 12.38, "text": "Thanks for having me..." }
  ]
}
```

`speaker` is a 0-indexed anonymous integer from diarization — it has no
identity until the labeling step links it to a face.

### `POST /detect-faces`

**Request:** `multipart/form-data` with a `file` field.

**Response:**

```json
{
  "frameWidth": 640,
  "frameHeight": 480,
  "tracks": [
    {
      "id": 0,
      "thumbnail": "data:image/jpeg;base64,...",
      "keyframes": [
        { "t": 0.0, "bbox": { "x": 346, "y": 186, "width": 284, "height": 291 } },
        { "t": 1.0, "bbox": { "x": 344, "y": 184, "width": 286, "height": 290 } }
      ]
    }
  ]
}
```

`frameWidth`/`frameHeight` are the source video's native pixel dimensions —
the frontend needs these to convert a pixel `bbox` into a percentage-based
CSS `transform-origin`. `id` is a per-request track identity (not stable
across separate uploads of the same video). `keyframes` is one entry per
sampled frame the track appeared in (~1/sec by default).

### `POST /process`

**Request:** `multipart/form-data` with `file`, optional `num_speakers`, and
optional `jobId` (enables progress reporting).

**Response:** `{ turns, overlapWindows, faces }` — transcript with speaker
turns, detected overlapping-speech windows, and the recognised people.

This replaced separate `/transcribe` and `/detect-faces` endpoints that the
frontend called in parallel. Because both took the file, the browser
uploaded the same recording **twice** — 10GB of transfer for a 5GB file.
One upload now feeds both, which run concurrently in threads (OpenCV and
CTranslate2 both release the GIL, so they genuinely overlap: 13s vs 16s
sequential on a 60s clip).

### `GET /progress/{job_id}`

Per-stage progress for a running job, polled by the UI. Returns
`{transcribe: {stage, fraction, done}, faces: {...}}`. In-memory and
process-local — this is a single-user local tool, so a dict is the whole
requirement.

### `POST /export`

**Request:** `multipart/form-data` — `file` (the source video, re-uploaded)
plus four JSON-encoded form fields: `layoutChoices` (per-turn layout
decisions, each carrying its own `start`/`end`), `overlapWindows` (from
`/transcribe`, `[]` if overlap detection isn't configured), `faces` (the
recognised people, **sent as a file part, not a form field** — Starlette caps
form fields at 1MB and a 53-minute episode's keyframes are 1.7MB, which made
every long-episode export fail with "Part exceeded maximum size of 1024KB"),
and `speakerToTrack` (`Record<speakerId, trackId>`). Optional `sessionId`
form field triggers `decisions.jsonl` logging on success.

**Response:** `video/mp4`, streamed from disk (`FileResponse`, not buffered
in memory — exports can be large), `Content-Disposition: attachment`.

Full design, including the render pipeline, crop math, and every decision
behind it: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md).

---

## Frontend Structure

```
src/
├── App.tsx                          # top-level state machine (see below)
├── lib/
│   ├── api.ts                       # typed fetch wrappers for all three endpoints
│   └── faceCrop.ts                  # bbox → CSS zoom transform math + pixel-space crop math
├── features/
│   ├── upload/UploadScreen.tsx      # file picker + real drag-and-drop (idle / error states)
│   ├── upload/ProcessingScreen.tsx  # upload bytes + per-stage progress
│   ├── faces/CastScreen.tsx         # name each person; match each voice to a person (with audio)
│   └── timeline/
│       ├── EditorView.tsx           # video preview + turn list + layout controls +
│       │                            # multi-speaker composite live preview + overlap indicator
│       ├── ExportButton.tsx         # real export flow (idle/exporting/done/error)
│       └── types.ts                 # `Layout` type (original/zoom/split)
```

**State machine** (`App.tsx`): a single `Status` union type drives which
screen renders — `idle → processing → labeling → editing` (or `error` at
any point during processing). No router, no global state library; this is
intentionally the simplest thing that works for a linear, single-page
flow. `Promise.all([transcribe(file), detectFaces(file)])` is the one
place both backend calls happen together.

**The zoom-to-speaker math** (`lib/faceCrop.ts`): given a face's bounding
box and the source frame's dimensions, computes a CSS `transform-origin`
(as a percentage, so it doesn't need to know the video element's actual
rendered pixel size) plus a `scale()` — using the standard "scale around a
fixed point, then translate that point to center" technique, clamped to
`max(1, ...)` so it never zooms out below the original frame and capped at
`3.5x` so a small detected face doesn't get blown up into a pixelated mess.
Scale is chosen via `Math.max(frameWidth/paddedW, frameHeight/paddedH)` —
"cover" behavior (fills the viewport, crops any excess) rather than "contain"
(would letterbox), matching how video reframing tools like Riverside's
typically behave.

**A non-obvious React bug worth knowing if you touch `EditorView`:** the
video's `blob:` object URL is created *inside* a `useEffect`, not via
`useMemo`. That's deliberate — under React 19 `StrictMode`'s dev-mode
mount→cleanup→mount double-invoke, a `useMemo`-cached URL gets revoked by
the first simulated cleanup and never recreated, silently breaking video
playback (Chromium reports `MEDIA_ELEMENT_ERROR: Format error`, which reads
like a codec problem but isn't one). Creating the URL inside the effect
means the double-invoke recreates a fresh URL each time, so the one
actually left assigned to `<video>` was never revoked. This produces one
`oxlint` warning (`react/set-state-in-effect`) that's correct to ignore
here — see the comment in `EditorView.tsx`.

**The multi-speaker composite preview** (`EditorView.tsx`'s `CompositePane`)
renders N separate `<video>` elements (same `src`, one per visible speaker)
rather than compositing crops of a single element — a browser can't show two
different crops of the same `<video>` at once. Two things worth knowing if
you touch this: (1) the pane container is measured with a callback ref, not
a plain `useRef` + `useEffect([])`, because the composite only mounts
conditionally (once a turn is set to Split) — a plain ref/effect pair only
ever fires for what exists at the *component's own* mount time and silently
never re-attaches later (see `ARCHITECTURE.md`'s bugs log, #10). (2) Keeping
the panes in sync with the primary "driver" video is one idempotent
`sync()` function reacting to `timeupdate`/`seeked`/`play`/`pause` on the
driver, not separate handlers per concern — splitting time-correction and
play/pause into separate listeners let them race each other (#11).

---

## Backend Structure

```
server/
├── main.py                    # FastAPI app, all HTTP endpoints
├── pipeline/
│   ├── audio.py                # ffmpeg: extract mono 16kHz WAV from any video/audio file
│   ├── transcribe.py           # faster-whisper: word-level timestamped transcript
│   ├── diarize.py              # resemblyzer + clustering ("who's talking when") +
│   │                            # pyannote.audio overlap detection (needs HF_TOKEN)
│   ├── turns.py                # merge transcript + diarization into dialogue turns
│   ├── faces.py                 # OpenCV YuNet + IOU tracking: face detection/tracking
│   └── render.py                # /export's render pipeline: segment construction,
│                                 # bust-shot/composite crop math, ffmpeg orchestration
├── tests/
│   └── test_render.py           # render.py's crop-math parity + segment-construction edge cases
├── logs/
│   └── <session_id>/decisions.jsonl  # written by /export on success, gitignored
└── .models/
    └── face_detection_yunet.onnx   # committed directly (232KB — small enough, avoids a download step)
```

**`diarize.py`** — there's no per-speaker audio track to lean on (single
camera, one mixed track), so this diarizes by voice: `resemblyzer`'s
`VoiceEncoder.embed_utterance(..., return_partials=True)` gives a voice
embedding for each sliding window of the audio; those get clustered
(`AgglomerativeClustering`, cosine distance) into speaker groups. If the
number of speakers isn't given, it's estimated by trying a range of
cluster counts and picking whichever gives the best silhouette score.
Consecutive same-cluster windows get merged into speaker segments.

**`turns.py`** — walks Whisper's word-level output, looks up which speaker
segment covers each word's timestamp, and merges consecutive words from
the same speaker into a turn. A turn also breaks on a pause longer than
`max_gap` (default 2s) even from the same speaker, so a long monologue with
pauses doesn't become one unreadable multi-minute block.

**`framing.py`** — how a person is framed inside a pane. The constants are
measured, not guessed: frames from three professional podcast edits, run
through this project's own face detector, put a single-speaker shot at
**3.5x face height with the face 0.32-0.39 down the frame**. The original
implementation cropped at ~2.5x and centred the face vertically, which is
what made zoomed shots look like tight head shots rather than edits —
especially for seated subjects, where the chair and body are part of the
composition. Looser framing also crops a bigger region, so upscale dropped
from 3.5x to 2.6x: the "weird framing" and the "soft picture" complaints had
a single cause.

**`faces.py`** — samples frames at a fixed interval (default 1/sec, via
OpenCV's `VideoCapture`), runs `cv2.FaceDetectorYN` (the YuNet model) on
each sampled frame, and links detections into tracks with simple greedy
IOU matching, then **recognises identities** so fragments of one person
collapse into one person. A detection matches an existing track if its
bounding box overlaps that track's last-seen box above a threshold (0.3);
otherwise it starts a new track. A track closes out if unmatched for more
than `max_gap_s` (default 3s) — handles someone leaving frame without
merging them into whoever enters later. No face-recognition/identity model
is used anywhere in this pipeline, deliberately: that would be solving a
harder problem than the one 30-second manual labeling step already solves
well enough.

**`render.py`** — builds a gapless, duration-complete list of `RenderSegment`s
covering the entire source video (turns, overlap windows, *and* the pauses
between turns, so the output stays time-aligned with the untouched source
audio), then renders it as one `ffmpeg` invocation: one `filter_complex`
graph with a `trim`+`crop`+`scale` chain per segment, concatenated, muxed
with the source audio. The multi-speaker composite is N per-pane crops
`hstack`ed together, capped at 3 panes. Full design, including why each
piece works the way it does: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md).

---

## Dependencies

### Frontend (`package.json`)

| Package | Why |
|---|---|
| `react` / `react-dom` 19 | UI framework |
| `vite` | dev server + build; matches the tooling this project's UI conventions were inspired by |
| `@tailwindcss/vite` / `tailwindcss` v4 | styling — v4's Vite plugin, no separate PostCSS config needed |
| `typescript` | type safety across the whole frontend, including the API response shapes |
| `oxlint` | linting — fast, Rust-based; caught a real bug during development (see below) |

Deliberately small. No router (single linear screen flow doesn't need
one), no state management library (one `useState` in `App.tsx` covers it),
no UI component library yet (plain Tailwind classes).

### Backend (`server/pyproject.toml`)

| Package | Why | Notes |
|---|---|---|
| `fastapi` + `uvicorn[standard]` | the HTTP service itself | |
| `python-multipart` | required by FastAPI for `UploadFile` form parsing | |
| `faster-whisper` | transcription with word-level timestamps | CTranslate2-based, not the original `openai-whisper` — much lighter (no PyTorch dependency for the transcription path itself) |
| `resemblyzer` | speaker diarization via voice embeddings | needs zero setup beyond `uv sync` — no HuggingFace account. Still used for the base speaker-segment clustering; `pyannote.audio` (below) is additive, for overlap detection only |
| `pyannote.audio` | overlapped-speech detection, for the multi-speaker composite's trigger signal | gated on a Hugging Face account + token (see Setup above) — the one place this project's zero-setup story has an opt-in exception, accepted because the composite feature has no other honest trigger signal (see `TECHNICAL_ARCHITECTURE.md` §1) |
| `python-dotenv` | loads `server/.env` for `HF_TOKEN` | |
| `scikit-learn` | clustering (`AgglomerativeClustering`, `silhouette_score`) for diarization | |
| `opencv-python-headless` | face detection (`FaceDetectorYN`/YuNet) and video frame sampling | **pinned `>=4.9,<5`** — see below, this bit us |
| `numpy` | array plumbing between the above | |
| `pillow` | image handling | pulled in for the face-detection work; not load-bearing beyond that |
| `setuptools<81` | **pinned** to keep `pkg_resources` available | `resemblyzer`'s dependency `webrtcvad` still does `import pkg_resources` at import time; recent `setuptools` (≥81) dropped it. Without this pin, the server fails to start with `ModuleNotFoundError: No module named 'pkg_resources'` |
| `pytest` (dev) | backend test suite (`server/tests/`) | |

**Face recognition model.** `cv2.FaceRecognizerSF` (SFace) ships inside the
`opencv-python-headless` already installed, so identity recognition needed no
new dependency — only the ~38MB ONNX weights, which download on first run
(gitignored, same pattern as the Whisper model). Chosen over InsightFace
`buffalo_l`, which is what Immich uses: 99.6% vs ~99.8% LFW accuracy is
irrelevant for telling apart four people in fixed chairs, while InsightFace
would add `insightface` + `onnxruntime`, 166-326MB of weights, and a
**non-commercial-research-only** model licence that conflicts with this
project being MIT and intended for public release. The transferable idea from
Immich — embed every face, then DBSCAN the embeddings into people — is what
was actually adopted; `scikit-learn` was already a dependency, so DBSCAN came
free.

**Not used, deliberately, despite being an obvious first choice:**

- **`mediapipe`** — tried first for face detection. Its Tasks API
  hard-crashes on this project's macOS setup with a native
  `DrishtiMetalHelper`/GPU-graph `Check failed: service_ Service is
  unavailable` error, even when explicitly forcing the CPU delegate. This
  is a native library issue unrelated to this project's code. Switched to
  OpenCV's YuNet detector instead, which has no such problem, needs no
  separate GPU service, and needed only a small (232KB) `.onnx` model file.
- **`openai-whisper`** — see `faster-whisper` above.
- **`ffmpeg-python` (or similar filter-graph wrapper)** — the export render
  pipeline builds `ffmpeg` `filter_complex` graphs as plain strings via
  `subprocess`, matching the existing pattern in `pipeline/audio.py`, rather
  than adding a wrapper dependency for something a plain string-building
  function handles fine.

**Known-benign runtime warning:** `pyannote.audio` pulls in `av` (PyAV),
which bundles its own `libavdevice`, and `opencv-python-headless` bundles
its own separate copy — both loading in the same process prints an
`objc[...] Class AVFFrameReceiver is implemented in both ...` warning on
macOS on startup. Tested directly (`cv2` face detection and `av` container
opens in the same process, back to back) and confirmed it does **not**
crash — different shape of collision than the earlier `mediapipe`/
`opencv-contrib-python` one below, which did corrupt the `cv2` namespace.
Noise, not a landmine, but worth knowing if it shows up in a stack trace
someday.

---

## Setup / Local Dev

Needs Node, [uv](https://docs.astral.sh/uv/), and `ffmpeg` on your PATH.

```bash
# frontend — http://localhost:3460
npm install
npm run dev

# processing service — http://localhost:8787 (separate terminal)
cd server
uv sync
uv run uvicorn main:app --port 8787
```

First run of the processing service downloads the Whisper model (`small`
by default, ~500MB) and the voice-embedding model (small, bundled via
`resemblyzer`) — both public, no account needed for transcription/diarization.

**Optional: overlap detection.** The multi-speaker composite needs to know
when two people are talking at once, which needs `pyannote.audio`'s
overlapped-speech-detection model — gated on Hugging Face. Without it,
export and the live preview still work, they just never trigger the
composite from a *real* overlap (a manually-forced Split still works via its
own fallback — see `TECHNICAL_ARCHITECTURE.md` §3.4). To enable it:

1. Create a token at https://huggingface.co/settings/tokens
2. Accept the model license at https://huggingface.co/pyannote/overlapped-speech-detection
3. Add `HF_TOKEN=<your token>` to `server/.env` (create the file — it's
   gitignored) and restart the service

---

## Known Limitations

- **Turn boundaries can be off by a word right at a speaker change** — an
  accuracy ceiling of window-based voice clustering, not a bug. Tightening
  this would mean boundary refinement or upgrading to `pyannote.audio`.
- **Face tracking is bounding-box-overlap based, not identity-based** — if
  two people's faces swap positions between sampled frames (unlikely in a
  static podcast shot, but possible with a moving camera), tracks could in
  theory get confused. Not observed in testing, but no face-recognition
  safety net exists to catch it. In practice, a track also fragments (splits
  into several short tracks for the same person) when detection misses a
  few consecutive frames — e.g. a hand near the face, a head turn. Cosmetic
  in the labeling UI (a few extra thumbnails to skip), not a correctness bug.
- **Overlap detection needs an optional Hugging Face token** — see Setup
  above. Everything else works without it.
- **No automated *frontend* test suite** — the backend now has one
  (`server/tests/`, `pytest`, covers the render pipeline's segment
  construction and crop-math parity with the frontend). The frontend is
  still verified manually (typecheck + build + real browser sessions against
  a real recording).
- **Track IDs aren't stable across separate uploads** — re-uploading the
  same video reruns detection from scratch; there's no caching or
  project-file concept yet (Recordly-style `.recordly` project persistence
  was noted as a nice-to-have, not built).
- **Diarisation cannot separate similar voices.** On a real four-person
  episode it found two speakers and 34 turns in 53 minutes. This is the
  current blocker — see [STATUS.md](STATUS.md)'s "What's left" for the
  measured comparison of the alternatives.
- **Overlap detection is broken on `pyannote.audio` 4** (the pipeline class it
  needs was removed upstream). It degrades to an empty list rather than
  failing `/process`.
- **Zooming into a wide shot is inherently soft.** Framing now matches
  professional practice (3.5x face height), which needs ~2.6x upscale on a
  1080p wide shot of four people — sharper than the 3.5x the old cap forced,
  but still upscaling. The real fix is source resolution: shooting 4K and
  delivering 1080p makes punch-ins genuinely sharp, because the crop then
  contains more real pixels than the output needs.
- **No pre-flight disk-space check for large exports** — a multi-GB upload
  plus its extracted audio plus a same-or-larger rendered output can
  transiently need significant temp disk space. Not guarded against.

---

## Decisions & Bugs Worth Knowing About

Real problems hit and fixed during development — kept here so nobody
re-discovers them the hard way.

1. **`mediapipe` → OpenCV YuNet.** See Dependencies above.
2. **OpenCV resolved a broken pre-release by default.** `opencv-python-headless`
   with no version constraint resolved to a `5.0.0.93` pre-release whose DNN
   backend silently returned zero face detections (no error — `detect()`
   just returned `None` for every image, including ones that plainly had
   faces). Pinned to `>=4.9,<5` (the stable line) and detection started
   working immediately.
3. **Float image data cast straight to `uint8` produced solid black
   test images.** Not a library bug — a real mistake made while building a
   synthetic test fixture from `sklearn`'s LFW face dataset (its image
   arrays are `float32` in `[0, 1]`, not `[0, 255]`). Caught by actually
   looking at the saved image rather than assuming the pipeline was broken.
4. **`setuptools<81` pin.** See Dependencies above — `pkg_resources`
   removal broke `resemblyzer`'s `webrtcvad` dependency at import time.
5. **Removing an unused dependency broke an unrelated one.** After
   dropping `mediapipe`, `cv2.FaceDetectorYN` started raising
   `AttributeError: module 'cv2' has no attribute 'FaceDetectorYN'` —
   `cv2` had become a broken namespace-package stub (`cv2.__file__` was
   `None`). This is a known OpenCV Python packaging issue: having both
   `opencv-python-headless` and `opencv-contrib-python` installed at once
   (the latter pulled in transitively by `mediapipe`) corrupts the shared
   `cv2` namespace package, and a plain uninstall doesn't fully repair it.
   Fixed with `uv sync --reinstall-package opencv-python-headless`.
6. **`useMemo` + blob URLs + React StrictMode.** See Frontend Structure
   above.
7. **A `gh` CLI account mix-up.** The very first `gh repo create` for this
   project landed under the wrong GitHub account (`isb-aac-moh` had
   silently become the active `gh` account partway through the session,
   not through any deliberate action). Fixed by switching the active
   account (`gh auth switch --user jain-eshan`) and recreating the repo
   correctly. The stray copy under the wrong account couldn't be deleted
   programmatically (the token lacks `delete_repo` scope, and granting it
   needs an interactive login) — worth checking `gh auth status` before
   any future `gh repo create` in a session with multiple logged-in
   accounts.
8. **`vite.config.ts` had no port set.** `npm run dev`, exactly as this
   README instructs, started Vite on its default `5173` — but the backend's
   CORS is hardcoded to `3460`, which every other doc assumed was automatic.
   Anyone following setup literally would've hit a silent CORS failure.
   Fixed by setting `server.port: 3460` in `vite.config.ts`.
9. **ffmpeg `concat` filter rejected segments with mismatched SAR.**
   Cropping a region whose dimensions aren't proportional to the source
   produces a slightly different sample aspect ratio per segment (even
   though all segments are `scale`d to the same pixel dimensions) — `concat`
   refuses to join video streams with different SAR. Fixed by appending
   `setsar=1` after every segment's final `scale` filter in `render.py`, so
   every segment normalizes to the same SAR before concatenation. Caught
   only by actually running the render on real crop data with a real
   overlap window, not by any unit test of the segment-construction logic.
10. **A `ResizeObserver` never attached because of a conditional-mount ref
    bug.** `EditorView`'s multi-speaker composite pane sizing used a plain
    `useRef` + `useEffect(() => {...}, [])` to measure its container —
    correct for an element that exists at first mount, wrong here, because
    the composite `<div>` only renders once a turn is set to Split. At the
    component's actual mount time the ref was `null`, the effect bailed
    immediately, and — since the dependency array never changes — never ran
    again once the div appeared later. Fixed with a callback ref (`useState`
    holding the DOM node, effect keyed on that state), which fires on every
    attach/detach rather than only at initial mount. Symptom before the fix:
    a solid black composite preview, no error, no console warning.
11. **Composite pane video sync raced itself.** Keeping N separate `<video>`
    elements in sync with a "driver" video used two independent mechanisms —
    a `timeupdate`-driven `currentTime` correction, and separate `play`/
    `pause` event listeners each calling `pane.play()`/`pane.pause()`. A
    `currentTime` write can itself interrupt an in-flight `play()`, so the
    two could race: a play-triggered `play()` call could lose to the very
    next timeupdate-triggered seek, leaving a pane stuck reporting `paused`
    while its time value kept getting corrected by seeks alone (visually
    close to working — updating every ~250ms instead of true 30fps — but not
    actually playing). Fixed by folding both concerns into one idempotent
    `sync()` function called from every relevant driver event, so each call
    corrects both drift and play state together instead of two separate
    handlers fighting each other.
12. **FastAPI silently treated `/export`'s form fields as query
    parameters.** A plain `str`-typed parameter on an endpoint that also
    takes an `UploadFile` is inferred as a query parameter unless it's
    explicitly wrapped in `Form(...)` — there's no multipart-form-data
    auto-inference the way there is for `UploadFile`/`File(...)`. Every
    request 422'd with "field required" pointing at `"loc": ["query", ...]`
    until each string field was declared `= Form(...)`. Only surfaced when
    actually calling the endpoint over real HTTP (via the browser) — direct
    Python-level calls into the render pipeline never touch FastAPI's
    parameter-binding layer at all.

---

## Roadmap

Roughly in order of what unlocks the most value next:

1. ~~**Export**~~ — done. `POST /export` renders a real MP4 with hard cuts,
   bust-shot zoom, and a real multi-speaker composite.
2. ~~**Split-screen, for real**~~ — done, both live preview (two synced
   `<video>` elements) and export (real ffmpeg composite, capped at 3 panes).
3. **The real-world test** — run an actual full episode through the
   pipeline and show it to a podcast host who edits manually. Everything
   built so far has been verified on short real clips and synthetic data;
   this is the test the whole roadmap has been sequenced against.
4. **Annotations** — text/bubble overlays per turn.
5. **Voice ducking for overlapping speech** — gated on a source-separation
   research spike; genuinely unresolved, not a checkbox (see
   `TECHNICAL_ARCHITECTURE.md`'s discussion of what overlap detection can
   and can't do).
6. **Automatic speaker-to-face matching** — remove the manual labeling
   step via audio-visual active speaker detection (matching lip movement
   to who's making sound). Genuinely harder than everything built so far;
   deliberately deferred until the manual-labeling version proves the rest
   of the concept out.
7. **Captions, jargon annotations, audio effects, intro/outro presets,
   automatic social clips** — later roadmap items, not yet started.
8. **Multi-camera-angle support, desktop packaging** — noted as stretch
   goals from the start; not begun.

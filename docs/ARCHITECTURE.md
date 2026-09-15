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
| **1 — Transcript + speaker turns** | ✅ Done | Upload a video → get a speaker-labeled, timestamped, turn-by-turn transcript. Diarization is `pyannote` community-1 (GPU-accelerated, overlap-aware in one pass), not the original resemblyzer clustering |
| **2 — Face *recognition* + automatic casting** | ✅ Done | Detects faces, embeds them (SFace) and clusters identities (DBSCAN) so one person is one person rather than one track per head-turn. An LR-ASD lip-sync model then works out which face is speaking when (`lipsync.py`), and Hungarian matching pairs each voice to a face (`fuse.py`). The cast screen starts pre-filled with these matches — naming people and confirming the flagged-uncertain ones, not building the map from scratch |
| **3 — Editor shell** | ✅ Done | Per-turn layout override (Original / Zoom / Split). All three are real, including a live multi-speaker composite preview for Split. Annotations remain a stub |
| **4 — Real export + multi-speaker framing** | ✅ Done | `POST /export` renders an actual MP4: hard cuts at turn boundaries, bust-shot zoom, a real up-to-3-pane composite for overlapping/forced-split turns, gapless duration-complete timeline, original audio preserved, optional burned-in captions cut from word-level timestamps. See [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) and [UX_PRD.md](UX_PRD.md) for the full design |
| **5 — Automatic voice-to-face matching + captions** | ✅ Done | Originally scoped as stretch goals — shipped ahead of schedule once the fused lip-sync/diarization design proved out. See STATUS.md for the measured accuracy |
| **6 — Remaining stretch goals** | ⬜ Not started | Multi-camera-angle support, desktop packaging, jargon info-text annotations, audio effects/intro-outro presets, automatic social clips, voice ducking for overlapping speech |

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
│  2. ProcessingScreen          │ ──── GET /progress/{id} ───▶ │    │  + diarize (pyannote         │
│     — real upload bytes,      │                              │    │    community-1, HF_TOKEN,    │
│       per-stage progress      │                              │    │    overlap-aware in 1 pass)  │
│                               │                              │    ├─ faces: detect (YuNet)       │
│  3. CastScreen                │                              │    │    → track (IOU)             │
│     — name each person        │                              │    │    → embed (SFace)           │
│     — confirm voice↔face      │                              │    │    → cluster ids (DBSCAN)    │
│       matches, flagged ones   │                              │    └─ fuse: lip-sync (LR-ASD)     │
│       first                   │                              │         → Hungarian match to      │
│                               │                              │           diarized voices         │
│  4. EditorView                │                              │                                   │
│     — turn list w/ names      │                              │  POST /export                     │
│     — per-turn person fix     │                              │    build gapless segments         │
│     — live preview = export   │                              │    → frame each person (framing)  │
│                               │                              │    → one ffmpeg filter_complex    │
│                               │                              │    → burn in captions (optional,  │
│                               │                              │       word-level, needs libass)   │
│                               │                              │    → mux original audio (copy)    │
└──────────────────────────────┘                              └───────────────────────────────────┘
```

The frontend resolves *who is on screen* (lip-sync/diarization fusion
suggests it, the user confirms or corrects any turn) and sends **person
ids** to `/export`. The render pipeline never sees a diarisation speaker.

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
2. `App.tsx` calls `processVideo(file)`, one upload to `POST /process`. This
   used to be two endpoints (`/transcribe`, `/detect-faces`) called
   concurrently with `Promise.all` — that meant the browser uploaded the
   same recording twice, 10GB of transfer for a 5GB file. One `/process`
   call now feeds transcription and face detection, which still run
   concurrently server-side (in threads — OpenCV and CTranslate2 both
   release the GIL).
3. Inside `/process`: ffmpeg pulls a mono 16kHz WAV out of the video →
   Whisper transcribes it with word-level timestamps → the same WAV is
   diarized by `pyannote` community-1 (who's talking, when, as anonymous
   "Speaker 0/1/2...", overlap-aware in one pass) → word timestamps and
   diarization segments are merged into dialogue **turns**
   (`{speaker, start, end, text}`). In parallel, faces are detected,
   tracked, and clustered into **people** (see Backend Structure below).
   Once both finish, `fuse.py` scores each person's face against the
   audio with LR-ASD lip-sync and Hungarian-matches voices to people.
4. Frontend now has turns, people (with thumbnails and bounding boxes),
   and a **suggested** voice-to-person mapping with per-match confidence.
   That's what `CastScreen` uses: the user names each person once and
   confirms the matches, with low-confidence ones flagged instead of
   starting from a blank grid.
5. `EditorView` can now, for any turn, look up which person its speaker
   maps to, find that person's bounding box nearest the turn's start
   time, and compute a CSS `transform` that zooms the `<video>` element
   in on that box — a live, real preview of the "auto-zoom to whoever's
   talking" feature, without needing a full render pipeline yet.

---

## API Reference

All endpoints live in [`server/main.py`](../server/main.py). CORS is
locked to `http://localhost:3460` / `http://127.0.0.1:3460` (the frontend's
dev server origin). There used to be separate `/transcribe` and
`/detect-faces` endpoints, called concurrently from the frontend — both took
the file, so the browser uploaded the same recording **twice** (10GB of
transfer for a 5GB file). They're gone; `POST /process` below replaced both.

### `GET /health`

Returns `{"status": "ok"}`. Used to check the service is up before hitting
it with real work.

### `POST /process`

**Request:** `multipart/form-data` with `file` and an optional `jobId`
(enables progress reporting via `/progress/{job_id}`). No speaker-count
parameter — forcing one was measured to invent speakers (see STATUS.md), so
nothing downstream accepts it any more.

Internally, transcription+diarization and face detection run concurrently in
threads (OpenCV and CTranslate2 both release the GIL, so they genuinely
overlap: 13s vs 16s sequential on a 60s clip); lip-sync/voice matching runs
after, since it needs both of the others done first.

**Response:**

```json
{
  "turns": [
    { "speaker": 0, "start": 0.0, "end": 5.16, "text": "Welcome back to the show..." }
  ],
  "overlapWindows": [
    { "start": 12.4, "end": 14.1, "speakers": [0, 1] }
  ],
  "words": [
    { "start": 0.0, "end": 0.4, "text": "Welcome" }
  ],
  "faces": {
    "frameWidth": 1920,
    "frameHeight": 1080,
    "people": [
      {
        "id": 0,
        "thumbnail": "data:image/jpeg;base64,...",
        "detectionCount": 3170,
        "keyframes": [
          { "t": 0.0, "bbox": { "x": 346, "y": 186, "width": 284, "height": 291 } }
        ]
      }
    ]
  },
  "match": {
    "speakerToPerson": { "0": 1, "1": 0 },
    "matches": [
      { "speaker": 0, "personId": 1, "confidence": 0.97, "judgedSeconds": 114 }
    ],
    "notes": [
      { "kind": "low_confidence", "speakers": [1], "personIds": [0] }
    ]
  }
}
```

`speaker` is a 0-indexed anonymous integer from diarization; `words` are
word-level timestamps independent of turn boundaries (what captions are cut
from — see Backend Structure). `faces.people` are recognised identities, not
raw detection tracks — `id` is per-request, not stable across separate
uploads. `match` is the lip-sync/diarization fusion result: a suggested
`speakerToPerson` mapping, per-voice confidence, and `notes` flagging
anything the cast screen should surface first (an unmatched voice, an
over-split speaker, low confidence). The cast screen starts from this rather
than a blank grid.

### `GET /progress/{job_id}`

Per-stage progress for a running job, polled by the UI. Returns
`{transcribe: {stage, fraction, done}, faces: {...}, match: {...}}` — three
stages, `match` running last since it depends on the other two. In-memory
and process-local — this is a single-user local tool, so a dict is the whole
requirement.

### `POST /export`

**Request:** `multipart/form-data` — `file` (the source video, re-uploaded)
plus form fields: `layoutChoices` (per-turn layout decisions, each carrying
its own `start`/`end`), `overlapSegments` (`[]` if none), optional
`sessionId` (triggers `decisions.jsonl` logging on success), optional
`captions` (bool, default false), and optional `trimDeadAir` (bool, default
false — cuts long pauses and filler words, see `pipeline/trim.py`). `faces`
is **sent as a file part, not a form field** — Starlette caps form fields
at 1MB and a 53-minute episode's keyframes are 1.7MB, which made every
long-episode export fail with "Part exceeded maximum size of 1024KB".
`words` is also a file part, for the same reason, and needed whenever
`captions` or `trimDeadAir` is true — captions cut cues from word-level
timestamps, and `trimDeadAir` needs them to find filler words (dead-air
detection alone doesn't). If `captions` is requested but the running
`ffmpeg` wasn't built with libass, the request fails fast with a 400 naming
the fix, before the render starts. If both `captions` and `trimDeadAir` are
on, caption timing is remapped onto the trimmed timeline so the two don't
drift apart.

**Response:** `video/mp4`, streamed from disk (`FileResponse`, not buffered
in memory — exports can be large), `Content-Disposition: attachment`.

Full design, including the render pipeline, crop math, and every decision
behind it: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md).

---

## Frontend Structure

```
src/
├── App.tsx                          # top-level state machine (see below)
├── components/
│   ├── Logo.tsx                     # Cutroom SVG mark, reduction ladder by render size
│   └── ThemeSwitcher.tsx            # System/Light/Dark segmented control
├── lib/
│   ├── api.ts                       # typed fetch wrappers for /process, /export, /progress
│   ├── faceCrop.ts                  # bbox → CSS zoom transform math + pixel-space crop math
│   └── theme.ts                     # `useThemeMode` — persisted, live system-preference-aware
├── features/
│   ├── upload/UploadScreen.tsx      # file picker + real drag-and-drop (idle / error states)
│   ├── upload/ProcessingScreen.tsx  # upload bytes + per-stage progress
│   ├── faces/CastScreen.tsx         # name each person; confirm the automatic voice↔face matches
│   └── timeline/
│       ├── EditorView.tsx           # video preview + turn list + layout controls +
│       │                            # multi-speaker composite live preview + overlap indicator
│       ├── ExportButton.tsx         # real export flow (idle/exporting/done/error)
│       └── types.ts                 # `Layout` type (original/zoom/split)
```

**Design tokens & theming:** colors, type, spacing and radii are CSS custom
properties defined once in `src/index.css`'s `@theme` block (Tailwind v4's
CSS-first config) and re-pointed under a `[data-theme]` attribute + a
`prefers-color-scheme` media query for the three-state theme switch. See
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the full token table, what's
implemented vs. deferred, and where the source design files live.

**State machine** (`App.tsx`): a single `Status` union type drives which
screen renders — `idle → processing → cast → editing` (or `error` at
any point during processing). No router, no global state library; this is
intentionally the simplest thing that works for a linear, single-page
flow. `processVideo(file)` is the one call to the backend; this used to be
`Promise.all([transcribe(file), detectFaces(file)])` against two separate
endpoints, before they were merged into `/process` (see API Reference).

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
│   ├── audio.py                 # ffmpeg: extract mono 16kHz WAV from any video/audio file
│   ├── ffmpeg.py                 # which ffmpeg/ffprobe binary to run (FFMPEG_BINARY override)
│   ├── transcribe.py            # faster-whisper: word-level timestamped transcript
│   ├── diarize.py                # pyannote community-1: who's talking when, overlap-aware,
│   │                              # in one pass (needs HF_TOKEN, no fallback)
│   ├── turns.py                  # merge transcript + diarization into dialogue turns
│   ├── faces.py                  # OpenCV YuNet + IOU tracking + SFace/DBSCAN: face
│   │                              # detection, tracking, and identity recognition
│   ├── lipsync.py                # LR-ASD: which face is talking, from the picture
│   ├── lrasd/                    # vendored LR-ASD model classes (MIT) + AVA weights notice
│   ├── fuse.py                   # Hungarian-match diarized voices to lip-sync's faces
│   ├── framing.py                # crop-box math for how a person fills a pane
│   ├── captions.py               # word-level timestamps → caption cues → .ass subtitle file
│   ├── trim.py                   # dead-air/filler-word ranges to cut, and caption remapping
│   │                              # for a trimmed timeline
│   ├── progress.py               # in-memory per-job stage progress, polled by the UI
│   └── render.py                 # /export's render pipeline: segment construction,
│                                  # bust-shot/composite crop math, caption burn-in,
│                                  # dead-air/filler cutting, ffmpeg orchestration
├── tests/
│   ├── test_render.py            # render.py's crop-math parity + segment-construction edge cases
│   ├── test_diarize.py           # diarize.py's overlap-window construction
│   ├── test_faces.py             # faces.py's identity clustering + presence threshold
│   ├── test_fuse.py              # fuse.py's voice/face matching + notes
│   ├── test_captions.py          # captions.py's cue-splitting rules
│   └── test_trim.py              # trim.py's range detection + timeline remapping
├── logs/
│   └── <session_id>/decisions.jsonl  # written by /export on success, gitignored
└── .models/
    └── face_detection_yunet.onnx   # committed directly (232KB — small enough, avoids a download step)
    # SFace recognition weights and LR-ASD lip-sync weights download here on first
    # run instead (~38MB and ~3.3MB) — gitignored, same pattern as the Whisper model
```

**`diarize.py`** — there's no per-speaker audio track to lean on (single
camera, one mixed track), so this diarizes by voice using `pyannote`'s
**community-1** model (CC-BY-4.0), which is overlap-aware in a single pass:
two people talking at once come out as two segments covering the same
instant, rather than a separate model that has to be cross-referenced
against the speaker segments to guess who was involved. No speaker count is
ever passed — forcing one was measured to invent speakers by splitting a
real person in two. Needs a Hugging Face token (`HF_TOKEN`); unlike the
`resemblyzer` clustering it replaced, there is no fallback — a fallback that
quietly produces a wrong edit is worse than a 400 naming the token and
licence page. Runs on GPU (MPS) when available: measured 53s vs 398s on CPU
for the same 10-minute slice, byte-identical output either way.

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
IOU matching. A detection matches an existing track if its bounding box
overlaps that track's last-seen box above a threshold (0.3); otherwise it
starts a new track. A track closes out if unmatched for more than
`max_gap_s` (default 3s) — handles someone leaving frame without merging
them into whoever enters later. Tracks are then **recognised into
identities**: each track is embedded with `cv2.FaceRecognizerSF` (SFace)
and clustered by cosine distance (measured 0.66-0.91 between four real
participants), so fragments of the same person collapse into one. A
"person" seen in too few sampled frames is dropped as junk — the threshold
is the larger of a fixed floor and a percentage of sampled frames, so it
scales with episode length instead of letting junk clusters survive on a
long recording.

**`lipsync.py`** — which face is speaking, from the picture rather than the
sound. Runs an LR-ASD model (MIT license, AVA weights, vendored in
`lrasd/`) against a mouth-centred crop of each recognised person, scored a
window at a time (4s) against the audio's MFCC features, producing a
per-second "who is most likely talking" signal. Deliberately does not run
per-frame face detection — it reuses the ~1/sec keyframes `faces.py` already
produced and interpolates between them, because a seated person doesn't
move meaningfully within half a second, and dense per-frame detection on a
full episode was measured at about an hour.

**`fuse.py`** — pairs `diarize.py`'s voices to `lipsync.py`'s faces with
Hungarian matching (`scipy.optimize.linear_sum_assignment`) over
second-by-second co-occurrence counts. The two signals catch each other's
mistakes: one voice landing on two faces means diarization merged two
people, two voices landing on one face means it split one person into two.
A voice with too little co-occurrence evidence is left unmatched rather
than guessed at. Produces the `match` result the cast screen starts from,
plus `notes` flagging what needs the editor's attention first.

**`captions.py`** — groups Whisper's word-level timestamps (not turn or
diarization boundaries) into caption cues, breaking on a long pause, a line
getting too long, or a cue running too long on screen, then writes them as
an `.ass` subtitle file sized to the export's own frame. Word-level timing
is the point: it lets a cue start and end exactly when speech does, instead
of inheriting a turn's boundaries, which can run seconds past the words
that justify it.

**`trim.py`** — an opt-in export option, computes ranges to cut entirely
rather than just reframe: pauses between turns longer than ~1.2s (trimmed
down to a short beat, not removed outright — a hard cut to total silence
reads as a jump cut), and standalone filler words (`um`, `uh`, and similar)
from word-level timestamps, deliberately excluding words that are only
*sometimes* filler ("like", "so") since there's no way to tell from the word
alone. Also holds `remap_time()`, which shifts a timestamp on the original
(untrimmed) timeline to where it lands after cuts are removed — used to keep
burned-in captions in sync when trimming and captions are both requested for
the same export, since a caption cue's timing is computed against the
untrimmed source. Thresholds are reasoned defaults, not measured against
real footage the way `framing.py`'s are — there's no reference edit yet to
tune a silence cutoff against.

**`ffmpeg.py`** — resolves which `ffmpeg`/`ffprobe` binary every pipeline
stage runs, via `FFMPEG_BINARY`/`FFPROBE_BINARY` in `server/.env`. Exists
because caption burn-in needs an `ffmpeg` built with libass, which
Homebrew's default `ffmpeg` formula doesn't have — `ffmpeg-full` does, but
it's keg-only so it's not on PATH by default. Shared by every stage
deliberately: when only the render step honoured the override, setting it
fixed captions while audio extraction quietly kept using whatever was on
PATH.

**`progress.py`** — an in-memory, per-job dict of `{stage, fraction, done}`
for each of `/process`'s three phases (`transcribe`, `faces`, `match`),
polled by `GET /progress/{job_id}` so the UI can show real per-stage
progress instead of a static "processing..." message. Deliberately
process-local with no persistence: this is a single-user local tool, so a
dict is the whole requirement, and entries older than 30 minutes are
pruned.

**`render.py`** — builds a duration-complete list of `RenderSegment`s
covering the source video (turns, overlap windows, *and* the pauses between
turns, so the output stays time-aligned with the source audio) minus
anything `trim.py` says to cut, then renders it as one `ffmpeg` invocation:
one `filter_complex` graph with a `trim`+`crop`+`scale` chain per segment,
concatenated, and, when requested, `captions.py`'s `.ass` file burned in via
the `ass` filter. The multi-speaker composite is N per-pane crops
`hstack`ed together, capped at 3 panes. Audio takes one of two paths:
untouched and stream-copied when nothing was cut (the common case — bit
identical, zero re-encode loss), or its own mirrored trim+concat filter
chain, forcing a real re-encode, when dead-air/filler trimming actually
removed time — `_segments_are_contiguous()` decides which, from the segment
list itself rather than a flag threaded through from the caller. Full
design, including why each piece works the way it does:
[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md).

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
| `@fontsource-variable/instrument-sans` / `@fontsource-variable/jetbrains-mono` | self-hosted brand typefaces — see [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |

Deliberately small. No router (single linear screen flow doesn't need
one), no state management library (one `useState` in `App.tsx` covers it),
no UI component library yet (plain Tailwind classes).

### Backend (`server/pyproject.toml`)

| Package | Why | Notes |
|---|---|---|
| `fastapi` + `uvicorn[standard]` | the HTTP service itself | |
| `python-multipart` | required by FastAPI for `UploadFile` form parsing | |
| `faster-whisper` | transcription with word-level timestamps | CTranslate2-based, not the original `openai-whisper` — much lighter (no PyTorch dependency for the transcription path itself) |
| `pyannote-audio` | speaker diarization (community-1) — who's talking when, overlap-aware in one pass | **Required, no fallback.** Replaced `resemblyzer`, which was measured finding two speakers on a real four-person episode. Gated on a Hugging Face account + token (`HF_TOKEN`, see Setup above); a missing token now fails `/process` with a 400 rather than silently degrading. Runs on GPU (MPS/CUDA) when available |
| `python-dotenv` | loads `server/.env` for `HF_TOKEN` and `FFMPEG_BINARY` | |
| `scikit-learn` | `DBSCAN` clustering of face embeddings into identities (`faces.py`) | no longer used for diarization — community-1 does its own clustering internally |
| `opencv-python-headless` | face detection (`FaceDetectorYN`/YuNet), recognition (`FaceRecognizerSF`/SFace), and video frame sampling | **pinned `>=4.9,<5`** — see below, this bit us |
| `numpy` | array plumbing between the above | |
| `pillow` | image handling | pulled in for the face-detection work; not load-bearing beyond that |
| `scipy` | `linear_sum_assignment` (Hungarian matching in `fuse.py`) and `fft`/`io.wavfile` (MFCC features + wav reading in `lipsync.py`) | |
| `soundfile` | reads the extracted wav as a waveform for `diarize.py` to hand `pyannote` directly | works around `pyannote` 4 reading audio through `torchcodec`, whose prebuilt libraries link against FFmpeg 4-7 and fail to load on a modern ffmpeg (9) — see Known Limitations |
| `pysubs2` | writes the `.ass` subtitle file `captions.py` builds, for ffmpeg's `ass`/libass filter to burn in | |
| `setuptools<81` | **pinned** to keep `pkg_resources` available | originally pinned because `resemblyzer`'s dependency `webrtcvad` did `import pkg_resources` at import time and recent `setuptools` (≥81) dropped it; `resemblyzer` is gone but the pin remains, not reverified against the current dependency set |
| `pytest` (dev) | backend test suite (`server/tests/`, 76 tests) | |

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
by default, ~500MB), the SFace face-recognition weights (~38MB), and the
LR-ASD lip-sync weights (~3.3MB) — all public, no account needed.

**Required: a Hugging Face token for diarization.** `pyannote` community-1
is the only speaker-diarization model this pipeline uses, and there's no
token-free fallback — a fallback that quietly produces a wrong edit is
worse than a clear error. Without `HF_TOKEN` set, `POST /process` returns a
400 naming exactly what to do:

1. Create a token at https://huggingface.co/settings/tokens
2. Accept the model licence at
   https://huggingface.co/pyannote/speaker-diarization-community-1
3. Add `HF_TOKEN=<your token>` to `server/.env` (create the file — it's
   gitignored) and restart the service

This also covers overlap detection — community-1 is overlap-aware in the
same pass, so there's no separate model or token to configure for it.

**Optional: burned-in captions.** Needs an `ffmpeg` built with libass,
which Homebrew's default `ffmpeg` formula doesn't have — `brew install
ffmpeg-full` does, and because that formula is keg-only, point the server
at it explicitly:

```
FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
```

Everything else works on either build; `/export` checks for libass up
front and refuses a captioned export with that instruction rather than
spending 15 minutes rendering a video with no captions on it.

---

## Known Limitations

Per [STATUS.md](STATUS.md)'s "Known limitations", which is the source of
truth kept current as the pipeline changes — the list below matches it:

- **Diarisation now requires a Hugging Face token, with no fallback.**
  community-1 replaced the token-free `resemblyzer` clustering, which was
  measured finding two speakers on a real four-person episode — a fallback
  that quietly produces a wrong edit is worse than an error that says what
  to do. `/process` returns a 400 naming the token and licence page if it's
  missing.
- **Diarisation is still not perfect.** It can mis-assign a turn, and only
  finds speakers who actually speak in the window analysed. Per-turn
  correction in the editor exists for this.
- **`pyannote` 4 cannot read audio files on FFmpeg 9** — it decodes through
  `torchcodec`, whose prebuilt libraries link against FFmpeg 4-7. Worked
  around by decoding the wav ourselves (`soundfile`) and handing the
  pipeline a waveform directly, which is free since one is already
  extracted before this point.
- **Zooming into a wide shot is inherently soft.** Framing now matches
  professional practice (3.5x face height), which needs ~2.6x upscale on a
  1080p wide shot of four people. The real fix is source resolution:
  shooting 4K and delivering 1080p makes punch-ins genuinely sharp, because
  the crop then holds more real pixels than the output needs.
- **Caption burn-in needs an ffmpeg the standard install doesn't give you.**
  Homebrew's regular `ffmpeg` formula ships without libass (and without
  freetype, so `drawtext` isn't a fallback either). `ffmpeg-full` has it but
  is keg-only — see Setup above for `FFMPEG_BINARY`. Export checks for this
  before starting the render and refuses with that advice, rather than
  spending 15 minutes and handing back a video with no captions on it.
- **No automated *frontend* test suite** — the backend has 76 tests
  (`server/tests/`, `pytest`); the frontend is verified by typecheck, build,
  and real browser sessions against real footage.
- **Track/person IDs aren't stable across separate uploads** — re-uploading
  the same video reruns detection from scratch; there's no caching or
  project-file concept yet (Recordly-style `.recordly` project persistence
  was noted as a nice-to-have, not built).
- **No pre-flight disk-space check for large exports** — a multi-GB upload
  plus its extracted audio plus a same-or-larger rendered output can
  transiently need significant temp disk space. Not guarded against.
- **macOS only so far.** Nothing is knowingly platform-specific, but nothing
  else has been tried.

**Fixed since the last pass over this doc** (kept here briefly so the
history isn't lost, not as an open item): "diarisation cannot separate
similar voices" — `resemblyzer` found two speakers and 34 turns in a real
53-minute four-person episode; community-1 finds 3 speakers and 90 turns on
a 10-minute slice of the same recording, unconstrained. "Overlap detection
is broken on `pyannote.audio` 4" — the separate
`pyannote/overlapped-speech-detection` pipeline that broke on pyannote 4 is
gone; community-1 is overlap-aware in its one diarization pass. "Automatic
speaker-to-face matching" — shipped via `lipsync.py` + `fuse.py`, see
Backend Structure above; the cast screen now starts pre-filled instead of
building the map from scratch.

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
13. **Audio is stream-copied, not re-encoded, when the container allows it.**
    The export's source audio is never edited (no cuts, no ducking), so
    paying a generation of quality loss for it — the original AAC-320k
    re-encode — was pure waste once it was checked: an MP4-safe source codec
    (`aac`, `mp3`, `alac`, `ac3`, `eac3`) is now passed through with `-c:a
    copy`, and only a genuinely incompatible codec falls back to re-encoding.
    Measured bit-identical: 320009 bps in, 320009 bps out. See `render.py`'s
    `_audio_args`.
14. **No cap on the number of speakers/people the pipeline will recognise.**
    Four-and-more-person podcasts are normal, and capping the roster would
    silently drop a real participant. What adapts instead is the *layout* —
    two people on screen triggers split, three or more triggers
    speaker-focus framing (composite rendering is separately capped at 3
    panes for legibility, which is a different constraint — see `render.py`
    above) — not the guest list itself.

---

## Roadmap

Synced to [STATUS.md](STATUS.md)'s "What's left", which is the current
source of truth for ordering — read it for the measured comparisons behind
each call. Where this list and an older draft of it disagreed, STATUS.md
won.

1. ~~**Export**~~ — done. `POST /export` renders a real MP4 with hard cuts,
   bust-shot zoom, and a real multi-speaker composite.
2. ~~**Split-screen, for real**~~ — done, both live preview (two synced
   `<video>` elements) and export (real ffmpeg composite, capped at 3 panes).
3. ~~**Fix speaker diarisation, voices and faces both**~~ — done.
   `resemblyzer` (99.5% of speech in one cluster, on a real episode) was
   replaced by `pyannote` community-1 on the GPU (3 speakers/90 turns on a
   10-minute slice the old pipeline never approached, 0.089x realtime on
   MPS), which also removed the separate broken overlap model. LR-ASD
   lip-sync + Hungarian matching (`lipsync.py`, `fuse.py`) then closed the
   other half — automatic voice-to-face matching, validated at 97-100%
   agreement with a human-checked benchmark. The cast screen starts
   pre-filled instead of built from scratch.
4. **Show a full edit to a podcast host.** Still the milestone the whole
   roadmap is sequenced against, and still not done — this is genuinely
   next now that both halves of diarisation are fixed.
5. ~~**Smarter cutting**~~ — dead air and filler words: done, as an opt-in
   export option (`trimDeadAir`). See [STATUS.md](STATUS.md)'s "What's
   left" for the full writeup. Vary shot length, the other half of this
   line, stayed deferred — no testable target for it without a real edit
   to compare against.
6. **Smoothing / scene-boundary layer** — the deferred crop-interpolation
   approach. Only worth it if the real-world test says crop jitter is a
   real complaint.
7. **Jargon info-text annotations** — genuinely novel, nothing open-source
   covers it.
8. **Audio effects, intro/outro presets.**
9. **Voice ducking for overlapping speech** — still gated on a
   source-separation research spike; isolating one voice from a single
   mixed track is a different, harder ML problem than anything else in the
   pipeline. Not a checkbox.
10. **Style learning from corrections** — the `decisions.jsonl` data is
    already being captured. Gated on evidence of repeat editors making
    repeat corrections; no pattern to learn from before that.
11. **Automatic social clips** — an offline scoring heuristic (pace,
    silence, turn density), deliberately avoiding a cloud-LLM dependency.
12. **Multi-camera support, desktop packaging (Electron).**

**Captions** shipped ahead of this list's original ordering (word-level
cues, burned in via ffmpeg's `ass` filter) — not because it was
reprioritized above the real-world test, but because it was cheap once
Whisper's word timestamps were already being captured for other reasons.

**Separate passes, not roadmap items** (per STATUS.md): visual design
language (colours, typography, spacing, component system — entirely
unaddressed); public-release readiness (one-command Docker setup, CI,
cross-platform verification, CONTRIBUTING.md, a demo GIF); an
agent-friendly/fixture mode for loading canned state into the editor
without walking the whole upload flow.

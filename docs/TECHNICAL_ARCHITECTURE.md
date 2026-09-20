# Technical Architecture — Phase 4: Real Export + Multi-Speaker Framing

This is the architecture for the next thing getting built: turning the live
CSS preview into an actual exported MP4, with real multi-speaker framing for
overlapping speech. It's the technical half of closing out planning before
implementation starts — the companion doc is [UX_PRD.md](UX_PRD.md).

Source of truth for *why* this scope, in this order: the approved roadmap doc
from the 2026-09-11 `/office-hours` session (`Next Steps` #1–#2). This doc
turns that into something buildable — concrete schemas, a concrete pipeline,
and the gaps the roadmap left open.

For what's already built and running today, see
[ARCHITECTURE.md](ARCHITECTURE.md) — this doc only covers the delta.

---

## 1. The blocking dependency: overlap detection

Read this section first. It changes what "Next Steps #1" can actually ship.

The roadmap's Next Steps #1 promotes the multi-speaker composite ("Split")
from a deferred nice-to-have to core, in-scope work — because overlapping
speech is common in a real conversation, not an edge case. That's the right
call. But it assumes the pipeline can already tell *when* two people are
talking at once. It can't.

**What `diarize.py` actually does today:** it slices the audio into
overlapping windows, embeds each window as a voice fingerprint, and runs
`AgglomerativeClustering` to assign each window to exactly one cluster (one
speaker). That's true by construction — a clustering algorithm partitions
points into groups; a single audio window cannot belong to two clusters.
`build_turns()` then walks Whisper's word timestamps and looks up the single
speaker whose segment covers each word (`turns.py:15-21`, `_speaker_at`).

The result: **there is no representation of "two speakers active at the same
time" anywhere in the current pipeline.** Not a bug — the resemblyzer +
clustering approach can't produce that signal, full stop. Whisper's
transcript won't help either: when two people talk over each other on one
mixed track, Whisper doesn't know two people are speaking — it just
transcribes whatever's most audible into one garbled or truncated segment.

This matters because the multi-speaker composite has no trigger condition
without it. Three ways to actually resolve this, not two, because there's a
cheap partial option between "do nothing" and "adopt a new dependency":

### Option A — Adopt `pyannote.audio` now (recommended)

`pyannote.audio`'s pipeline includes native overlapped-speech detection —
this is exactly the roadmap's own noted upgrade path, and the Open Questions
section already flagged that this "may end up settling itself once overlap
detection is needed for the multi-speaker composite framing." It is needed
now, not later.

- **What changes:** `server/pipeline/diarize.py` gets a second function
  (or the existing one gets replaced) that calls `pyannote.audio`'s
  `overlapped-speech-detection` pipeline in addition to (or instead of) the
  clustering-based speaker assignment. Output: the existing
  `SpeakerSegment` list, plus a new `OverlapWindow` list (see §3).
- **Cost:** `pyannote.audio` needs a Hugging Face account + accepting a
  model license + an access token (`HF_TOKEN` env var). This breaks the
  current zero-setup story (`uv sync` + run, no accounts anywhere) — for
  everyone who runs this locally, including future public users, not just
  this session. That's a real, permanent tradeoff, not a one-time cost.
  *It turned out not to be permanent. The model this shipped with,
  community-1, is CC-BY-4.0, so its weights are now committed to this repo
  and the account, licence and token steps are all gone. See
  `server/.models/diarization/NOTICE.md`.*
- **Also improves:** turn-boundary accuracy (a separately-noted known
  limitation) — `pyannote.audio` is generally more accurate than
  window-clustering at exactly the boundary-timing problem the roadmap
  flagged as a possible next investment. One dependency change, two wins.
- (human: ~1 day to integrate + re-verify diarization accuracy on a real
  recording / CC: ~1-2 hours)

### Option B — Heuristic proxy, no new dependency

Approximate "overlap" from what the existing pipeline already has: flag two
turns as "probably overlapping" if the transcript shows a very short gap or
a small negative gap between consecutive same-length turns from different
speakers (a cheap proxy for interruption/cross-talk), or flag it whenever
Whisper's `segments[].words` shows unusually low per-word confidence in a
region (a weak proxy for "the audio was ambiguous, possibly two voices").

- **What changes:** a new heuristic function in `turns.py`, no new
  dependency, `uv sync` stays account-free.
- **Cost:** this is not overlap detection — it's a guess with a real false
  positive/negative rate that nobody has measured. Shipping "multi-speaker
  framing" on top of an unvalidated proxy risks the exact failure mode the
  real-world test (Next Steps #3) exists to catch: the friend watches the
  export and the composite triggers at the wrong times, or never triggers
  during an actual overlap, and the "whoa, it just nails the edit" premise
  takes the hit instead of getting a fair test.
- (human: ~2-3 hours to write + tune / CC: ~30 min, but unvalidated)

### Option C — Ship without composite; keep Split deferred (fall back to original Approach A)

Ship Next Steps #1 as: real export, hard cuts, bust-shot Zoom framing, no
composite — i.e., the *original* Approach A from the roadmap, before the
"Recommended Approach — revised" section promoted Split into scope. Overlap
detection becomes its own prerequisite spike, done before composite framing
is attempted at all.

- **What changes:** nothing new — `/export` renders Original/Zoom only,
  same as the current live preview supports today. Composite render code
  isn't written yet.
- **Cost:** undersells the real-world test the same way the roadmap warned
  against — "skipping [Split] would undersell the real test" was the
  explicit reasoning for promoting it into scope in the first place. This
  option reverses that call.
- (human: 0 extra / CC: 0 extra — this is the do-less option)

**Decided: Option A.** The multi-speaker composite was promoted to core
scope for a specific reason (overlapping speech is common, not an edge
case) — shipping it on a guess (B) risks discrediting the real-world test,
and not shipping it (C) reverses a call the roadmap already made
deliberately. A is the only option that gives the composite feature an
honest trigger signal. The HF-account cost is real but one-time and
documented (same shape as the Whisper model download already required on
first run).

Everything below (`overlapWindows`, `OverlapWindow`, the render pipeline's
`"split"` trigger) assumes Option A is implemented. The zero-setup story
(`uv sync` + run, no accounts) changes: first run now also needs an
`HF_TOKEN` env var after accepting `pyannote.audio`'s model license on
Hugging Face. Document this in `server/README.md` and the setup section of
`ARCHITECTURE.md` when this ships — it's a real, permanent change to the
setup instructions, not a footnote.

*Since undone.* The weights are vendored under CC-BY-4.0 and credited in the
app, `HF_TOKEN` is read nowhere, and `uv sync` + run with no accounts is the
setup story again. Both documents named above say so.

---

## 2. Scope

In scope (this doc): the `/export` endpoint, the render/compositor pipeline,
the bust-shot crop-box math, overlap-window detection (per the decision
above), and the frontend wiring to trigger export and show its result.

Out of scope (explicitly, per the roadmap): smoothing/path-interpolation
between crop positions (Approach B, deferred), voice ducking / source
separation (open research question, not a committed feature), captions,
jargon annotations, audio effects, intro/outro presets, automatic social
clips, automatic speaker-to-face matching, multi-camera, desktop packaging.

(Captions and automatic speaker-to-face matching shipped in later phases
this doc doesn't cover — `pipeline/captions.py`, `pipeline/lipsync.py`,
`pipeline/fuse.py`. Speaker-to-face matching stayed entirely outside this
doc's scope (nothing in the export/render pipeline needed to change).
Captions did touch this doc's scope: `/export` gained an optional
`captions` flag and `words` upload, and `render.py`'s ffmpeg invocation
gained an `ass`/libass burn-in step — see §4 and §5 below for where. See
[ARCHITECTURE.md](ARCHITECTURE.md) and [STATUS.md](STATUS.md) for the
current design.)

---

## 3. Data model

### 3.1 New: `OverlapWindow` (backend + frontend)

Only exists if Option A is chosen. Computed server-side from
`pyannote.audio`'s overlap detection, alongside the existing
`SpeakerSegment` list.

```ts
interface OverlapWindow {
  start: number;       // seconds
  end: number;          // seconds
  speakers: number[];   // 0-indexed diarization speaker ids active in this window, length >= 2
}
```

Backend dataclass, `server/pipeline/diarize.py`:

```python
@dataclass
class OverlapWindow:
    start: float
    end: float
    speakers: list[int]
```

### 3.2 Extended: `/transcribe` response

`overlapWindows` is additive — `turns` keeps its current shape and meaning
unchanged (one speaker per turn; this is what the transcript UI and the
per-turn Original/Zoom override already use and nothing about that model is
broken). Overlap is a separate, parallel signal only the render pipeline (and
later, live-preview parity — see roadmap "Rest of the roadmap") consumes.

```json
{
  "turns": [ { "speaker": 0, "start": 0.0, "end": 5.16, "text": "..." } ],
  "overlapWindows": [
    { "start": 12.4, "end": 14.1, "speakers": [0, 1] }
  ]
}
```

If Option B or C is chosen instead, `overlapWindows` is `[]` always (B: from
the unvalidated heuristic; C: never populated, composite layout is simply
unreachable in the renderer — see §5.3).

### 3.3 New: `LayoutChoice` (frontend → backend, request body for `/export`)

This is what the roadmap's Next Steps #1 already specified — formalized
here with an actual type:

```ts
interface LayoutChoice {
  turnIndex: number;
  speaker: number;
  start: number;   // added during implementation -- see note below
  end: number;
  defaultLayout: "original" | "zoom";
  finalLayout: "original" | "zoom" | "split";
}
```

**Correction made during implementation:** the render step needs each turn's
own time range to place it on the shared timeline alongside overlap windows
and gaps (§3.4) — `turnIndex` alone isn't enough without also sending the
full `turns` array separately, which would duplicate data already on this
object. `start`/`end` were added directly to `LayoutChoice` instead. Docs
follow reality; this is that update.

`defaultLayout` is never `"split"` — that default is computed purely from
`speakerToTrack[speaker] !== undefined ? "zoom" : "original"`, matching
`EditorView.tsx:44` exactly (not stored as separate state — see roadmap).
`finalLayout` is whatever `EditorView`'s `layouts` state map holds at export
time; equal to `defaultLayout` unless the user overrode it.

**Important scoping note:** a user CAN manually force `"split"` on a
single-speaker turn (there's no UI restriction preventing it today), but
composite rendering needs two-plus face positions to place into panes. If a
turn is manually forced to `"split"` and no `OverlapWindow` covers it, the
renderer falls back to whatever the second-most-recently-tracked face was
active nearby, and if none exists, falls back to `"zoom"` (or `"original"` if
no face is mapped at all) — same fallback chain as an unmatched speaker uses
today. This is a real fallback, not a silent no-op, and belongs in
`ExportButton`'s validation (see §6).

### 3.4 New (internal, render-only): `RenderSegment`

The actual unit the renderer works on. Built server-side inside `/export`
from `turns` + `overlapWindows` + `layoutChoices` + the source video's total
duration. Never sent over the wire — internal to the render step.

```python
@dataclass
class RenderSegment:
    start: float
    end: float
    layout: Literal["original", "zoom", "split"]
    # populated only for "zoom" and "split":
    speaker_bboxes: list[tuple[int, BBox]]  # (speaker_id, bbox) pairs
```

**Why this exists and why it's not just `turns` re-used:** `turns` cover
only time where someone is speaking, per the diarization+Whisper output —
they don't cover pauses/silence between turns, and they can't represent
"two people, one turn" (§1). But the rendered video has to be one continuous
file covering the *entire* source duration — because the audio track passes
through untouched (roadmap, Next Steps #1 "Audio" bullet), and the exported
video must stay time-aligned with that continuous, unmodified audio. So
`RenderSegment`s are built to be **gapless and duration-complete**:

```
0                                                         video duration
|--turn 0 (zoom)--|--gap (original)--|--turn 1 & overlap (split)--|--turn 2 (zoom)--|--gap (original)--|
```

Construction algorithm, `server/pipeline/render.py`:

1. Start with the full timeline `[0, duration]`.
2. Cut it at every `turn.start`, `turn.end`, `overlapWindow.start`,
   `overlapWindow.end` boundary (dedupe touching boundaries).
3. For each resulting sub-range, assign a layout:
   - If the sub-range falls inside an `OverlapWindow` → `"split"`,
     `speaker_bboxes` = the nearest keyframe bbox (relative to the
     sub-range's start) for each track mapped to each speaker in
     `overlapWindow.speakers`.
   - Else if it falls inside a `turn` whose `layoutChoices[turnIndex].finalLayout`
     is `"zoom"` → `"zoom"`, `speaker_bboxes` = that turn's single speaker's
     bbox.
   - Else if inside a turn with `finalLayout` `"original"` → `"original"`.
   - Else (a gap — no turn covers this time) → `"original"` (this is the
     roadmap's existing fallback rule, extended to cover silence, not just
     unmatched speakers).
4. Merge adjacent sub-ranges with identical `layout` + `speaker_bboxes` to
   avoid pointless re-encode boundaries (minor ffmpeg cost saving, not a
   correctness requirement).

This resolves a gap the roadmap's Next Steps #1 didn't spell out: it
describes the render as segment-per-turn without explicitly saying what
happens to the time *between* turns. If gaps were silently dropped instead
of rendered as `"original"` filler, the output video would be shorter than
the source and its audio would desync — silently, since ffmpeg wouldn't
error on it. Constructing `RenderSegment`s to be duration-complete makes
this impossible by construction rather than something a future implementer
has to remember to handle.

---

## 4. `POST /export`

New endpoint, `server/main.py`, same pattern as the existing two.

**Request:** `multipart/form-data`:
- `file` — the source video (re-uploaded, same as `/transcribe` and
  `/detect-faces` — this project has no persisted-upload concept, so this is
  consistent with existing behavior, not a new inconsistency)
- `layoutChoices` — JSON-encoded array of `LayoutChoice` (form field, not a
  file — small enough to not need multipart file semantics)
- `overlapWindows` — JSON-encoded array of `OverlapWindow` (`[]` if Option
  B/C)
- `faces` — JSON-encoded `DetectFacesResponse` (frontend already has this in
  memory from `/detect-faces`; re-sending avoids the server re-running face
  detection, which would be slow and pointless since it already ran once)
- `speakerToTrack` — JSON-encoded `Record<speakerId, trackId>` (added during
  implementation — needed to resolve which face track each `LayoutChoice`'s
  speaker maps to; not derivable from `faces` alone)
- `sessionId` — plain string, optional (for `decisions.jsonl` logging, §6.3)

**Added in a later phase, outside this doc's original design:** an optional
`captions` bool and a `words` file part (word-level timestamps, needed only
when `captions` is true). See [ARCHITECTURE.md](ARCHITECTURE.md)'s API
Reference for the current, accurate field list — `overlapWindows` and
`speakerToTrack` in particular no longer match what `/export` actually
takes, now that voice-to-face matching is automatic rather than a manual
`Record<speakerId, trackId>` built in the cast screen.

All string fields must be declared `Form(...)` in FastAPI, not plain `str` —
a plain `str` parameter on an endpoint that also takes `UploadFile` is
inferred as a **query** parameter, not form data, and the request 422s. Real
bug, caught only by an actual HTTP call through the browser, not by any
direct Python-level test.

**Response:** `video/mp4` binary body, streamed from disk via `FileResponse`
(not read into memory and returned as a plain `Response` — for a 4K, multi-
GB export, buffering the whole rendered file in memory before returning it
is exactly the kind of thing that breaks under real file sizes; see §11).
`Content-Disposition: attachment; filename="<original-name>-edited.mp4"`.
Synchronous — the HTTP request stays open for the full render duration (see
§7 for why this is fine, not a missing feature).

**Why re-send `faces` and `layoutChoices` instead of a session/job concept:**
this project has no database, no persisted upload, no session ID beyond the
existing `session_id` used for `decisions.jsonl` logging (App.tsx's
`handleFile()`). Re-sending everything the server needs per request matches
the existing two endpoints exactly and needs no new infrastructure. A
session-persistence layer is real, unrequested scope — skip it.

```python
@app.post("/export")
async def export_endpoint(
    file: UploadFile,
    layoutChoices: str,      # JSON string, form field
    overlapWindows: str,     # JSON string, form field
    faces: str,              # JSON string, form field
) -> Response:
    ...
    return Response(content=mp4_bytes, media_type="video/mp4", headers={
        "Content-Disposition": f'attachment; filename="{output_name}"',
    })
```

---

## 5. Render pipeline (`server/pipeline/render.py`, new file)

### 5.1 Pipeline steps

```
source file
    │
    ▼
build RenderSegments (§3.4)  ──── turns + overlapWindows + layoutChoices
    │
    ▼
for each RenderSegment:
    build one ffmpeg filter chain:
      trim=start:end → crop/pad math (§5.2/5.3) → scale → setpts=PTS-STARTPTS
    │
    ▼
concat all filter chains (filter_complex concat, video-only, N inputs → 1 output)
    │
    ▼
mux with ORIGINAL untouched full-length audio track
    │
    ▼
output MP4 (H.264, same resolution as source: frameWidth × frameHeight)
```

**Added in a later phase:** when `captions=true`, an `ass` filter burning in
`captions.py`'s subtitle file is inserted into the same `filter_complex`
graph, after concat. Needs an `ffmpeg` built with libass — see
[ARCHITECTURE.md](ARCHITECTURE.md)'s Known Limitations.

One `ffmpeg` invocation, one `filter_complex` graph — not N separate
ffmpeg processes stitched together after the fact. This is what "expect
per-segment re-encoding, not a stream-copy" (roadmap) means concretely for
*video*: each segment gets its own `trim` + crop + `scale` filter nodes
inside a single graph, then a `concat` filter joins them. Audio is a
separate question — see §11, which was updated after this doc closed: audio
is now stream-copied when the source codec allows it, not unconditionally
re-encoded.

### 5.2 Bust-shot crop math (single-speaker "zoom" and each composite pane)

`faceCrop.ts`'s existing `computeZoomStyle()` (pad=0.8, capped 3.5x) is a
CSS-transform approximation for the live browser preview — cover-fill
behavior computed client-side, cheap to recompute per frame. The render
pipeline needs the *same visual result*, but expressed as an ffmpeg
`crop`+`scale` filter operating on actual pixels, not a CSS transform. Port
the math, don't reinvent it:

```python
def bust_shot_crop(bbox: BBox, frame_w: int, frame_h: int, pad: float = 0.8) -> CropRect:
    """Same cover-fill math as faceCrop.ts's computeZoomStyle, in pixel space
    instead of CSS percentages. Keep these two in sync — see the frontend
    unit test in §8 that asserts parity."""
    cx, cy = bbox.x + bbox.width / 2, bbox.y + bbox.height / 2
    padded_w, padded_h = bbox.width * (1 + pad * 2), bbox.height * (1 + pad * 2)
    scale = min(3.5, max(1, frame_w / padded_w, frame_h / padded_h))
    crop_w, crop_h = frame_w / scale, frame_h / scale
    x1 = max(0, min(frame_w - crop_w, cx - crop_w / 2))
    y1 = max(0, min(frame_h - crop_h, cy - crop_h / 2))
    return CropRect(x=x1, y=y1, width=crop_w, height=crop_h)
```

`ffmpeg` filter per zoom segment:
`crop={crop_w}:{crop_h}:{x1}:{y1},scale={frame_w}:{frame_h}`.

**The exact `pad` ratio is intentionally not finalized here** — the roadmap
explicitly deferred that to tuning against real footage, not a value fixed
on paper. `0.8` (the current live-preview default) is the starting point;
expect this to change after Next Steps #3's real-world test. Keep it a named
constant in one place (`render.py` and `faceCrop.ts` both import/reference
the same conceptual value — for now, MUST be manually kept identical across
the Python and TypeScript copies since there's no shared-code mechanism
between the two runtimes; a mismatch here is silent and only shows up as
"preview doesn't match export," so the parity test in §8 exists specifically
to catch drift).

### 5.3 Multi-speaker composite pane layout

For a `RenderSegment` with `layout = "split"` and `speaker_bboxes` of length
`N` (2 or more):

```
16:9 frame, N=2:
┌─────────────┬─────────────┐
│   pane 0     │   pane 1    │   each pane: frame_w/N wide, frame_h tall,
│  (speaker A) │ (speaker B) │   bust-shot crop centered on that speaker's
│              │             │   face, "cover"-filled into the pane rect
└─────────────┴─────────────┘
```

Each pane gets its own `bust_shot_crop()` call, target dimensions
`frame_w/N × frame_h` instead of the full frame — same cover-fill math,
smaller target rect. `ffmpeg` builds each pane as
`crop=...,scale=...`, then `hstack=inputs=N` joins them left to right in
`speaker_bboxes` order (order comes from the diarization speaker id, low to
high — arbitrary but stable, avoids panes swapping position turn to turn for
the same two people).

**Capped at N=3.** Beyond 3 concurrent speakers, panes get too narrow to be
a "comfortable head-and-shoulders framing" (the roadmap's own stated bar,
not a made-up one) — a 4th+ speaker in an active overlap window falls back
to whichever 3 have the most total speaking time in that window (a simple,
defensible tiebreak, not a hard problem). This cap is a real product
decision, called out again in the UX PRD's open questions — most podcasts
this tool targets are 2-3 people, so N>3 concurrent overlap is expected to
be rare, but "rare" isn't "never" and the fallback needs to not crash.

### 5.4 Original layout

No crop filter — `scale={frame_w}:{frame_h}` only (source is already this
resolution per `/detect-faces`'s `frameWidth`/`frameHeight`, so this is
close to a no-op filter, kept only so every segment goes through the same
filter-chain shape for the concat step).

---

## 6. Frontend changes

### 6.1 `ExportButton.tsx` — from stub to real

Currently a disabled button with an explanatory tooltip
(`ExportButton.tsx:6-20`). Becomes:

- `idle` → button enabled, click triggers export
- `exporting` → button disabled, shows indeterminate progress (no per-segment
  progress from a synchronous fetch — see §7 for why polling/streaming
  progress is explicitly out of scope for this phase)
- `done` → shows a link/button to save the returned MP4 blob (browser
  `Blob` + `URL.createObjectURL`, same object-URL pattern `EditorView`
  already uses for the source video, same StrictMode double-invoke caveat
  applies — see `ARCHITECTURE.md`'s React bug note)
- `error` → shows the server's error message, button re-enabled to retry

### 6.2 Export request assembly

`EditorView` already holds `layouts` (the `Record<turnIndex, Layout>` state)
and computes `defaultLayout` implicitly via the same rule used to seed it
(`EditorView.tsx:44`). `ExportButton` needs `turns`, `layouts`,
`speakerToTrack`, `faces`, `overlapWindows`, and `file` passed down as props
— all of which `EditorView` already receives or owns. No new global state,
no new data fetching; this is prop threading, nothing more.

### 6.3 `decisions.jsonl` logging (roadmap Next Steps #2)

Same `layoutChoices` array built for the export request body doubles as the
decision log payload — write it to
`server/logs/<session_id>/decisions.jsonl` server-side, inside the
`/export` handler, after a successful render (log the decision only when the
export actually completes, not on every click — a failed/retried export
shouldn't produce duplicate or partial log lines). `session_id` is generated
client-side in `App.tsx`'s `handleFile()` (`crypto.randomUUID()`) and
threaded through as a fifth form field on the `/export` request, exactly as
the roadmap specifies.

---

## 7. Why synchronous, not a job queue

The existing `/transcribe` and `/detect-faces` endpoints are synchronous —
the frontend shows a static "processing" message for however long it takes
(`App.tsx:44-50`). `/export` follows the same pattern: one HTTP request,
held open until the MP4 is ready, response is the file bytes.

A job queue (submit → poll for status → download when ready) would need: a
job store, a polling loop, a progress-reporting mechanism inside `ffmpeg`
(non-trivial — parsing `ffmpeg`'s stderr progress output is its own small
project), and a way to clean up abandoned jobs. None of that is needed for a
single local user running one export at a time — it's exactly the kind of
speculative infrastructure the "does this need to exist at all" check rules
out. If export times turn out to be long enough that a static "exporting..."
message feels broken (multi-minute waits with zero feedback), the fix is an
indeterminate progress spinner with elapsed time, not a queue.

**Real risk worth naming:** browser default fetch timeouts are typically
long enough for this (no default timeout on `fetch()` itself), but a
40-minute episode with heavy per-segment re-encoding could plausibly take
several minutes. Worth timing on the real test file before Next Steps #3,
not assumed fine on paper.

---

## 8. Testing plan

| Layer | What | Notes |
|---|---|---|
| Unit (Python) | `bust_shot_crop()` matches `faceCrop.ts`'s `computeZoomStyle()` output for the same inputs, across a table of bbox/frame-size cases | Prevents preview/export drift (§5.2) |
| Unit (Python) | `build_render_segments()` — gapless, duration-complete, correct layout per sub-range, including: turn with no face, forced split with no overlap window, overlap window spanning a turn boundary, back-to-back turns with no gap, video with a long silent gap | This is where the real edge-case risk lives — see §3.4 |
| Integration | `POST /export` end-to-end on a short synthetic test video (reuse whatever fixture the existing manual `curl` verification used — see `ARCHITECTURE.md`'s "verified three ways" note) → assert response is a valid MP4, correct duration, correct resolution | |
| Manual/E2E | Real recorded episode through the full pipeline → export → watch it | This IS Next Steps #3, the actual validation step — not a substitute for it |

No automated test suite exists yet at all (`ARCHITECTURE.md`, Known
Limitations) — this is the first phase that should ship with one, given
`render.py`'s segment-construction logic is exactly the kind of thing that
silently produces a corrupted or desynced file if it's wrong, with no error
from `ffmpeg` to catch it.

---

## 9. File structure additions

```
server/
├── pipeline/
│   ├── render.py            # NEW — RenderSegment construction + ffmpeg orchestration
│   └── diarize.py           # MODIFIED (if Option A) — adds overlap detection
├── logs/
│   └── <session_id>/
│       └── decisions.jsonl  # NEW — written by /export on success

src/
├── features/timeline/
│   └── ExportButton.tsx     # REWRITTEN — real request, not a stub
├── lib/
│   └── faceCrop.ts          # UNCHANGED — render.py ports its math, doesn't import it (different runtimes)
```

---

## 11. Large files and output quality

Added during implementation once real usage was clarified: editors upload
4K source footage, files up to ~5GB, and export quality must not visibly
degrade versus the source.

- **Upload handling.** `UploadFile.read()` with no size argument pulls the
  entire upload into one in-memory `bytes` object before writing it to disk.
  For a 5GB file that's a 5GB allocation per request. All three endpoints
  (`/transcribe`, `/detect-faces`, `/export`) now stream the upload to disk
  in 4MB chunks instead (`main.py`'s `_save_upload`).
- **Export response handling.** Reading the entire rendered output back into
  memory before returning it as a `Response` has the same problem in
  reverse, and the rendered file can be *larger* than the source (see CRF
  choice below). `/export` now returns a `FileResponse`, which streams the
  file from disk. This has a real correctness consequence: `FileResponse`
  streams *after* the endpoint function returns, so the temp directory can
  no longer be a `with tempfile.TemporaryDirectory()` block (which would
  delete the file before it's sent). It's `tempfile.mkdtemp()` now, cleaned
  up via a `BackgroundTask` that Starlette runs once the response has
  actually finished sending, with an explicit `shutil.rmtree` in the
  exception path too.
- **Video quality.** The render pipeline forces a real re-encode per segment
  (cropping requires it — no way around that). Default `libx264` behavior
  (`-preset veryfast`, no explicit CRF, defaulting to CRF 23) is visibly
  lossy against 4K source footage. `render.py` now sets `-preset medium`
  and `-crf 16` — 16 sits below the commonly-cited CRF 18 "visually
  lossless" threshold for x264; `medium` (ffmpeg's own default, up from
  `veryfast`) trades encode time for meaningfully better compression
  efficiency at the same quality target, not a quality tradeoff itself.
  Confirmed against a real recording: output bitrate (2.5Mbps at 1080p for
  the test clip) came out *higher* than the (already-compressed) source's
  1.35Mbps, and a frame-by-frame visual check showed no visible compression
  artifacts.
- **Audio quality.** Audio content is never modified (no cuts, no ducking —
  §1's Option A note on this still holds), but it still passes through an
  encoder rather than a stream copy, because a plain `-c:a copy` into an MP4
  container isn't universally safe across the audio codecs professional
  camera gear might produce (ALAC, PCM, etc. don't remux into MP4 as-is).
  `-b:a 320k` (a standard near-transparent ceiling for spoken-word content)
  replaces the previous unset default. A true stream copy would be strictly
  lossless when the source codec allows it — flagged as a future
  improvement (detect AAC-in-compatible-container and copy), not built now,
  since the always-works transcode path was the higher priority given
  editors may bring varied camera audio formats.

  **Built since this doc closed:** the flagged improvement shipped.
  `render.py` now stream-copies (`-c:a copy`) when the source audio codec is
  one of `aac`/`mp3`/`alac`/`ac3`/`eac3`, and only falls back to the 320k
  AAC re-encode above for anything else. Measured bit-identical on a real
  export: 320009 bps in, 320009 bps out.
- **Disk space, not addressed.** A 5GB upload plus its extracted WAV plus a
  same-or-larger rendered output can transiently need 10GB+ of temp disk
  space per export. No pre-flight disk-space check exists. Real operational
  gap for a genuinely disk-constrained machine, not fixed here — flagged for
  whoever hits it first.

---

## 12. Decisions log

| Decision | Chosen | Rationale |
|---|---|---|
| Overlap detection approach (§1) | **Option A — adopt `pyannote.audio`** | Only option that gives the composite feature (already promoted to core scope) an honest trigger signal. Accepted the one-time HF-account setup cost. |
| Upload/response memory handling (§11) | **Stream to/from disk, never fully buffer** | 5GB files make full in-memory buffering a real risk, not a theoretical one. |
| Video encode quality (§11) | **CRF 16, preset medium** | Default settings (CRF 23, veryfast) were visibly lossy against 4K source; re-encoding is unavoidable given per-segment cropping. |
| Audio encode quality (§11) | **AAC at 320k, not a stream copy** | Stream copy isn't safe across all camera audio codecs into MP4; 320k AAC is a robust, near-transparent default. Superseded — see §11's "Built since this doc closed": it's now a conditional stream copy, re-encoding only for a codec that isn't MP4-safe. |

This doc is closed and reflects the implementation as actually built (Phase
4 is implemented — see `server/pipeline/render.py`, `server/main.py`'s
`/export` endpoint, and the frontend composite/export UI). `pyannote.audio`
integration into `diarize.py` shipped as part of this phase, though `diarize.py`
has since moved past this doc's scope too: it's the full diarization model
(`pyannote` community-1) now, not `resemblyzer` clustering with `pyannote.audio`
bolted on for overlap only — see [ARCHITECTURE.md](ARCHITECTURE.md) and
[STATUS.md](STATUS.md) for the current design.

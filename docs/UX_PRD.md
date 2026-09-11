# UI/UX PRD — Podcast Editor (Phase 4: Real Export + Multi-Speaker Framing)

This covers what the UI needs to *do* for the next phase of work — screens,
flows, states, interactions. It does not cover what things *look like*
(colors, typography, spacing, motion) — the roadmap doc explicitly flagged
visual/UI design language as "entirely unaddressed" and recommended a
separate `/design-consultation` pass for it once the real-world test (Next
Steps #3) is done. That sequencing stands; this doc is requirements, not
visual design.

Companion doc: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — read
that first if you want the data/API side of the features described here.

---

## 1. Who this is for

- **Primary user (now):** Eshan, self-use. One person, editing their own
  recorded episodes, running both services locally.
- **Target validation user (Next Steps #3):** a podcast-host friend who
  currently edits manually. They will use this without any onboarding from
  Eshan present — the UI has to explain itself.

No multi-user, no accounts, no roles. Every screen assumes one person at a
local machine.

---

## 2. End-to-end flow

```
┌────────┐   file    ┌────────────┐  turns+people  ┌──────────┐  names+voices  ┌──────────┐  export  ┌────────┐
│ Upload │ ────────▶ │ Processing │ ─────────────▶ │   Cast   │ ─────────────▶ │  Editor  │ ───────▶ │ Result │
│ +drop  │           │ live %     │                │ name +   │                │ names,   │          │ (.mp4) │
└────────┘           │ per stage  │                │ match    │                │ per-turn │          └────────┘
     ▲               └────────────┘                │ voices   │                │ fixes    │
     │                      │ error                └──────────┘                └──────────┘
     └──────────────────────┘                                                        │ error
                                                                                     ▼
                                                                            (stay in editor, retry)
```

Six states in `App.tsx`'s `Status` union: `idle`, `processing`, `cast`,
`editing`, `error`, plus the export result rendered inside the editor.

---

## 3. Screen-by-screen requirements

### 3.1 Upload (`UploadScreen.tsx`) — existing, one real gap found

**Current behavior:** click-to-browse file input styled as a drop zone. Copy
says "Drop in a podcast recording" but there is no `onDrop` handler — the
box is not actually a drop target, only a styled `<label>` wrapping a
hidden `<input type="file">`.

**This is a real mismatch between copy and behavior, not a style nitpick** —
a first-time user (the target friend, specifically) will try to drag a file
onto a box that says "Drop in a podcast recording" and nothing will happen,
with no feedback explaining why. Two ways to close it:

- **Fix the copy** ("Choose a video or audio file" — already what the
  `<label>` text says one line below; drop the misleading first line), zero
  new code.
- **Fix the behavior** (add real `onDragOver`/`onDrop` handlers), small
  amount of new code, matches the promise already made in the copy.

**Decided: build real drag-and-drop.** Given this tool's whole premise is
removing manual friction, actually supporting drag-and-drop fits the
product better than just fixing the copy, and the cost is small
(`onDragOver`/`onDrop` handlers on the existing drop-zone `<label>`, plus a
visual state for "file hovering over the drop zone"). The current copy
stays accurate once this ships.

**Other requirements (unchanged, already met):**
- Accepts `video/*,audio/*` — no client-side size or format validation
  beyond what the browser file picker itself filters.
- Error state: shows the server's error message inline, does not lose the
  upload attempt (user can just pick a file again).
- Explains the local-service dependency in-page (the "needs the local
  processing service running" note) — keep this; it's the single most
  likely first-run failure for a non-technical user and the copy already
  includes the exact command to fix it.

### 3.2 Processing (`ProcessingScreen.tsx`) — rebuilt

**This doc originally deferred progress as "decoration".** That was wrong.
Real use disproved it: a five-minute upload with a single static sentence is
indistinguishable from a hung app, and there was no way to tell whether
anything was happening. Reversed and built.

Three rows, each with a real bar:

1. **Upload** — actual bytes sent. Needs `XMLHttpRequest`; `fetch()` cannot
   report upload progress at all.
2. **Transcript & speakers** — stage name (extracting audio / transcribing /
   identifying speakers / detecting overlapping speech) plus a real fraction
   for transcription, derived from how far through the audio Whisper's last
   yielded segment reached.
3. **Faces** — stage name plus fraction across sampled frames.

Server stages are polled from `GET /progress/{job_id}`. Also shows file name
and size, elapsed time, and an honest throughput expectation (measured:
roughly a fifth of real time on a laptop CPU).

**Related fix found while building this:** the app was uploading the file
*twice*, once for each of the two parallel endpoints — 10GB of transfer for
a 5GB recording. Merged into a single `/process` call.

### 3.3 Cast setup (`CastScreen.tsx`) — replaced the old labelling screen

The original screen asked the user to map a face to "Speaker 1", where
"Speaker 1" was an anonymous diarisation cluster id. The user had no way to
know which cluster was which person, which made the single most important
input in the whole pipeline a guess. Replaced with one screen that does two
things:

1. **Name everyone.** Each recognised person gets a name (defaults "Person
   N"). Those names are then used everywhere downstream, so no other screen
   ever shows a meaningless id.
2. **Match each voice to a person, with evidence.** For every distinct voice
   diarisation found, show the longest thing it said plus a Play button that
   plays exactly that stretch, and a dropdown of named people. The question
   becomes "who is this?" with the answer audible, instead of "which cluster
   is Speaker 2?".

Also collects an optional one-line episode description.

**Per-turn correction lives in the editor** (§3.4), not here — diarisation
will occasionally get a turn wrong, and the fix has to be reachable at the
point where the mistake is visible.

### 3.4 Editor (`EditorView.tsx`) — the screen most of this phase touches

**Existing, keep unchanged:** turn list with speaker-colored cards, per-turn
Original/Zoom/Split override buttons, seek-to-turn-on-click, "no face
mapped" badge for unmatched speakers.

**New: multi-speaker composite live preview.** When the active turn falls
inside an `OverlapWindow` (or the user manually selects "Split" — see
`TECHNICAL_ARCHITECTURE.md` §3.3's fallback chain for that case), the
preview area should show the *actual* multi-pane composite the export will
produce — not the current placeholder text ("Split-screen preview — coming
in a later phase"). This is "live preview parity," listed in the roadmap's
"Rest of the roadmap" as something that should exist *before* a turn is
exported, not just discovered at export time.

Two ways to build the live version, both cheap relative to writing the
render pipeline itself:

- Two (or N) `<video>` elements, same `src`, same `currentTime`, each with
  its own CSS crop transform (reusing `faceCrop.ts`'s existing math per
  pane, just narrower target width), laid out side by side with flexbox. No
  new video-decoding cost beyond N decoders playing the same file in sync
  (acceptable for N ≤ 3, per the render pipeline's own pane cap).
- A single `<canvas>` compositing crops from one hidden `<video>` — more
  work, no clear benefit for N ≤ 3, not recommended.

**Requirement, not implementation detail:** the live preview's pane layout,
crop math, and pane cap (N=3, same tiebreak rule as the render pipeline —
see `TECHNICAL_ARCHITECTURE.md` §5.3) must match what `/export` actually
renders. A preview that shows something different from the real export
output is worse than the current honest placeholder — it would show the
user a result they can't actually get.

**New: overlap "instruction box" indicator.** A visual flag on the turn
list (or timeline) marking "multiple people are talking here" wherever an
`OverlapWindow` exists — independent of whatever layout is currently
selected for that stretch of time. This is buildable now regardless of the
Technical Architecture doc's Option A/B/C decision on overlap detection
*quality* — if Option C is chosen (no overlap detection this phase), this
indicator simply never appears, which is honest, not broken.

- Minimum requirement: some visible marker (badge, colored bar segment,
  icon — exact visual treatment deferred to the later design pass) on the
  turn(s) whose time range intersects an `OverlapWindow`, plus the list of
  which speakers are overlapping (e.g. "Speaker 1 + Speaker 2 talking over
  each other").
- Explicitly NOT required this phase: audio ducking, volume indication, or
  any audio-affecting behavior — this is a visual flag only, exactly as the
  roadmap scoped it ("straightforward now... isolating one speaker's voice
  ... is a real open question").

**Per-turn Zoom framing — no visible UI change, but the padding ratio
matters.** `computeZoomStyle`'s current `pad=0.8` produces the live preview
users see today; the export needs to produce the *same* framing (see
`TECHNICAL_ARCHITECTURE.md` §5.2). No new UI here — flagging it because a
future padding-ratio tune (after Next Steps #3's real-world test) has to
land in both `faceCrop.ts` and `render.py` together, or the live preview and
the actual export will visibly disagree.

**Annotation button — unchanged.** Still disabled, still explains why. Not
in scope for this phase (confirmed against roadmap: annotations come after
export/split/captions in "Rest of the roadmap").

### 3.5 Export — was a stub, now a real flow

Four states, per `TECHNICAL_ARCHITECTURE.md` §6.1:

| State | What's shown | What can go wrong |
|---|---|---|
| `idle` | Enabled "Export" button | — |
| `exporting` | Button disabled, indeterminate progress indicator, explanatory copy ("Rendering — this can take a few minutes for longer episodes") | User closes tab mid-export (see below) |
| `done` | Success state with a way to save the MP4 (browser download of the returned blob) | Large file, browser download prompt behavior varies by browser — acceptable, not this project's problem to solve |
| `error` | The server's error message, button re-enabled to retry | Retry re-sends the full request; no partial-progress recovery — acceptable for a synchronous, non-queued design (see Technical Architecture §7) |

**Edge case worth naming explicitly: closing the tab or navigating away
mid-export.** Since `/export` is a synchronous fetch, closing the tab
aborts the request client-side, but the server-side `ffmpeg` process may
keep running orphaned (depends on how FastAPI handles a dropped connection
mid-`await`). This is a real correctness question for `render.py`'s
implementation (should the server watch for a disconnected client and kill
the ffmpeg subprocess?) — noted here as a requirement the technical
implementation needs to answer, not solved in this doc.

**Not required this phase:** re-export without re-running transcription
(would need persisted turns/faces across sessions — no such persistence
exists, correctly scoped out per `ARCHITECTURE.md`'s "Track IDs aren't
stable across separate uploads" limitation). Exporting is a one-shot action
from within a single editing session, same lifetime as everything else in
`App.tsx`'s state machine.

---

## 4. Error & edge-case matrix

| Situation | Where it surfaces | Current handling | This phase |
|---|---|---|---|
| Local service not running | Upload | Copy explains the fix inline | Unchanged |
| Transcription/detection fails mid-request | Processing → Error | Generic error message, back to Upload | Unchanged |
| Zero faces detected | Labeling | Screen still renders with an empty grid (untested edge case — worth a manual check, not a code change) | Confirm behavior, no new requirement found |
| Turn's speaker has no mapped face | Editor | "no face mapped" badge, forces Original layout | Unchanged; render pipeline mirrors this fallback (Technical Architecture §3.3) |
| User forces Split on a non-overlapping turn | Editor / Export | N/A (Split was a placeholder) | New fallback chain — see Technical Architecture §3.3; UI doesn't need to prevent the selection, just needs the result (composite of best-available faces, or fallback to Zoom/Original) to make sense on screen |
| 4+ concurrent speakers in one overlap window | Editor / Export | N/A | Capped at 3 panes (Technical Architecture §5.3). **Decided:** show a "+N more" indicator on the composite/overlap flag rather than silently dropping the excluded speaker(s) — small UI addition, avoids confusing the viewer about who's missing |
| Export takes several minutes on a long episode | Export | N/A | Indeterminate progress. **Decided:** no cancel button this phase — needs server-side dropped-connection handling to kill the ffmpeg subprocess cleanly, which is real backend work out of this phase's scope, not a checkbox |

---

## 5. Explicitly out of scope for this PRD

- Visual design system: colors, typography, spacing scale, motion,
  component library — deferred to a `/design-consultation` pass after Next
  Steps #3, per the roadmap's own sequencing.
- Captions, jargon annotations, audio effects, intro/outro presets — all
  later roadmap items, untouched by this phase.
- Voice ducking / any audio-editing UI — gated on the source-separation
  research spike; this phase's overlap indicator is visual-only by design.
- Style-learning from corrections UI — gated on evidence of repeat usage,
  per the roadmap's Approach C deferral.
- Mobile/responsive layout — this is a local desktop tool for a person
  running two local services; no mobile use case exists or is implied.
- Accessibility audit — worth doing before any wider public release (ties
  to the roadmap's separate "public-release readiness" pass), not blocking
  for the self-use validation test this phase is building toward.

---

## 6. Decisions log

| Decision | Chosen | Rationale |
|---|---|---|
| Drag-and-drop on Upload (§3.1) | **Build it for real** | Fits the product's "remove manual work" premise; cost is small |
| 4th+ concurrent speaker treatment (§4) | **Show a "+N more" indicator** | Avoids silently hiding an excluded speaker; small UI addition |
| Export cancel button (§3.5) | **Deferred** | Needs real backend work (dropped-connection handling) out of this phase's scope |

This doc is closed and implemented alongside
[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — export, the
multi-speaker composite live preview, the overlap indicator, and real
drag-and-drop are all built and verified against a real recording.

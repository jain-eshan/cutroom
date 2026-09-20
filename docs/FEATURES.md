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
| 8 | [Smarter cutting (dead air & filler words)](#8-smarter-cutting) | Shipped |
| 9 | [Burned-in captions](#9-burned-in-captions) | Shipped |
| 10 | [Decision logging](#10-decision-logging) | Shipped, unused so far |
| 11 | [Text/bubble annotations](#11-text-bubble-annotations) | Stub |
| 12 | [Voice ducking for overlapping speech](#12-voice-ducking) | Not started |
| 13 | [Style learning from corrections](#13-style-learning) | Not started |
| 14 | [Automatic social clips](#14-automatic-social-clips) | Not started |
| 15 | [Multi-camera support](#15-multi-camera-support) | Not started |
| 16 | [Desktop packaging](#16-desktop-packaging) | Shipped |
| 17 | [Credits](#17-credits) | Shipped |
| — | [Vary shot length](#vary-shot-length-deferred) | Deferred |

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

Framing is a set of shots on a timeline, not a layout per turn. A shot can
start partway through a line and run through several, and anything no shot
covers is the wide shot. There are three kinds, computed from real detected
face positions:

- **Wide**: the untouched frame.
- **Close-up**: a medium shot on one person, framed the way a professional
  podcast edit frames a seated subject (measured from real reference edits;
  see [STATUS.md](STATUS.md#measured-not-asserted)).
- **Both on screen**: a real multi-person composite. Two people sit side by
  side; three get one large pane -- the person actually holding the floor --
  with the others stacked beside it, in seat order. Automatic suggestions
  stop there: four or more people talking at once suggests the wide shot
  instead of a wall of narrow panes, though a composite of any size can
  still be added by hand.

The suggested shots are simple today: a close-up of whoever says each line,
everyone involved wherever people talk over each other for a second or more,
and wide in between. That cuts to people who only say a word and flashes the
wide shot at every pause. The rules meant to replace it, and every known edge
case, are in [EDGE_CASES.md](EDGE_CASES.md).

*Implementation:* `src/lib/faceCrop.ts` (live preview math),
`server/pipeline/framing.py` + `render.py` (export render math — same
formulas, kept in sync deliberately).

### 5. Overlap detection

A visual flag on the transcript wherever more than one person is talking at
once — independent of what layout is currently chosen for that stretch.
This is what actually decides when Split gets suggested automatically, and
it's a *visual* signal only: it doesn't touch audio (see
[#12](#12-voice-ducking) for why that's a separate, unsolved problem).

*Implementation:* part of the diarization pass in
`server/pipeline/diarize.py` — community-1 finds overlapping speech in the
same pass that identifies speakers, rather than needing a second model.

### 6. Editor

Three panels driven by one selection: the transcript, with real names and a
one-line reason for each automatic decision; a live preview that uses the
same framing maths as the export, on a stage sized to the recording's own
shape; and the framing timeline.

The preview crops against the pane ffmpeg will render into, in source pixels
(`exportPanes` in `src/lib/faceCrop.ts`, a port of `_segment_filter` in
`server/pipeline/render.py`), not against its own size on screen. Those are
different shapes, and `personCrop` takes both the crop's aspect and its
minimum height from what it is given, so cropping against the window used to
frame a close-up about 1.7% tighter than the export produced -- measured at
738.5x415.4 rendered against 726.1x408.5 shown, on a real face from a
1080p episode. Every crop nudge inherited that error, since a nudge is a
fraction of the crop's own size.

The timeline works like a video editor's, cut down to what a podcast needs:

- An overview strip of the whole episode above a zoomable detail view. Zoom
  with the buttons, `=` and `−`, or pinch / ⌘-scroll; "Show all" zooms out.
  The cluster is labelled and shows what it is showing ("Zoom · whole
  episode", "Zoom · 2:30 shown"), because three quiet buttons -- two of them
  correctly disabled at full view -- read as dead chrome, and zoom and scroll
  were both reported as missing features when both had shipped.
- A timecode ruler to scrub along, and a playhead that pages the view when it
  runs off screen.
- Shots you pick and drag by either edge. Edges snap to words, line
  boundaries, other shots and the playhead, and Option drags freely. The
  picked shot's exact start and end show underneath.
- Add a close-up or a both-on-screen shot for the current line, make a shot
  wide, or reset to the suggestions.
- Undo and redo with ⌘Z and ⇧⌘Z, or the buttons.
- Keyboard: Space, J (back 5 s), K, L (2×, 4×), the arrows, ↑/↓ between
  shots, Delete and Esc. The Shortcuts button lists them.

The transcript can be corrected. Double-click a word to retype it; the
timings never move, because the timings were not what was wrong. Where the
same word was misheard elsewhere -- and it usually was, since transcription
gets a proper noun wrong the same way every time -- Shift-Enter fixes every
occurrence at once, each keeping its own punctuation. On the reference
episode "Practo" is heard as "Pacto" in ten places, spread over four tokens
because five of them end a clause; one correction fixes nine of them, and
the possessive "Pacto's" is left as its own word.

Corrections are stored as word index to replacement, beside the edit rather
than inside the transcript, so the pipeline's own output is never rewritten
and an autosave carries a handful of replacements instead of 550KB of
timings. They reach the burned-in captions, which are cut from these words.

The transcript follows the talk. The line being spoken is split into its own
words, with the one being said lit; it scrolls itself into view when the line
changes; and clicking a word seeks to exactly that word. Only the spoken line
is split -- 8,824 words is a lot of spans to carry in order to light one.

Each speaker lane carries its name, and the lanes hide. Colour identifies the
*person*, not the voice: diarisation routinely splits one person into several
voices (six for four people on the reference episode), so colouring by voice
gave one human two colours and read as two people.

Captions are drawn over the preview when they're on, grouped by the same
rules the export uses (`buildCaptionCues` ports `build_caption_cues`) and
placed where `write_ass` puts them. "Captions on" is a real toggle; it used
to be a status label that looked like a button, beside a preview that never
drew a caption.

Shipped: split at the playhead (`S`), waveforms on the speaker lanes and
timeline thumbnails, stepping through the review flags (Tab/Shift+Tab), a
shot inspector with exact start/end times and a crop nudge, a per-episode
framing style (Wide only / Gentle / Dynamic) that governs how much automatic
framing gets suggested -- switching it never touches a shot made by hand --
and a who's-on-screen picker in the inspector: toggle chips for everyone the
pipeline found on camera, so a shot isn't limited to the automatic pairing.
See [STATUS.md](STATUS.md).

Edits autosave. Everything the editor decides -- the confirmed cast, every
shot, the framing style, the captions and dead-air options -- is written to
the job on disk about a second after the last change, and flushed on
`pagehide` so quitting straight after a change doesn't lose it. Reopening an
episode with a saved edit goes straight back into the editor rather than
starting again at Cast. The saved edit is versioned and checked on read: an
edit this build doesn't recognise opens at Cast instead of being half-read,
because silently restoring part of one would look like the shots were kept
while quietly dropping some.

Episodes save as `.cutroom` project files. "Save a copy" in the title bar
writes everything about an episode except the recording -- the transcript,
the word timings, the faces and their keyframes, the waveform, the timeline
thumbnails and the edit -- as a single file. Measured on the 53-minute
four-person reference episode: **1.2MB**, against a 5.3GB recording. Small
enough to back up, sync or email.

The recording is referenced, not contained, the way a Premiere or Resolve
project references its media. A project records where the recording was; open
one where that path is wrong -- another machine, a moved file, a synced folder
that evicted it to cloud-only -- and the episode still opens fully editable
with only the picture missing, and the editor asks for the file ("Find the
recording&hellip;"). Relinking points at the file rather than copying it.

Open a project by dropping it on the upload screen, picking it there, or
choosing "Open a .cutroom file". A project from a newer version of Cutroom is
refused with a sentence rather than half-read, and a file that isn't a project
is refused as one.

*Implementation:* `server/pipeline/project.py` (the format, its reader and
relinking), `src/features/timeline/EditorView.tsx`, `TimelineTray.tsx`,
`regions.ts` (shot suggestions and edits, mirrors `render.py`),
`timelineView.ts` (zoom, ruler and snapping maths) and `src/lib/savedEdit.ts`
(the saved-edit format and its reader). All tested with `npm test`; the
autosave endpoint is tested in `server/tests/test_jobs_endpoints.py`.

### 7. Export

Renders a real MP4: hard cuts where the framing changes, the medium-shot framing
from [#4](#4-auto-framing), real multi-person composites, source resolution
preserved, and the original audio stream-copied (not re-encoded — a
podcast's audio is never actually edited, so there's no reason to pay a
quality-loss generation for it). Verified frame-accurate and duration-exact
against real footage — see [STATUS.md](STATUS.md#measured-not-asserted).

*Implementation:* `server/pipeline/render.py`, `POST /export` in
`server/main.py`.

### 8. Smarter cutting

An opt-in export checkbox ("Trim dead air & filler words") that cuts a real
edit closer to what a human editor would leave in:

- **Dead air.** A pause longer than about 1.2s gets trimmed down to a short
  beat (~0.35s), not removed entirely — a hard cut to total silence reads as
  a jump cut, so a little breathing room survives every cut.
- **Filler words.** Standalone disfluencies (`um`, `uh`, `erm`, and similar)
  get cut from both audio and video. Deliberately narrow: words that are
  *sometimes* filler ("like", "so", "actually") are never touched, because
  there's no way to tell filler "like" from a real one from the word alone,
  and cutting the wrong one removes meaning instead of dead air.

Off by default, unlike captions — this is the one export option that
actually removes content rather than adding something on top of it. Turning
it on forces a real audio re-encode (the source audio can no longer be
copied through untouched once something's cut from it), and if captions are
also on, caption timing is remapped to the trimmed timeline so the two stay
in sync.

Not measured against real footage the way [auto-framing](#4-auto-framing)'s
constants are — there's no reference edit to tune the "how long is too long
a pause" cutoff against yet. Treat the current thresholds as reasoned
defaults, not settled numbers.

*Implementation:* `server/pipeline/trim.py` (range detection + timeline
remapping), `server/pipeline/render.py` (segment dropping, trimmed-audio
render path).

#### Vary shot length (deferred)

The other half of the roadmap line this feature came from — varying shot
length so the edit doesn't cut with the same rhythm every time, rather than
just removing time. Not built: unlike dead air and filler words, there's no
clear, testable definition of "right" here without a real edit to compare
against, and guessing at a fix for a problem nobody's confirmed exists yet
is exactly the kind of premature tuning this project avoids elsewhere (see
[STATUS.md](STATUS.md)'s smoothing-layer deferral for the same reasoning).

### 9. Burned-in captions

Optional captions rendered directly into the video, cut from Whisper's
word-level timestamps rather than the coarser turn boundaries — so caption
timing tracks actual speech, not just which turn it's part of. Needs an
`ffmpeg` build with `libass` (most default installs don't have this — see
[README.md](../README.md)'s Setup section); export checks for this up
front and refuses with the fix rather than silently producing a video with
no captions after a long render.

*Implementation:* `server/pipeline/captions.py`.

### 10. Decision logging

Every successful export writes a `decisions.jsonl` log of the layout
choices made for that episode (which turns got Zoom vs Split, and any
manual corrections). Not surfaced anywhere in the UI yet — it exists so
that if a future feature wants to learn from repeated manual corrections
(see [#13](#13-style-learning)), the data already exists rather than
needing to be built retroactively.

*Implementation:* `_log_decision()` in `server/main.py`, written to
`server/logs/<session_id>/decisions.jsonl` (gitignored).

### 11. Text/bubble annotations

The button exists in the editor and explains why it's disabled. No backend
support yet. Scoped as a later roadmap item — see
[STATUS.md § What's left](STATUS.md#whats-left).

### 12. Voice ducking

Lowering one person's audio so another's is clearer during overlapping
speech. Deliberately not scoped yet: isolating one voice from a single
mixed track (no per-speaker isolation, same constraint that makes the rest
of this project hard) is a genuinely open source-separation research
problem, not an engineering checkbox. Gated on a research spike, not on
priority.

### 13. Style learning

The idea: if a future editor repeatedly makes the same kind of correction
(e.g. always overriding Split back to Zoom in a particular situation),
learn from that pattern instead of asking every time. Gated on there being
evidence of repeat editors making repeat corrections — the data collection
for this already exists ([#10](#10-decision-logging)), the learning doesn't,
and building it before there's a pattern to learn from would be guessing.

### 14. Automatic social clips

Auto-selecting short, shareable clips from a full episode. Planned to use
an offline scoring heuristic (pace, silence, turn density) rather than a
cloud LLM call, to stay consistent with the local-first design. Not
started.

### 15. Multi-camera support

Cutting between multiple camera angles, not just one fixed frame. Noted as
a stretch goal from the start of the project; not begun.

### 16. Desktop packaging

Wrapping this as a standalone desktop app (e.g. via Electron) instead of
"run two local services and open a browser tab." The architecture already
supports this without a rewrite — the frontend only ever talks to
`localhost` over HTTP, so where that service actually runs doesn't change
anything about how the frontend is built. Shipped: an Electron shell and
`electron-builder` pipeline producing a real macOS `.dmg`/`.zip` (and a
Windows `.exe` build in CI), which checks for updates from v0.3.0 on:
automatic on Windows, a "new version" prompt on the Mac until the app is
signed. Not signed/notarised yet. See [STATUS.md](STATUS.md).

### 17. Credits

The licences of everything Cutroom ships — five sets of model weights and an
ffmpeg binary — readable from inside the app, through a "credits" button in
the title bar. Not decoration: pyannote's CC-BY-4.0 permits the
redistribution that removed the Hugging Face sign-up from first use, and
asks for attribution in return, so this screen is what makes that bundling
allowed rather than merely convenient.

*Implementation:* `src/components/Credits.tsx`, opened from `AppWindow` in
`src/components/ui.tsx`. Attribution rationale for the bundled weights is in
`server/.models/diarization/NOTICE.md`.

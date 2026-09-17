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
   of turn boundaries. The timeline zooms and scrolls, has a ruler and an
   overview strip, snaps edges to words, and has undo and keyboard shortcuts.
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

**Checks:** 119 backend tests and 15 frontend tests (`npm test`) passing, `tsc` clean, `oxlint` clean (two
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

### Next: editing basics, then the desktop app, then one host test

Two founder decisions on 2026-09-15. First, the desktop app before any host
sees the product (the recommendation was the host test first). Then, after
reviewing the editor against DaVinci Resolve, the editing basics before the
app, scoped to navigation and precision: Cutroom stays a podcast auto-editor,
not a general video editor. One risk to watch: the host is free within two
weeks, and the app is still the largest item.

The automatic framing rules (short lines, overlaps, who holds the shot, how
many people fit on screen, a wide-only style) and every other known edge
case in the core product are catalogued in [EDGE_CASES.md](EDGE_CASES.md),
with the decisions they need. They aren't placed on this list yet.

**Developer preview launch, 2026-09-15.** Done ahead of the list below, at
the founder's call, to find testers and contributors early:
- A landing page in `site/` (see [site/README.md](../site/README.md)), hosted
  on Vercel, with a waitlist through an embedded Tally form.
- Contributor docs: a rewritten README with setup and troubleshooting,
  [CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), a
  [docs index](README.md), issue forms and a pull request template.
- CI on GitHub Actions: typecheck, lint, unit tests and both builds for the
  app and site, and the backend tests.
- The repository renamed to `cutroom`.

1. **Editing basics: navigation.** A timecode ruler and a playhead you can drag
   to scrub; timeline zoom and horizontal scroll with zoom-to-fit, plus a thin
   overview of the whole episode above a zoomed detail view (the idea behind
   Resolve's Cut page); keyboard transport (space, J/K/L, arrow keys to step,
   up/down for the previous or next shot); undo and redo; shot edges that snap
   to word boundaries, turn boundaries and the playhead.
   - Problem: on a long episode, shots can't be found or adjusted. A 46:56
     episode fits one strip about 1,250px wide, roughly 2.3 seconds per pixel,
     so a shot needs to be about 30 seconds long before both drag handles fit
     on it.
   - Evidence (founder, testing): "We have to improve the video editing a
     lot".
   - Measure: time to find and adjust a given shot on a 45-minute episode.
   - **Built 2026-09-15.** Overview strip, ruler, scrubbable playhead, zoom
     (`=`/`−`, pinch or ⌘-scroll, Show all) and scroll, a playhead that pages
     the view when it runs off screen, Space/J/K/L, arrows, ↑/↓ between shot
     edges, Delete to go wide, ⌘Z/⇧⌘Z with Undo and Redo buttons, snapping to
     words, turns, other shots' edges and the playhead (Option drags freely),
     and a Shortcuts sheet. Two differences from Resolve: J jumps back five
     seconds, because browsers can't play video backwards smoothly, and the
     undo history starts fresh after a visit to the publish screen. Verified
     on a synthetic 47-minute episode, not yet on real footage.
2. **Editing basics: precision.** Split a shot at the playhead; waveforms on
   the speaker lanes and thumbnails on the overview; the review flags as
   markers you step through; an inspector for the selected shot (who it
   frames, its layout, exact start and end times, a small crop nudge). Cutting
   content stays with text-based editing, below, rather than a blade tool.
   - **Built 2026-09-15.** `S` (or "Split here" in the inspector) splits the
     selected shot into two at the playhead, as one undo step. Selecting a
     shot now shows an inspector in the bottom bar: editable start/end
     timecodes, Split and Go wide, and a crop nudge (four arrow buttons,
     ±0.3 of the crop's own size, "Reset crop" once set) for when the
     automatic framing is close but not quite right -- `FramingRegion` grew
     an optional `cropNudge`, applied identically in the live preview
     (`personCrop` in `faceCrop.ts`) and the export (`person_crop` in
     `framing.py`, threaded through `Region`/`RenderSegment` in `render.py`),
     so the two can't disagree. The "N to review" badge is now a stepper
     (Tab / Shift Tab, or its ‹ › buttons) over the same flagged lines the
     transcript already marks (no face, or talking over someone). Waveform
     bars (peak-sampled from a 2000-bucket amplitude envelope computed once
     per job from the already-extracted wav) sit behind each speaker lane;
     periodic frame thumbnails sit behind the overview strip, tinted by the
     framing-decision colour on top. Both are new backend endpoints
     (`GET /progress/{job_id}/waveform`, `GET /progress/{job_id}/thumbnail/
     {index}`) following the same in-memory, job-scoped pattern as face
     thumbnails.
     - `regions.ts` has its first unit tests (previously blocked on the `@/`
       alias Node's test runner can't follow -- fixed by importing
       `faceCrop.ts` relatively, since that module's only import of `@/lib/
       api` is type-only and erases away). `faceCrop.ts` and the new
       `sampleWaveform`/`parseTimecode` helpers in `timelineView.ts` are
       tested too. 136 backend tests (was 119), 32 frontend (was 15).
     - Verified: a real upload through transcription and onto the Cast
       screen, on a synthetic clip (a real face photo + real synthesised
       speech, so transcription and face detection had something genuine to
       find). **Follow-up done 2026-09-17**, on an isolated dev server (port
       3462, not the shared one) using the fixture mode above: selecting a
       shot shows the inspector, the four crop-nudge arrows produce a
       "Reset crop" button, `Split here` at the playhead divides the region
       into two with the transcript's reason line updating to "You set this
       to close on Bob", and the "1 to review" stepper jumps the playhead to
       the fixture's one overlap-flagged turn, which renders the `TALKING
       OVER` chip exactly per the design spec. Waveform bars and thumbnails
       themselves weren't exercised -- the fixture's fake job id has no real
       waveform/thumbnail data on the server, by design (see
       `src/lib/fixture.ts`) -- but the fetch-and-degrade path for both was
       already covered by `EditorView.tsx`'s existing catch-and-ignore
       handling, confirmed by a clean console (no errors past the expected
       CORS noise from testing off the app's normal port).
3. **Processing that survives closing the window, and saved episodes.** Today
   a whole job lives inside one browser request, so closing or refreshing the
   tab loses up to an hour of work, and nothing about an edited episode is
   saved. Jobs move to the background with results saved to disk, and an
   episode reopens without reprocessing. The desktop app needs this anyway.
   - Problem: a long recording can't be processed reliably.
   - Evidence (founder, testing): "the localhost stopped again midway".
   - Measure: runs that finish.
   - **Built 2026-09-16.** `/process` now saves the upload and starts the
     pipeline as a background `asyncio.create_task`, returning `{jobId}`
     immediately instead of doing the whole job inline and handing back the
     full result -- closing the tab used to cancel the request outright,
     because Starlette cancels a handler's coroutine the moment the client
     disconnects. Everything a job produces (the input file, the result, the
     waveform, the timeline thumbnails) now lives in `server/jobs/{job_id}/`
     rather than a `tempfile.TemporaryDirectory()` that vanished when the
     request returned (see `pipeline/jobs.py`), so it survives a server
     restart, not just a tab refresh. A failure that used to become the
     `/process` response (a missing audio track, a diarisation setup
     problem, anything unexpected) now reaches the browser through a new
     `error` field on `/progress/{job_id}` instead, since by the time any of
     those can happen the request that started the job is long gone.
     - New endpoints: `GET /jobs` (saved episodes, newest first), `GET
       /jobs/{job_id}` (a finished job's result, plus its original
       filename), `GET /jobs/{job_id}/media` (the original recording, Range
       requests included, for playback with no browser-held upload left),
       `DELETE /jobs/{job_id}`.
     - `/export` no longer re-uploads the recording -- it reads the same
       persisted input by `jobId`, which also removes a second full upload
       of a multi-GB file that existed only because there was nowhere else
       to get the bytes from.
     - Frontend: a resumed session (reload, or a saved episode reopened from
       the upload screen's new "Recent episodes" list) always lands back on
       Cast, not mid-edit -- region edits and cast confirmations aren't
       persisted in this pass, only the pipeline's own output, so "reopen"
       means "skip reprocessing," not "resume exactly where you left off."
       `EditorView` and `CastScreen` take a plain `videoUrl` now instead of
       a `File`, satisfied by either a fresh upload's object URL or
       `/jobs/{id}/media` -- one code path for both.
     - Tests: `pipeline/jobs.py` (round-trips, and that a lookup on an
       unknown job creates nothing on disk -- `/progress` takes one on every
       poll, including stale bookmarks), `_run_pipeline`'s three failure
       paths, and the new endpoints, all with the real pipeline steps
       mocked out. 166 backend tests (was 136); frontend still 32 -- this
       pass was backend and state-machine work, not new pure logic. `tsc`
       clean, production build clean, and `oxlint` is now fully clean with
       zero warnings -- the two "deliberate, documented" ones from the
       2026-09-12 measurement run were both `URL.createObjectURL(file)`
       effects in `EditorView`/`CastScreen`, which this pass's `videoUrl`
       prop refactor removed outright rather than re-suppressing.
     - Known limitation, not addressed here: nothing evicts `server/jobs/`,
       so it grows without bound. A server crash mid-job (not just a closed
       tab) still loses that job -- only the browser disconnecting is
       decoupled from the work now, not a killed server process.
     - Verified live end to end against a real running instance (not just
       the test suite's mocked `_run_pipeline`) -- a second `uvicorn` on a
       scratch port, isolated from the shared dev server other sessions on
       this machine were using, torn down and its test job deleted
       afterward. `/process` returned in 12ms, well before the pipeline
       finished; the background task ran to completion with no connection
       held open the whole time, which is the actual claim ("closing the
       tab" is exactly "no connection held open"). Watched `/progress`
       advance through real transcribe/faces/match stages; confirmed
       `/jobs`, `/jobs/{id}` (with the original filename), `/jobs/{id}/
       media` (byte-identical to the upload), the waveform and a thumbnail
       all serve real data; ran `/export` by `jobId` with no re-upload and a
       crop nudge, and got back a valid MP4 with the original filename in
       `Content-Disposition` and the nudge in `decisions.jsonl`; deleted the
       job and confirmed both `/jobs` and `/jobs/{id}` reflect it being
       gone. Separately fed it a video with no audio track and confirmed
       `/progress` reports the same error message the old synchronous
       version raised as an HTTP 400, just through the new field. Not yet
       verified through the actual browser UI (upload screen, resume after
       a real reload, the "Recent episodes" list) for the same reason as
       item 2: the shared dev server and browser other sessions are using
       right now aren't safe to drive without risking their work.
4. **The desktop app (.dmg).** No terminal, `uv` or `ffmpeg` install. It reads
   the recording where it is instead of copying a 3 GB file into the service,
   renders to a folder instead of holding the whole MP4 in browser memory, and
   can use native notifications. Costs: an Apple Developer account for signing
   and notarisation, a 2 to 3 GB download, Apple Silicon in practice, and care
   with `ffmpeg`'s licence.
   - Problem: getting it running needs a terminal.
   - Evidence (founder): "make the tool in a way that the user does not have
     to leave the env in anyway".
   - Measure: time from opening the app to the first export.
   - **Electron shell and installer pipeline, done 2026-09-16.** `electron/
     main.mjs` opens a native window over the built frontend and starts the
     existing processing service the same way `vite.config.ts` always has --
     that startup logic moved to `scripts/processing-service.mjs` so dev and
     the desktop app can't drift apart. `electron-builder` (config in
     `package.json`'s `build` field) produces a real `.dmg`/`.zip` for Mac
     (verified: mounts, installs, launches) and an `.exe` for Windows (builds
     natively on Windows; not locally buildable on this Mac without Wine).
     `.github/workflows/release.yml` builds both on a version tag and
     attaches them to a GitHub Release. `scripts/ensure-uv.mjs` installs `uv`
     from astral.sh on first launch if it's missing, and `ffmpeg-static`/
     `ffprobe-static` (same packages Recordly bundles ffmpeg with) ship
     inside the app -- `electron/main.mjs` points `FFMPEG_BINARY`/
     `FFPROBE_BINARY` at them, so "no terminal, `uv` or `ffmpeg` install" is
     now fully done. The bundled build has libass, so burned-in captions
     work without the `ffmpeg-full` workaround below. One licence note: this
     build is GPL+nonfree (`--enable-gpl --enable-nonfree`, for libx264/
     libx265), invoked only as a subprocess (no linking) the same way every
     other ffmpeg-shelling app does -- but its own `LICENSE` file ships
     alongside it in the app bundle, and that should be linked from the
     app's credits/about, not just sitting in `node_modules`.
     - Not done, still open: the Apple Developer signing/notarisation this
       item calls for (today's build is unsigned -- Gatekeeper blocks it on
       first open), reading the recording in place and rendering to a
       folder instead of holding it in browser memory, native
       notifications, and shipping the `pyannote` weights directly per the
       licence check two lines down (which would
       drop the Hugging Face step from the desktop app entirely).
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
5. **Waiting that keeps people.** A notification when processing finishes, a
   live video preview that follows the transcript, a time estimate weighted by
   how long each stage really takes (on the 47-minute run, faces finished well
   before the transcript, and matching runs last), and visible progress for
   the first-run model downloads. Small, and fits alongside item 4.
   - Problem: a 35 to 40 minute wait with nothing to do.
   - Evidence (founder): "keep the users hooked instead of them coming back in
     an hour or so or maybe not returning at all".
   - Measure: runs that finish and then get opened.
   - **Built 2026-09-16.** A native browser notification fires when a job
     finishes or fails, but only if the tab is hidden -- no point
     interrupting someone already watching it, and the permission prompt
     only appears once a job actually starts, not on first launch. A muted
     video preview on the processing screen follows the transcript's own
     read position (`ProcessingScreen` now plays from `jobMediaUrl(jobId)`,
     which item 3 made available from the moment the upload lands, well
     before the pipeline finishes). The time estimate now models the real
     shape of the pipeline -- transcribe and faces run concurrently, so
     wall-clock time is gated by whichever is slower, not their sum;
     averaging all four stages as if they were four equal sequential chunks
     (the old approach) could show "30% done" when the clock had only moved
     as far as the slower of the concurrent pair. `overallProgress` now
     takes the max of the concurrent pair as one phase instead. This is a
     structural fix, not a guessed timing ratio -- there isn't a reliable
     one; which of transcribe or faces is the long pole depends on the
     recording. Model downloads (SFace, LR-ASD -- small, first-party HTTP
     downloads this project controls) now report a real byte fraction under
     a "first run only" label; the two large ones (faster-whisper, pyannote
     community-1) report an honest indeterminate "loading the ... model
     (downloads once, the first time)" instead -- getting a real fraction
     there would mean hooking `huggingface_hub`'s internals, which is either
     fragile against a version bump or would need a bytes-total guess
     dressed up as a percentage. Same call this codebase already made for
     render progress ("No render progress, only an indeterminate bar" --
     see Known Limitations): an honest indeterminate wait beats a
     fabricated precise one.
     - `overallProgress`/`remainingLabel` moved to a new pure module,
       `src/features/upload/processingProgress.ts`, since `ProcessingScreen.
       tsx` imports `src/lib/api.ts`, which reads `import.meta.env` and only
       exists under Vite -- Node's test runner can't load it otherwise. 11
       new frontend tests. Backend: 11 new tests across `test_faces.py`,
       `test_lipsync.py` (the two real byte-progress downloads, monkeypatched
       so no network call happens), `test_diarize.py` and the new
       `test_transcribe.py` (the two `on_loading` announcements, and that
       neither fires once the model is already loaded in this process). 177
       backend tests (was 166), 41 frontend (was 32).
     - Verified live against an isolated `uvicorn` instance the same way
       item 3 was: `/jobs/{id}/media` confirmed reachable and byte-correct
       immediately after upload, well before the pipeline finishes (what
       the live preview depends on), and a full real run still completes
       correctly with every new callback wired in. The download-progress
       paths themselves weren't exercised live -- the models are already
       cached on this machine, which is the normal case after the one-time
       setup gate -- so that logic is verified by the mocked unit tests
       above, not a live download.
6. **Host test, unassisted, with the app.** The milestone this project has
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
- ~~**Agent-friendly fixture mode**~~: done, 2026-09-17. `?fixture` on the
  dev server's URL (`src/lib/fixture.ts`) drops straight into the editor with
  a canned three-person, 70-second conversation -- turns, words, an overlap
  window, three faces and a voice-face match already made, one deliberately
  low-confidence to exercise the review-flag stepper -- instead of walking
  upload → process → cast. Dev-only (`import.meta.env.DEV`): a packaged
  install has no reason to expose a way to skip real processing. `videoUrl`
  is empty, so there's no picture, only black -- the point is the editor's
  own data and controls (transcript, timeline, regions, review stepper),
  which don't need real footage; the waveform and thumbnail fetches for the
  fake job id fail the same way they already do for any job the server
  doesn't recognise (silently, per the comment at `EditorView.tsx`'s
  `waveform` state). Verified live: `tsc`, `oxlint` and the 41 frontend tests
  all clean, and a real dev server at `/?fixture=1` rendered the transcript,
  named speakers, "1 to review" flag and computed framing regions exactly as
  built, with no console errors beyond the expected failed fetches.

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
  every shot can be changed in the editor. See
  [EDGE_CASES.md](EDGE_CASES.md) B1.
- **pyannote 4 cannot read audio files on FFmpeg 9.** It decodes through
  torchcodec, whose prebuilt libraries link against FFmpeg 4-7, so on a
  modern ffmpeg every one of them fails to load. Worked around by decoding
  the wav ourselves and handing the pipeline a waveform, which is free — the
  pipeline already extracts a 16kHz mono wav before this point.
- **Few automated frontend tests.** 15, all on the timeline maths
  (`npm test`). The rest of the frontend is verified by typecheck, build, and
  real browser sessions. The backend has 119.
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

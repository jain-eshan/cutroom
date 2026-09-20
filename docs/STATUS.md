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

**Checks:** 119 backend tests and 89 frontend tests (`npm test`) passing, `tsc` clean, `oxlint` clean (two
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
  on Vercel, with a waitlist through an embedded Tally form. On 2026-09-19
  the page was moved onto the design system's site kit: amber accent on the
  one waitlist button, the illustrated hero replaced by a striped placeholder
  until a real demo clip is recorded, and no icons, blur or dark bands.
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
       first open; the founder is setting up the account), native
       notifications specific to the packaged app (the web `Notification`
       API from item 5 already works there unmodified -- Electron's
       renderer supports it natively -- but that hasn't been confirmed
       inside a packaged window), and shipping the `pyannote` weights
       directly per the licence check two lines down (which would drop the
       Hugging Face step from the desktop app entirely).
   - **Reads the recording where it is, done 2026-09-17.** `electron/
     preload.mjs` exposes `webUtils.getPathForFile` through
     `contextBridge` -- it only resolves for a file the user actually
     picked or dropped, so nothing else can use it to name an arbitrary
     path. `src/lib/electron.ts` reads it; `App.tsx` calls the new `POST
     /process/local` (`server/main.py`) instead of the multipart upload
     whenever a path is available, falling back to the existing upload
     unchanged in a plain browser (no Electron bridge). The job's input is
     symlinked to the source rather than copied -- `jobs.save_input`
     already just returns a destination path without writing to it, so this
     slots in with no change to the persistence model from item 3. The
     trade-off is explicit: moving or deleting the source after this point
     breaks the job, the same as it would break any other app with the file
     open. Verified: `tsc`, `oxlint`, all 41 frontend and all 181 backend
     tests (4 new, covering the job id round-trip, the missing-token
     refusal, a 400 on a path that doesn't exist, and -- the actual point
     of the feature -- that the job's input really is a symlink back to the
     source and not a second copy of the bytes) all pass. Not yet verified
     inside a packaged Electron window (the shared one on this machine is
     mid-bugfix in another session); the plain-browser fallback path was
     confirmed unchanged by inspection, since it's byte-identical to the
     code before this change.
   - **Nothing is written inside the app bundle any more, done 2026-09-17.**
     Everything the service wrote -- saved episodes, the Hugging Face token,
     the downloaded SFace and LR-ASD weights, the decision logs, and the
     1.2GB Python environment -- used to land in `Cutroom.app/Contents/
     Resources/server/`, because every path was computed relative to the
     source file that used it. macOS replaces an app bundle wholesale on
     update, so each release destroyed all of it: the token, every saved
     episode, and a multi-minute environment rebuild before the app worked
     again. This was not a theoretical risk -- it happened twice in one
     afternoon while fixing other bugs. It also blocked the signing and
     notarisation this item still calls for, since an app that writes inside
     its own bundle invalidates its own signature, and it fails outright on
     a Mac where the bundle isn't writable by the person running it (an
     all-users install, or a managed machine).
     - New `server/pipeline/paths.py` holds the one decision: `DATA_DIR`,
       from `CUTROOM_DATA_DIR` if the shell set it, else `server/` exactly as
       before. `electron/main.mjs` sets it to Electron's own
       `app.getPath("userData")` when packaged, alongside
       `UV_PROJECT_ENVIRONMENT` (so uv builds the venv there instead of
       `server/.venv`) and `PYTHONPYCACHEPREFIX` (so `__pycache__` doesn't
       land in the bundle either) -- the same env-var route `FFMPEG_BINARY`
       already takes, so `scripts/processing-service.mjs` needed no change.
       `jobs.py`, `faces.py`, `lipsync.py` and `main.py` read from it.
     - The one thing that stays in the bundle is the 232KB YuNet detector,
       which ships committed and is only ever read; `faces.py` now points
       `DETECTION_MODEL` at `SERVER_DIR` and only the downloaded weights at
       `DATA_DIR`. Dev is untouched: with the variables unset both resolve to
       `server/`, which is what `npm run dev` and the test suite have always
       used.
     - Verified on a real packaged install: first launch created the venv at
       `~/Library/Application Support/cutroom/venv` and came up healthy, then
       deleting `/Applications/Cutroom.app` outright and putting a fresh
       build down -- the exact operation that destroyed the data twice
       earlier -- left the token, the saved episode and the venv intact. The
       app came back with `diarization: true` from the surviving token, the
       episode still listed in `GET /jobs`, and no "Creating virtual
       environment" line in the startup log.
     - Not migrated, deliberately: nothing reads the old in-bundle location,
       because a bundle old enough to have data in it is one the update just
       deleted. There was nothing left to move.
   - **Renders to a folder, done 2026-09-17.** `/export` (`server/main.py`)
     takes an optional `outputPath`; when it's set, the finished render is
     moved there directly and the endpoint returns `{outputPath}` instead of
     streaming the MP4 back as the response body -- the whole point being
     that the video never has to pass through the renderer's memory as a
     blob. The desktop app asks first, not after: `electron/main.mjs` adds a
     native `dialog.showSaveDialog` and `shell.showItemInFolder`, wired
     through `preload.mjs`'s `contextBridge` the same way the read-in-place
     work above wired `webUtils.getPathForFile`. `PublishScreen.tsx` asks
     `chooseExportPath` before the render starts (a 15-minute wait shouldn't
     end in a cancelled save dialog), and the finished-state button is now
     genuinely "Show me" on the desktop app -- the handoff's original
     copy, reverted from "Save the MP4" now that there's a real folder to
     reveal (see DESIGN_SYSTEM.md's "Known, deliberate deviations": that
     line is now false only for the plain-browser fallback, which keeps the
     download-blob path unchanged). A refusal before the render starts if
     the chosen folder doesn't exist, same principle as the pre-flight
     libass check just above it in this endpoint.
     - Verified: `tsc`, `oxlint`, all 41 frontend tests, and 184 backend
       tests (3 new -- a real render mocked at the `render_export` call and
       moved to a chosen path, confirmed byte-identical at the destination
       and returned as JSON not bytes; the folder-doesn't-exist refusal; and
       that leaving `outputPath` out still streams a response exactly as
       before) all pass. The plain-browser fallback was exercised live
       against a real running instance -- reached Publish through the
       fixture mode above, triggered a render, and confirmed the request
       actually reaches `/export` with the right method and body (it then
       fails on the same off-port CORS artifact every fixture-mode browser
       check in this document has hit, not a defect in this change). Not
       yet exercised inside a packaged Electron window, for the same reason
       as the read-in-place work: the shared instance on this machine is
       mid-bugfix in another session.
   - **Real render progress, done 2026-09-17.** Pulled forward from "Then,
     ordered by what the host test shows" below -- it needed no editorial
     feedback to build, only ffmpeg's own `-progress` output, which
     `render_export` (`server/pipeline/render.py`) now parses and reports
     through an `on_progress` callback instead of the indeterminate pulsing
     bar Publish showed before. A new `GET /export/progress/{job_id}`,
     polled every 700ms alongside the still-open `/export` request, is a
     side channel onto the same job id rather than a change to `/export`'s
     own contract -- the render is still one synchronous request either way.
     - `out_time_us` (confirmed against this project's own ffmpeg, 9.0.1 --
       ffmpeg has shipped both an `out_time_ms` and an `out_time_us` field
       with microsecond values across versions, so the unambiguous one was
       used) divided by the segment-built duration, clamped to 1.0. The
       parsing itself (`_progress_fraction`) is a small pure function,
       unit-tested against canned lines copied from a real run -- automated
       tests don't spawn ffmpeg at all (CI has none installed, same
       constraint `render_export`'s own module docstring already noted for
       the rest of this file), so the subprocess plumbing around it was
       verified manually instead, the same way the rest of this module's
       ffmpeg behaviour always has been.
     - Manual verification: a real 6-second synthetic clip through the real
       `render_export`, `on_progress` collected into a list -- reported,
       monotonically non-decreasing, reached exactly 1.0, and the output
       file played back correctly. Separately, pointing it at a missing
       input file still raised `CalledProcessError` with a populated
       `stderr`, unchanged from before this pass -- moving from
       `subprocess.run` to `Popen` (needed to stream `-progress` output
       while it's still running) didn't regress the existing error path
       `/export` depends on for its "Render failed: ..." message.
     - Verified: `tsc`, `oxlint`, all 52 frontend tests, and 193 backend
       tests (9 new: 6 on `_progress_fraction`'s edge cases -- the real
       `N/A` first line, other progress fields ignored, clamping past 1.0,
       a zero duration -- and 3 on `/export/progress` itself, including one
       that reads the progress store *during* a mocked render to confirm
       `on_progress` really reaches somewhere pollable, not just that it's
       called) all pass.
   - **Licence check, done 2026-09-15.** `pyannote` community-1 is CC-BY-4.0,
     and every file the pipeline loads (segmentation, embedding, PLDA, config)
     is in that one repo. The Hugging Face gate is an automatic form that asks
     for contact details and a use case; its own text says the pipeline is
     CC-BY-4.0 and will stay freely accessible. It adds no licence term.
     CC-BY-4.0 allows redistribution with attribution, so the app can ship the
     weights, credit pyannote with a link to the licence, and drop the Hugging
     Face step entirely. This is a reading of the licence, not legal advice:
     confirm before release.
   - **The rest of the licence check, done 2026-09-17.** faster-whisper's
     converted weights (`Systran/faster-whisper-*` on Hugging Face, what
     `transcribe.py`'s `WhisperModel` pulls) are MIT. YuNet
     (`face_detection_yunet`, OpenCV Zoo) is MIT. SFace was already decided
     Apache-2.0 (see "Decisions worth not re-litigating," below). LR-ASD's
     AVA weights are MIT, and were already vetted when they were chosen over
     TalkSet specifically to avoid a non-commercial research restriction --
     see `server/pipeline/lrasd/NOTICE.md`. All four read as freely
     redistributable with attribution, same as pyannote above -- same
     caveat: a reading of the licences, not legal advice, and the app
     doesn't actually bundle any of them yet. That's separate engineering
     (vendoring several GB of weights into the installer instead of
     downloading them on first use, plus an about/credits screen crediting
     all five projects) that touches the same packaging scripts the
     Electron shell work above does, so it should land as its own pass
     rather than inside this one.
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
- ~~**Real render progress.**~~ Done 2026-09-17 -- see "Where things stand"
  above.
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
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). A design QA on 2026-09-19 found the
  tokens were right but the screens weren't using them (the app shipped
  light, nine hand-rolled button styles, pulsing bars, black video plates).
  Every stage was rebuilt on the design system's primitives that day; see
  "Design system pass" there.
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
- **Bug sweep, 2026-09-17.** A full pass over a QA review's findings, each
  verified with a real reproduction before and after, not just read and
  fixed on faith:
  - **Security:** job ids were never validated before use in a filesystem
    path -- a plain request from any open browser tab could write a file
    outside `server/jobs/` or delete `server/` outright via `DELETE
    /jobs/..`. Restricted to a safe character set at the one place every
    file operation routes through.
  - **Correctness:** a job with no faces or no voices crashed instead of
    completing (a type violation in `fuse.py`'s early return, breaking the
    documented-working "audio only" case); `DELETE /jobs/{id}` didn't stop
    a still-running pipeline, which could recreate the directory on its
    next write; retrying `/process` under the same job id left the old
    upload behind and could serve it instead of the new one; `has_audio()`
    reported "no audio track" for any ffprobe failure, including a
    genuinely corrupted file; concurrent first-run model downloads
    (SFace, LR-ASD) could corrupt each other by sharing one fixed temp
    filename; the three lazy-loaded model caches (Whisper, pyannote,
    LR-ASD) had no lock, so two jobs starting close together could each
    load the same multi-hundred-MB model at once.
  - **Frontend:** no error boundary existed, so any render crash was a
    blank white screen; no `<video>` had an `onError` handler, so a saved
    episode's evicted media (`server/jobs/` has no eviction policy) was a
    silent black box; region time fields failed silently on bad input with
    no `start < end` check; the split button's enabled state could
    disagree with the position splitting would actually use; `theme.ts`'s
    `localStorage` calls were unguarded.
  - **Build/release:** `ensure-uv.mjs` had no timeout and could hang first
    launch forever; `curl | sh` masked a failed download as success; the
    setup gate's "server ready" check missed a log line split across
    stdio chunks; the landing page hardcoded the release version in its
    download links (fixed at the root -- `package.json`'s build config now
    names those artifacts without a version, so the site never needs
    editing again); `ffmpeg-static`'s install arch wasn't pinned in
    `release.yml`, leaving it to coincidence that the runners' default
    matched the build targets.
  - Each fix shipped with a new or updated test where the codebase's
    testing conventions allowed it (monkeypatched `subprocess.run` for
    anything ffmpeg/ffprobe-shaped, since CI has neither installed; real
    multi-threaded races with a `threading.Barrier` for the concurrency
    fixes, confirmed to fail against the pre-fix code, not just pass
    against the post-fix one). 218 backend tests (was 177), 59 frontend
    (was 41).
- **Edge-case shot rules, part 2, and v0.2.0, 2026-09-17.** Three more
  EDGE_CASES.md items, each verified live in the browser (fixture mode),
  not just by unit test:
  - **Rule 7 (C1), done:** multi-person shots order panes by where people
    actually sit (`orderBySeat` in `regions.ts`, from each person's median
    keyframe centre-x), not by speaker or person id, so nobody swaps sides
    between cuts.
  - **Rule 8, done:** three framing styles -- Wide only (suggests nothing),
    Gentle (the new default; close-ups need a 12s stretch, versus Dynamic's
    4s), Dynamic (unchanged, now named). Switching style mid-edit
    (`reconcileWithStyle`) never touches a shot the editor made, closing D2
    the same day it was opened -- confirmed live: framing one line by hand
    under Wide only, then switching to Dynamic, kept exactly that shot
    while every other line picked up a fresh suggestion around it.
  - **Rule 4 (A5), done:** a takeover -- B interrupts and keeps going, A
    never comes back -- is one cut, on the new speaker's first word
    (`takeoverAt` in `regions.ts`), not a flash through the both-on-screen
    composite. Verified against a real case already in the fixture data (a
    0.4s overlap at a genuine handoff), which is a takeover under Dynamic's
    cutoff but not Gentle's higher one -- confirmed both ways live.
  - EDGE_CASES.md's own Today lines updated for every case this touched,
    including two (A4, A7, A9) marked "improved, not exactly as
    prescribed" rather than done, and the one open item actually blocking
    further work (C3, four or more people) called out explicitly.
  - **v0.2.0, tagged, published and live.** Version bumped to mark this and
    the preceding bug-sweep entry as one release -- a security fix (path
    traversal), the app-data-location fix, and three new editing features
    is more than a patch. `package.json`'s `dmg`/`nsis` `artifactName` fix
    from the bug sweep is what makes this safe to tag going forward: the
    download links don't need a manual edit to keep working.
    - **The release workflow's known duplicate-draft race (see
      `release.yml`'s own comment) happened for real on this tag.** The mac
      and Windows jobs, despite `max-parallel: 1` and running fully
      sequentially, each created their own draft release for `v0.2.0`
      instead of the second one finding and adding to the first's -- one
      draft held the dmg/zip, the other the exe, and `gh release view`
      only ever showed the one it resolved to, silently. Caught by
      checking the actual asset list rather than trusting a green
      workflow run. Fixed by hand: downloaded the orphaned draft's four
      mac assets, verified them for real (mounted the dmg with `hdiutil
      attach`, confirmed the shipped model file and the job-id validation
      fix were actually inside it; `unzip -t` on the zip), uploaded them
      into the surviving draft via the GitHub API, deleted the orphaned
      release object without touching the underlying git tag, then
      published. Root cause not found -- `release.yml` now carries a
      checklist for the next tag rather than a false sense that
      `max-parallel: 1` alone is sufficient.
    - Published 2026-09-17: `gh release view v0.2.0` shows 8 assets,
      `draft: false`, and both `releases/latest/download/Cutroom-arm64.dmg`
      and `.../Cutroom-Setup.exe` return 200. The live site
      (cutroom-ruddy.vercel.app, on the founder's own Vercel account, not
      ISB-AAC -- auto-deploys from `main`) was confirmed serving the
      current build with a working Download for Mac link pointed at
      exactly that URL.
- **Edge-case shot rules, part 3, 2026-09-18.** The founder resolved
  EDGE_CASES.md's three remaining open decisions (section 4), unblocking
  two more cases:
  - **B3 (off-camera voices), decided: hold.** Needed no new code -- rule
    6's existing `holdUntil` already carried the current shot across an
    off-camera line unless a real silence intervened. The case's own
    "Today" text was stale, describing pre-rule-6 behaviour; pinned with
    three new tests instead.
  - **C3 (four or more people), decided: wide by default, a grid only on
    request** -- and built. `suggestRegions` no longer suggests a composite
    for a genuine overlap past three people; the window still forces the
    moment wide rather than silently reading as whichever close-up the
    boundary happened to land on. Four new tests, including that a manual
    four-person "+ Both on screen" is unaffected -- this only governs
    suggestions.
  - **Reaction shots (A9/A10), decided: later.** No code change; recorded
    so the question doesn't get re-asked.
  - **C2 (who gets the large pane), done.** `floorHolderPersonId`
    (`regions.ts`) picks whoever's turn is already under way when a
    three-or-more overlap starts -- rule 3's own "overlap favours whoever
    started first" -- ahead of everyone else in seat order (rule 7,
    otherwise unchanged). Two-person shots have no large pane to reassign,
    so this only fires at three or more. Not built: the floor changing
    hands *within* one composite (rule 5's territory) -- every measured
    genuine overlap so far is 0.02-0.56s, too short for it to matter yet.
  - **Still open:** A6 (usually wide for a 3-4 person moment, rather than
    every one getting a composite). No evidence yet on how often that
    matters. See EDGE_CASES.md section 5, item 5.
  - Verified: `tsc`, `oxlint`, all 80 frontend tests (was 52) pass. Pure
    logic in `regions.ts`, so unit-tested rather than re-verified live --
    the existing fixture data is three people, and constructing a fourth
    speaker for a one-off browser check would have tested the fixture, not
    the rule.
- **The who's-on-screen picker (EDGE_CASES.md C4), done 2026-09-18.** The
  shot inspector now shows a toggle chip for everyone the pipeline found on
  camera; clicking one adds or removes them from the selected shot, instead
  of "+ Both on screen" being the only way to change who's in it and never
  past two people. Layout follows the count -- one person is a close-up,
  two or more is both-on-screen -- and people are ordered by seat (rule 7),
  same as an automatic suggestion. Deselecting the last person does
  nothing; "Go wide here" is the control for clearing a shot.
  - Verified live (fixture mode): built a shot up from one person to three
    (`Alice` -> `Alice + Bob` -> `Alice + Bob + Cara`, transcript reason
    line updating each time) and back down to one (`Close on Cara`),
    confirmed the last person can't be removed, and checked the console
    for errors (none beyond the usual off-port CORS noise fixture-mode
    testing always hits on this machine).
- **Per-instant visibility, partly done (EDGE_CASES.md B7), 2026-09-18.** A
  close-up used to crop to the *nearest* sighting of a face however far
  away it was -- a person who left minutes ago could still get a shot of
  their empty chair. `isVisibleAt`/`is_visible_at` (`faceCrop.ts`,
  `render.py`) now require a sighting within 2s of the moment being
  framed; `resolveFraming` and `build_render_segments` already had the
  right fallback for "can't find this person" (drop them, close on whoever
  else is there, wide if nobody is) -- they just weren't asking the
  question this precisely before. Not done: catching someone leaving
  *partway through* an already-showing shot, which needs a new segment
  boundary at the moment visibility changes, not just a stricter check at
  the one sampling point that already existed. That, and B8's smooth
  re-aiming within a shot, stay deferred -- both are judgment calls about
  how much extra cutting is worth it, which is exactly what "if framing
  gets complaints" (this item's own entry, above) is waiting on real
  footage to answer.
  - Found in passing: the fixture data (`fixture.ts`) had precisely the
    bug this closes -- one keyframe at t=0 for a 70-second episode, which
    the old "nearest however far" behaviour happened to paper over. Fixed
    to a keyframe every 1.5s across the episode, which is also just closer
    to how real face detection samples.
  - Verified: `tsc`, `oxlint`, 87 frontend tests (was 80), 222 backend
    tests (was 218) -- new cases for `isVisibleAt`/`is_visible_at`
    directly and for the fallback each language's framing function now
    takes, plus three existing `test_render.py` cases whose tracks needed
    a keyframe actually near what they sample (previously true by luck,
    not by construction). Live in the browser (fixture mode): scrubbed to
    1:04 of the 70s episode and confirmed "Close on Bob," the exact shot
    that would have silently gone wide without the fixture fix landing
    alongside the feature fix.
- **A brief interjection no longer flashes a composite (EDGE_CASES.md A3),
  2026-09-18.** Rule 3 always said the other person only joins the shot
  once "the overlap lasts about 2s," but the code only checked
  `MIN_REGION_S` (0.25s) -- so a genuine but brief interjection (a quick
  "wait, really?" while someone else is mid-sentence) got its own
  both-on-screen flash instead of the floor holder just keeping the shot,
  exactly the "all three on screen if the line overlaps for 1s or more"
  A3 already named as wrong. `MIN_OVERLAP_FOR_COMPOSITE_S` in `regions.ts`
  is rule 3's own number, not a newly invented one. Not built: rule 3's
  other clause ("saying words, not laughing or murmuring") -- the overlap
  window has no attached word content to check that against without new
  plumbing, and no real case has shown duration alone giving a wrong
  answer yet.
  - Two new `regions.test.ts` cases (89, was 87); one existing C2 test
    needed its overlap window widened past the new threshold to keep
    testing what it was written to test (floor-holder ordering) rather
    than incidentally also testing this fix. `tsc`, `oxlint` clean. Not
    re-verified live -- pure duration-threshold logic, already covered by
    C3's precedent for why a live check would test the fixture rather
    than the rule.
- **v0.2.1, 2026-09-18.** Patch bump for the three items above (the
  who's-on-screen picker, per-instant visibility, and the overlap-duration
  fix) -- editor refinements and bug fixes, not new capability on the scale
  of v0.2.0's bundle. `package.json` and `package-lock.json` only; no tag
  cut and no release published (see v0.2.0's entry above for what that
  involves) -- these three shipped as a normal merged PR, not a release.
- **v0.3.0, tagged and published 2026-09-19.** Three PRs: the design system
  pass ([#6](https://github.com/jain-eshan/cutroom/pull/6), every screen,
  dark by default), the landing page moved onto the same system
  ([#7](https://github.com/jain-eshan/cutroom/pull/7)), and three
  desktop-app changes ([#8](https://github.com/jain-eshan/cutroom/pull/8)):
  - **The app checks for updates.** `electron-updater` reads the
    `latest.yml` / `latest-mac.yml` the release workflow already attaches,
    once per launch, packaged builds only. Windows downloads quietly and
    installs on quit ("Restart now" in the title bar). macOS only lets a
    Developer ID-signed app replace itself, and ours is ad-hoc signed, so a
    Mac only shows "Cutroom X is out" with a Download button that opens the
    Releases page. Signing turns that into a real update
    (`CAN_SELF_INSTALL` in `electron/main.mjs`). Anyone on 0.2.0 or older
    has to download 0.3.0 by hand once, to get the version that checks.
  - **`publish` names the repo** (`owner`/`repo` in `package.json`). Left
    to infer it, electron-builder wrote an `app-update.yml` with no address
    in it, so an update check would have had nowhere to look.
  - **The preload bridge now actually loads.** `electron/preload.mjs` used
    `import`, which Electron's sandboxed preloads can't run, so in every
    packaged build so far `window.cutroom` never existed: reading the
    recording in place (2026-09-17) and saving the render straight to a
    folder fell back to the browser's upload and download without any
    error. It's `preload.cjs` now. Found by running a packaged build and
    reading its console; verified the same way afterwards.
  - Verified before tagging: a packaged build posing as 0.1.9 found the
    live 0.2.0 release and showed "Cutroom 0.2.0 is out" with Download.
  - **The release itself split into two drafts again** — release.yml's own
    long-standing comment on `max-parallel: 1` already names this exact
    failure mode and says to check for it, and it still happened: the mac
    job's 4 assets and the Windows job's 4 assets landed in two separate
    `v0.3.0` drafts (ids ending `...557` and `...556`) instead of one. Fixed
    by hand: downloaded the second draft's 4 assets, uploaded them onto the
    first via the GitHub API, checked each `latest.yml`/`latest-mac.yml`
    entry's sha512 against the matching installer file, then deleted the
    now-empty duplicate and published the one with all 8. The workflow's
    root cause from that comment is still open — this is the second time it
    has happened, so the manual check it prescribes is not optional.
  - Verified after publishing: `gh release view v0.3.0` shows 8 assets, not
    a draft, and `Latest`; the public `.../releases/latest/download/` links
    for `Cutroom-arm64.dmg`, `Cutroom-Setup.exe` and `latest-mac.yml` all
    redirect to the `v0.3.0` asset URLs.
  - Not yet verified: the Windows download-and-install path, and
    read-in-place and save-to-folder now that the bridge loads (needs a
    real recording and a Hugging Face token run through the packaged app).
- **v0.3.1, 2026-09-20: the bundled ffprobe was an Intel binary.** Every
  packaged Mac build since v0.1.0 shipped an x86_64 `ffprobe` and pointed
  `FFPROBE_BINARY` at it, so on an Apple Silicon Mac without Rosetta the
  first file anyone opened died on the first pipeline step with
  `OSError: [Errno 86] Bad CPU type in executable`. Reported against
  v0.3.0, but only because v0.3.0's preload fix was the first build that
  got far enough to run the probe.
  - **Root cause: `ffprobe-static@3.1.0` keeps an x86_64 build in
    `bin/darwin/arm64/`.** Not our mistake to make, but ours to catch. The
    package ships every architecture in one tarball and picks a directory
    by `os.arch()` at runtime -- release.yml's matrix comment explicitly
    trusted that design and pinned `npm_config_arch` only for
    `ffmpeg-static`, which downloads one binary per host arch and was
    therefore correct all along. Rosetta hid it from anyone who had it
    installed; a clean macOS 27 install on Apple Silicon does not.
  - **Fixed by swapping to `@ffprobe-installer/ffprobe`**, which resolves a
    real per-platform package (`@ffprobe-installer/darwin-arm64`,
    `win32-x64`) through optional dependencies -- the same shape
    `ffmpeg-static` already relies on, so the release matrix's existing
    `npm_config_arch` pin now covers both.
  - **`scripts/verify-binaries.mjs` (new, an `afterPack` hook) makes this
    class of bug a build failure.** It reads the Mach-O/PE header of every
    `ffmpeg`/`ffprobe` inside the packed bundle and fails if any doesn't
    match the target arch, or if either is missing entirely -- the quieter
    failure where a glob stops matching or an install script is skipped.
    Checking the packed output rather than `node_modules` means it tests
    what actually ships.
  - **`has_audio` and `_source_audio_codec` caught `FileNotFoundError`, not
    `OSError`.** A binary that is missing and one that exists but can't be
    executed are the same problem to whoever is reading the screen, and
    only the first is a `FileNotFoundError` -- which is why this surfaced
    as a raw traceback instead of the pipeline's own message. Both widened,
    with a regression test each that fails on the old catch.
  - Verified: a local `npm run dist:mac` prints `verify-binaries: 2 bundled
    binaries are arm64`, both bundled binaries read as arm64, and the
    packaged `ffprobe` -- the exact path from the crash report -- runs on an
    M5 and prints its version. The guard was then re-run against that same
    bundle with `ffprobe-static`'s x86_64 binary put back (fails, naming the
    file and its arch) and with `ffprobe` removed (fails, naming the
    missing binary). 224 pytest, 89 node tests, `tsc` and `oxlint` clean.
  - **Tagged and published 2026-09-20.** The guard ran on both runners and
    passed: `verify-binaries: 2 bundled binaries are arm64` on macOS,
    `... are x64` on Windows. That closes the one item this entry left open
    before the tag -- the Windows installer now sources `ffprobe.exe` from
    `@ffprobe-installer/win32-x64` rather than the old all-architectures
    tarball, and nothing had yet watched that path build.
  - Verified after publishing, against the released artifact rather than
    the CI log: unpacking `Cutroom-0.3.1-arm64-mac.zip` gives an app
    reporting 0.3.1 whose bundled `ffmpeg` and `ffprobe` both read as
    Mach-O arm64, and whose `ffprobe` runs on an M5 and prints its version.
    sha512 of the dmg, the mac zip and `Setup.exe` each match their
    `latest*.yml` entry. All four `releases/latest/download/` links and
    both updater manifests serve 0.3.1.
  - **The release split into two drafts for the third tag running**
    (v0.2.0, v0.3.0, v0.3.1). One correction to what the earlier entries
    assumed: the split is not cleanly per-job. On v0.3.1 the mac
    `zip.blockmap` landed on the *Windows* draft, so the second draft was
    created while the mac job was still uploading, and "draft A is mac,
    draft B is Windows" is not a safe assumption when fixing it by hand.
    Both drafts report the tagged commit's date as `created_at`, which is
    what GitHub does for drafts, so that field cannot order them either.
    Consolidated the usual way: diff the two asset lists, upload whatever
    is unique to the second onto the first (by release id -- `gh release
    upload` takes a tag, which is ambiguous with two same-tag releases),
    check each `latest*.yml` sha512 against its installer, delete the
    duplicate, publish. release.yml's comment still describes this as open,
    because it is.
  - **`make_latest` needs its own API call.** Publishing with
    `gh api --method PATCH .../releases/<id> -f draft=false -f
    make_latest=true` silently ignores `make_latest`: the release goes
    public but `/releases/latest/` keeps pointing at the previous tag, so
    no `electron-updater` client is ever offered the new version. Send it
    as a second PATCH, then confirm against the public redirect rather than
    the API response -- `repos/.../releases/latest` updates first, while the
    `releases/latest/download/` redirect stays cached on the edge for a
    minute or two.

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

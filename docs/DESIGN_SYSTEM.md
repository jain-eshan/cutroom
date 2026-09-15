# Design system — Cutroom

Where the project's visual design lives, what's been built from it, and
exactly what's left. `docs/UX_PRD.md` §5 deferred the visual design system
to a separate pass; this is that pass, picked up in phases (see "What's
left," below).

## Source of truth

[`docs/design/handoff/`](design/handoff/) holds the original design handoff
bundle, unmodified — four `.dc.html` design-canvas files plus a `README.md`
that is the actual spec (full colour/type/spacing tokens, the logo
geometry, and a component-by-component breakdown of all six screens, the
landing page, render states and every edge case). Open any `.dc.html`
directly in a browser to see the reference mockups; **they're prototypes,
not code to copy** — this doc and the source below are the real
implementation.

Read `docs/design/handoff/README.md` before touching anything visual. It is
more precise than this file on any point where they'd disagree.

## What's implemented (Foundation phase)

- **Token layer** — `src/index.css`'s `@theme` block. Every semantic color
  (`bg`, `panel`, `accent`, the framing-region colors, speaker colors,
  etc.), radius and shadow token from the handoff, as OKLCH CSS custom
  properties. `accent` does not flip between themes, by design — see the
  comment above the token block if you're tempted to "fix" that.
- **Theme switching** — `src/lib/theme.ts`'s `useThemeMode`. Three states,
  persisted to `localStorage`. `system` leaves no `data-theme` attribute, so
  the `@media (prefers-color-scheme)` block in `index.css` drives it and
  reacts live with no JS listener; `light`/`dark` set the attribute and
  override the OS setting. `src/components/ThemeSwitcher.tsx` is the
  three-button control; it currently only appears in the Editor's title bar
  (the only screen with a title bar so far).
- **Logo** — `src/components/Logo.tsx`. Rebuilt as SVG from the handoff's
  geometry table (not ported from the HTML's div construction, per the
  handoff's own instruction). Switches construction by rendered size
  (full/mid/tiny), matching the reduction ladder. `public/favicon.svg` is a
  static-color instance of the tiny mark (SVG favicons can't use
  `currentColor`/CSS variables reliably across browsers, so its colors are
  baked-in hex, converted from the same OKLCH values).
- **Fonts** — Instrument Sans + JetBrains Mono, self-hosted via
  `@fontsource-variable/*` (not a Google Fonts CDN link — this is a
  local-first desktop-ish app, see the handoff's "Assets" section).
- **Reskinned screens**, visuals only, no interaction/architecture changes:
  `UploadScreen`, `ProcessingScreen`, `CastScreen`, `EditorView`,
  `ExportButton` (since folded into the publish screen). Copy was brought in line with the handoff's "Voice & copy
  rules" where it was cheap to do (plain-English shot names — "Wide" /
  "Close-up" / "Both on screen", not "Original" / "Zoom" / "Split"; "Lips
  match N% of this clip" on the cast screen's confidence chip).

## Built since the foundation

Each landed as its own commit, in the handoff's order.

- **Setup gate (`2d`)** — `src/features/setup/SetupGate.tsx`, a new
  `checking` state before `idle`. Polls `GET /health` every 2s and advances
  by itself; the footer button is deliberately inert. `/health` now also
  reports `captions` (whether this ffmpeg has libass, cached for the life of
  the process), and that flows into the editor so captions are refused
  before an export rather than 15 minutes into one. It also reports
  `diarization` (whether `HF_TOKEN` is set), and the gate won't advance
  without it, after a real run failed on a missing token six minutes into
  transcription. The token is pasted into the gate: `POST /setup/hf-token`
  asks Hugging Face whose token it is, then whether that account accepted the
  model's terms, and writes `server/.env` itself — no editor, no restart. See
  the deviations below for how the gate was simplified.
- **Processing evidence (`2e`)** — `/progress/{job_id}` carries the
  transcript tail as faster-whisper yields it, plus the ids of recognised
  people. Face images come from `GET /progress/{job_id}/face/{person_id}`, so
  each is fetched once instead of riding in a snapshot polled every 700ms.
  "About N min left" is extrapolated from real progress and only shown past
  8%.
- **Cast, one voice at a time (`2f`)** — `CastScreen.tsx` rewritten: the
  voice's longest utterance at 16px, a play button, face cards with inline
  naming, "Lips match N% of this clip", a dashed "Someone we didn't see"
  card, and back navigation.
- **Region-based editor (`5a`)** — framing is `FramingRegion[]`
  (`src/features/timeline/regions.ts`, `TimelineTray.tsx`), independent of
  turn boundaries. Suggested regions are computed once from turns, overlap
  windows and the cast. Edges drag; `+ Close-up` / `+ Both on screen` add a
  region over the selected turn; `Go wide here` deletes one; `Reset to
  suggested` restores them all. `/export` takes `regions` (plus `turns`, for
  trimming) instead of per-turn `layoutChoices` / `overlapSegments`.
  Verified end to end against the real service: a dragged region exported
  to a 30.0s 1280×720 MP4 and the decision log recorded it as `source: user`.
- **Publish (`7b`) + render states (`7c`)** —
  `src/features/publish/PublishScreen.tsx` and a new `publishing` status.
  "Export episode" in the editor now opens it instead of rendering in
  place. It lists what the episode comes out with and where it goes, and
  renders through the same `/export` call; `ExportButton` is gone, folded
  in. Regions, captions and trim moved from the editor into `App.tsx`, so a
  trip to Publish and back keeps every edit. Verified end to end: the
  rendering state appears with "Back to editing" disabled, the render comes
  back as a 30.0s 1280×720 MP4, the decision log records the edited region
  as `source: user`, and the screen was checked in both themes.
- **Edge cases (`7d`)** — **Stopped while reading**
  (`upload/ProcessingFailed.tsx`, a `failed` status) keeps the file so "Try
  again" doesn't mean finding it again, says how far the transcript got, and
  shows the raw error in mono with "Copy the details". **Nobody on camera**
  (`faces/NoFacesScreen.tsx`, a `noFaces` status) replaces a cast step that
  would have nothing to choose from; "Keep going anyway" opens the editor
  with no regions, all wide. **Voice with no face**: the cast flow shows that
  voice's turn count and total time and lets you name it anyway, carried as
  `CastResult.voiceNames`, so an off-camera guest reads as their name in the
  transcript rather than "Nobody". **Not built yet**: a disabled `+ Note` in
  the framing toolbar. All four checked in the browser.

## Decisions made while building — read before changing these

- **Regions are in seconds, not the handoff's `startMs`.** Every other time
  in the app and the pipeline is seconds; milliseconds here alone would put a
  unit conversion in every comparison against a turn.
- **Wide is the absence of a region**, not a third layout. The timeline
  draws uncovered time in `rWide` so it still reads as a decision.
- **Dragging an edge overwrites neighbours** instead of stopping at them.
  Clamping would make holding a close-up through an interjection — the
  reason the model exists — impossible. What's overwritten is gone; "Reset
  to suggested" is the way back. There is no undo.
- **Preview crops are taken at the region's start**, because `render.py`
  fixes each segment's crop at its start. `resolveFraming` in `regions.ts`
  and `build_render_segments` in `render.py` are the same algorithm and must
  change together.
- **Trimming still needs turns.** `/export` receives turn ranges separately;
  regions deliberately don't describe where speech is, and using them would
  cut unframed speech.
- **Faces appear together, not one at a time.** Identity is a clustering
  step over the whole pass; mid-pass there are tracks, not people, and
  showing fragments that later merge would be dishonest.
- **The cast waveform is speech density** from word timings, not audio
  amplitude — decoding a multi-GB file in the browser isn't worth it, but
  neither is drawing a made-up shape.
- **The episode description field is gone.** It was collected and never
  read by anything.
- **Only what exists is checked on Publish.** The handoff shows Chapters on
  with "6 found" and Captions "also saved as .srt". Neither exists in this
  pipeline, so Chapters sits unchecked beside show notes and clips — the
  handoff's own rule for unbuilt artefacts — and Captions just says
  "burned in".
- **No render progress, only an indeterminate bar.** `/export` reports
  nothing while it runs, so "Turn 12 of 31 · about 4 minutes left" would be
  invented.
- **Closing mid-render asks first**, through the browser's own
  `beforeunload` dialog. The in-app "Keep rendering / Close anyway" dialog
  from `7d` can't intercept a tab closing, and there's still no cancel
  button because the server doesn't kill ffmpeg when the client goes away.
- **Voices can have names without faces.** `CastResult.voiceNames` is keyed
  by diarisation speaker. It only changes labels and reasons in the editor;
  framing for those turns stays wide.
- **"Keep going anyway" skips the cast step** rather than showing it with
  no faces, where every question would have the same non-answer.

## Known, deliberate deviations

- **Drop zone border** uses the `line` token instead of the handoff's single
  literal, which was tuned for the dark theme only.
- **No filename echo on drag-over** — browsers don't expose the file until
  `drop`.
- **No recents list** — it needs `.cutroom` project persistence, which
  doesn't exist yet.
- **Regions are pointer-only.** They aren't focusable, so framing can't be
  edited from the keyboard. The accessibility audit is deferred per
  `UX_PRD.md` §5, but this is the first gap it should close.
- **Narrow windows.** The editor is laid out for about 1280px and its footer
  collapses badly below that. Out of scope per `UX_PRD.md` §5 (a desktop
  tool), noted here because it is visible.
- **"Save the MP4" instead of "Show me".** The render comes back to the
  browser as a file to save; there's no local folder to reveal it in, so
  "Show me" would promise something the button doesn't do.
- **"Your episode is ready" instead of "Episode 12 is out".** There are no
  episode numbers, and nothing is published anywhere yet — the file is on
  this machine.
- **"Save a draft" is visible but disabled**, because project persistence
  isn't built, and the 9:16 clip preview is a dashed "Not built yet" panel
  rather than a mock clip.
- **Publish is tall.** The 9:16 clips column makes the card about 850px,
  so on a small laptop screen "Render & publish" sits below the fold.
- **No "Follow the issue" link on `+ Note`.** There's no GitHub issue for
  annotations (searched), and a link to nothing is worse than none. Opening
  one is a public action, so it wasn't done unasked.
- **"Pick a different file" on the failed screen**, which the design's card
  doesn't have. Without it, a file that fails every time is a dead end.
- **"Give them a name anyway" is a labelled input**, not a button that
  reveals one — a step shorter.
- **The setup gate shows one thing at a time, not the handoff's rows.** At the
  founder's direction, nobody should have to leave the app: `npm run dev`
  starts the processing service (`vite.config.ts`), the Hugging Face token is
  pasted in, and the gate only shows what needs doing — "Getting ready" while
  the service starts, "Connect Hugging Face" when the token is missing, or the
  service's own last lines with "Try again" if it stopped. With everything in
  place it opens and closes in under a second. The "This window" and optional
  "Captions" rows are gone; captions are handled on Publish. Creating the token
  and accepting the model's terms still happen on huggingface.co, because
  they're on the user's own account and can't be done for them.
- **Audio-only files are only half handled.** The editor no longer collapses
  on a 0×0 frame and Publish says "no video track", but exporting an
  audio-only file through `render.py` hasn't been tried and may fail. If it
  does, the Publish error state shows why.

## What's left

In the handoff's implementation order:

1. ~~Tokens and theme switching~~ — **done**.
2. ~~Logo~~ — **done**.
3. ~~Setup gate~~ — **done**.
4. ~~Processing evidence~~ — **done**.
5. ~~Cast, one voice at a time~~ — **done**.
6. ~~Region-based editor~~ — **done**, except:
   - **6b. Per-instant visibility.** `bbox_at_time` returns the nearest
     keyframe however far away it is, so the renderer can't tell whether a
     person is on screen right now. The `7d` case "forced split, one person
     — takes effect the moment the other reappears" needs that (a keyframe
     within about 2s, plus segment boundaries where visibility changes, in
     both `render.py` and `faceCrop.ts`). Today a both-on-screen region with
     one findable person closes on them for the whole region.
7. ~~Publish screen and render states~~ — **done**.
8. ~~Edge-case sweep~~ — **done**, except two that wait on other things:
   - **Forced split, one person** needs per-instant visibility (6b above).
   - **Four people at once** — the handoff's 3-pane cap conflicts with a
     deliberate, tested no-cap decision in `render.py`. See "Open questions".
9. **Landing page (`4b`)** — last. Per-OS download buttons stay "Build from
   source" until desktop packaging exists.

## Frontend testing gap

There is no frontend test runner. `regions.ts` is pure and is the one module
where a silent bug changes what gets exported, so it's the first candidate if
one is added. The editor has been verified in the browser against a synthetic
clip instead.

## Open questions, not decided here

**The name.** The product is now named **Cutroom** in the UI (title, favicon, in-app
wordmark). `package.json`'s `name` field and the GitHub repo are still
`podcast-editor` — renaming those is a bigger, more visible change
(breaks any existing clone URLs/bookmarks, npm name if ever published) and
wasn't made unilaterally. Worth an explicit decision before the landing page
phase, since marketing copy throughout the handoff assumes "Cutroom"
everywhere.

**How many people fit on screen at once.** The handoff caps a shot at
three panes and shows a dashed `+1` tile naming whoever is left out ("Three
fit on screen. One won't."). `render.py` deliberately has no cap — its own
comment calls a four-person podcast a normal case, not an edge case — and
`test_a_region_is_not_capped` pins that: everyone talking is on screen, three
or more in the speaker-focus layout. The two can't both hold. Nothing was
changed: today nobody is ever dropped, so there's nothing to disclose and no
`+1` tile. Adopting the cap would change what real four-person episodes
export as, so it's the founder's call; if adopted, the cap and the tile have
to land in `render.py`, `regions.ts` and the preview together.

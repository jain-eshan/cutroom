# Design system — Cutroom

Where the project's visual design lives, what's been built from it, and
exactly what's left. `docs/UX_PRD.md` §5 deferred the visual design system
to a separate pass; this is that pass, picked up in phases (see "What's
left," below).

## Source of truth

The design system lives in Claude Design:
<https://claude.ai/design/p/5c7b0728-8af5-422c-9fa8-576daaf42312> (read it
with the DesignSync tool after `/design-login`). Its `readme.md` is the brand
rulebook, and a copy is kept here so nobody needs the login to read it:
[`design/handoff/design-system-readme.md`](design/handoff/design-system-readme.md).
The brand rules in it are fixed. Read it before touching anything visual.

Also in [`docs/design/handoff/`](design/handoff/), openable in a browser
from the dev server (`http://localhost:3460/docs/design/handoff/...`):

- **`Screen Audit.dc.html`**, a design QA of this codebase (2026-09-19):
  nine system-wide breaks (S1-S9) and the per-screen list.
- **`Screens Corrected.dc.html`**, every stage rebuilt on the design system.
  This is the layout spec the app now follows.
- The original bundle: four `.dc.html` canvases and `README.md`, the first
  handoff's token and screen spec. Where it and the design-system readme
  disagree, the readme wins (it is the later turn).

They're prototypes, not code to copy. The implementation is
`src/index.css` (tokens) and `src/components/ui.tsx` (primitives).

## Design system pass, 2026-09-19

The audit's headline was "The tokens landed. The screens didn't." This pass
applied the system instead of redesigning anything:

- **Dark is the default.** `src/index.css` has dark on the base layer and
  light behind `data-theme="light"` or a light OS in "System" mode.
  `useThemeMode` defaults to dark and only saves a choice someone actually
  made, under a new key (`cutroom.themeChoice`). The old key was written on
  every launch, so it couldn't tell a choice from a default. The marketing
  site pins `data-theme="light"` and is unaffected.
- **The missing tokens** (accent edge/wash/ring, ok/warn edges, beta, well,
  traffic lights) and **the type scale as named sizes** (`text-title`,
  `text-ui`, `text-meta`, `text-mono-sm`, `text-label`...). There is no 13px
  any more.
- **`src/components/ui.tsx`** holds the design's primitives: Button (six
  variants, including `inert`), SectionLabel, PlayButton (CSS triangle and
  bars), Triangle, CheckMark, StatusRow, StageRow, CommandBlock, RawMessage,
  EdgeCaseCard, Screen, and `AppWindow`, the title bar every stage now sits
  in (traffic lights, tiny mark, file name, theme switch, "service ok").
- **Every screen rebuilt to `Screens Corrected`**: setup as status rows;
  Drop in left-aligned with the task as its heading; Read it with one bar on
  the active stage; Name them as one question with the no-face card folded
  into the "didn't see" cell; the editor on plate tokens with its bottom bar
  split into Selected and Episode groups and Export last; Publish in two
  columns; the two dead ends as EdgeCaseCards.
- **`Logo.tsx`** is a port of the design's `Logo.jsx` (the shipped
  `assets/logo` geometry), not the earlier rebuild.
- **Desktop app:** on macOS the window hides its native title bar
  (`titleBarStyle: "hiddenInset"`) and the real traffic lights sit where the
  app's title bar leaves room for them. A browser draws them instead.

Where this differs from `Screens Corrected`, on purpose:

- **Copy stays true to what the app does.** The reference build mentions
  whisper for captions (it's ffmpeg's libass here), "Audio only" and "The
  edit file (.cutroom)" outputs, a `.cutroom` file extension, "Skip, one
  speaker only", and a "6:40" render estimate. None of those exist, so the
  screens say what does: the Publish card shows the episode's real length.
- **The transcript stays on the left** of the editor, as in `5a` and the
  app kit. The reference build moved it right without a note saying so;
  the founder decided on 2026-09-19 to keep it left.
- **Read it keeps the streaming transcript** (from `2e`), which the
  reference build dropped. It's the evidence that work is happening.
- **The spacing scale isn't registered as Tailwind spacing keys**, as the
  audit suggested. Defining `--spacing-5: 5px` would silently redefine
  every existing `gap-5`/`w-5` in the app from 20px to 5px. Exact values are
  written as `gap-[13px]` instead.
- **The terminal well stays dark in light mode.** The design's `--well`
  flips; commands and raw errors keep the dark terminal (as the audit
  praised), and only text inputs use the flipping `well`.
- **The editor's Selected group wraps to two lines** around 1340px with
  three people on camera, because it keeps the editable start/end times.
  The Episode group never wraps into it.

## Exception: the landing page's illustrated demo

The design system says "no illustrations", and the marketing site's demo
video is meant to be real footage. There is no real footage yet, so the
landing page keeps one illustration: the animated podcast set in
`site/src/Scene.tsx`, in the hero and in "It cuts to whoever's talking".

The move onto the site kit (2026-09-19) removed it, following the rule, and
left two empty striped boxes on the public page. On 2026-09-20 the founder
chose to put it back until real footage exists. Only the artwork is
off-system; the frames around it use the tokens. The page labels it as an
illustration. It is removed the day a clip everyone in it has agreed to
publish exists. The recipe and the checklist for removing it are in
[site/README.md](../site/README.md), "The hero demo".

This is the founder's waiver, not a change to the rule: elsewhere in the
product and the site the rule stands.

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
  `diarization` (whether the speaker model is on disk), and the gate won't
  advance without it, after a real run failed on a missing model six minutes
  into transcription. That row used to be a form: the model downloaded from a
  gated repo, so the gate asked for a Hugging Face token, checked it and the
  licence, and wrote `server/.env` itself. The weights ship with the app now,
  so the row only reports "pyannote community-1 · installed", and its one
  failure state is an install that didn't bring them. Nothing on this screen
  is asked of the person in front of it now: `npm run dev` starts the
  processing service (`vite.config.ts`), and with everything in place the
  gate opens and closes in under a second.
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

- **Drop zone border** is `text3` at 45% instead of the handoff's single
  literal, which was tuned for the dark theme only.
- **No filename echo on drag-over** — browsers don't expose the file until
  `drop`.
- **Recent episodes say "processed", not "edited · not published"**:
  edits aren't saved with an episode yet, so a reopened one starts again
  from naming the people.
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
- **"Save a draft" is visible but inert**, because project persistence
  isn't built. The 9:16 clip preview is gone; the right column holds the
  episode's length and then the render state.
- **No "Follow the issue" link on `+ Note`.** There's no GitHub issue for
  annotations (searched), and a link to nothing is worse than none. Opening
  one is a public action, so it wasn't done unasked.
- **"Pick a different file" on the failed screen**, which the design's card
  doesn't have. Without it, a file that fails every time is a dead end.
- **"Give them a name anyway" is an input inside the "Someone we didn't
  see" cell**, shown when that cell is picked, rather than a separate card.
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
   - **6b. Per-instant visibility, partly done 2026-09-18** (EDGE_CASES.md
     B7). `bbox_at_time`/`bboxAtTime` still find the nearest keyframe
     however far away it is, but `is_visible_at`/`isVisibleAt` (`render.py`,
     `faceCrop.ts`) now gate on a sighting within 2s before that bbox is
     used at all -- a both-on-screen region with one findable person now
     falls back to a close-up on them correctly, instead of closing on a
     stale sighting. **Still open:** the check only runs at the one point a
     region's crop is already sampled (its start), so the `7d` case "forced
     split, one person -- takes effect the moment the other reappears"
     isn't there yet -- that needs a new segment boundary wherever
     visibility changes *mid-region*, not just a stricter check at the
     existing sampling point. Deferred with smooth re-aiming
     (STATUS.md's host-test gate).
7. ~~Publish screen and render states~~ — **done**.
8. ~~Edge-case sweep~~ — **done**, except two that wait on other things:
   - **Forced split, one person** still needs the harder, mid-region half
     of per-instant visibility (6b above).
   - **Four people at once** — the handoff's 3-pane cap conflicts with a
     deliberate, tested no-cap decision in `render.py`. See "Open questions".
9. ~~Landing page (`4b`)~~ — **done** (2026-09-15), in `site/`. Changes from
   the design, all to keep it honest before there's a packaged app:
   - The primary actions are "Join the waitlist" (a Tally form) and "Run the
     developer preview", not per-OS download buttons.
   - The hero is an animated illustration of the framing, not a filmed loop,
     until a real episode clip can be shown with everyone's agreement. Its
     crops use `framing.py`'s proportions.
   - The proof numbers are replaced with measured ones from STATUS.md
     (`~5 min to edit 25 minutes` and `4K kept` weren't measured). The "$30 a
     month" price anchor was dropped for the same reason.
   - "What it can't do yet" lists today's real gaps, and there's no Discord
     link because there's no Discord.
   - **The handoff's own blocker is resolved** (noted here rather than
     edited into `design/handoff/README.md`, which is the designer's input
     document and stays as written). It said per-OS download buttons were
     untrue until the app was packaged, and that the install path was "uv +
     ffmpeg + a Hugging Face token + a model licence + two terminal
     windows". Packaging shipped (2026-09-16) and the page carries real
     Mac and Windows download links; the token and the model licence went
     with the bundled weights (2026-09-20), and the build ships its own
     ffmpeg. What the handoff didn't anticipate is the remaining catch: the
     Mac build is unsigned, so Gatekeeper blocks it on first open.

## Frontend testing gap

`npm test` runs Node's built-in test runner over `src/**/*.test.ts`, with no
test library. So far it only covers the timeline maths (`timelineView.ts`).
`regions.ts` is next: it's pure, and it's the one module where a silent bug
changes what gets exported. It imports through the `@/` path shortcut, which
Node can't follow, so that has to be sorted first. The rest of the editor is
verified in the browser against a synthetic clip.

## Open questions, not decided here

**The name.** Decided on 2026-09-15: everything is **Cutroom**. The GitHub
repository was renamed from `podcast-editor` to `cutroom` for the developer
preview launch (GitHub redirects the old address), along with `package.json`'s
`name` and the processing service's title.

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

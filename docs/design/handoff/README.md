# Handoff: Cutroom — brand system + end-to-end product design

## Overview

Cutroom is an open-source, local-first tool that takes a **single-camera podcast recording** (one frame, multiple speakers, one mixed audio track) and produces a **published episode**: auto-framed video, burned-in captions, chapters, show notes and short clips.

The existing repo (`jain-eshan/podcast-editor`) already ships the pipeline — transcription, diarization, face recognition, lip-sync voice matching, auto-framing and MP4 export. `docs/UX_PRD.md` §5 explicitly deferred the visual design system to a separate pass. **This bundle is that pass.** It also carries a scope change: the product is positioned as everything between the raw recording and the published episode, not as an editor.

What this handoff covers:
1. The brand system — name, mark, colour, type, voice.
2. A full light/dark theme token layer.
3. Every screen, including a new Publish stage.
4. Every error and edge case from the PRD's own matrix.

---

## About the design files

The files in this bundle are **design references created in HTML**. They are prototypes showing intended look and behaviour — **not production code to copy**.

The task is to **recreate these designs inside the existing codebase** (React + Vite + TypeScript + Tailwind, per the repo's stack) using its established patterns. Concretely, that means:

- Tokens below become Tailwind theme extensions or CSS custom properties — not inline styles.
- Each screen below maps to an existing or new component under `src/features/`.
- The HTML uses absolutely-positioned divs to draw the logo mark. **In the real app, ship the mark as an SVG** built from the geometry table below.
- The HTML mocks use striped `repeating-linear-gradient` blocks wherever real video frames, face thumbnails or demo footage belong. Those are placeholders.

Do not port the HTML. Read it, take the values, rebuild it properly.

---

## Fidelity

**High-fidelity.** Colours, typography, spacing, radii and copy are final and should be matched exactly. Layout proportions are intentional. The one exception is the logo mark: rebuild as SVG rather than matching the div-based construction.

---

## Design tokens

### Colour — semantic roles

Every colour is authored in OKLCH. Speaker hues share identical lightness and chroma so no participant reads as more important than another.

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `bg` | `oklch(0.15 0.008 70)` | `oklch(0.955 0.005 85)` | App canvas |
| `panel` | `oklch(0.17 0.008 70)` | `oklch(0.985 0.004 85)` | Sidebars, timeline tray |
| `chrome` | `oklch(0.20 0.008 70)` | `oklch(0.93 0.006 85)` | Title bar |
| `raised` | `oklch(0.22 0.008 70)` | `oklch(1 0 0)` | Cards, inset groups |
| `control` | `oklch(0.26 0.008 70)` | `oklch(0.905 0.006 85)` | Secondary buttons, chips |
| `line` | `oklch(0.25 0.008 70)` | `oklch(0.875 0.006 85)` | Dividers, borders |
| `text` | `oklch(0.95 0.005 80)` | `oklch(0.20 0.008 70)` | Primary text |
| `text2` | `oklch(0.80 0.01 80)` | `oklch(0.38 0.008 70)` | Secondary text |
| `text3` | `oklch(0.66 0.01 80)` | `oklch(0.47 0.008 70)` | Tertiary / metadata |
| `accent` | `oklch(0.74 0.16 52)` | `oklch(0.74 0.16 52)` | **Does not flip.** Signal colour |
| `onAccent` | `oklch(0.20 0.02 60)` | `oklch(0.20 0.02 60)` | Text on accent — 7.5:1 |
| `accentText` | `oklch(0.80 0.13 60)` | `oklch(0.47 0.14 45)` | Accent-coloured text/links |
| `track` | `oklch(0.215 0.008 70)` | `oklch(0.915 0.006 85)` | Empty timeline lane |
| `rWide` | `oklch(0.30 0.01 70)` | `oklch(0.845 0.008 85)` | Region: untouched wide |
| `rClose` | `oklch(0.44 0.09 52)` | `oklch(0.83 0.08 62)` | Region: suggested close-up |
| `rMine` | `oklch(0.62 0.13 52)` | `oklch(0.74 0.16 52)` | Region: user-edited |
| `rBoth` | `oklch(0.47 0.10 30)` | `oklch(0.81 0.10 35)` | Region: multi-person |
| `rInk` | `oklch(0.97 0.01 70)` | `oklch(0.24 0.03 60)` | Label on wide/suggested/both |
| `rMineInk` | `oklch(0.20 0.02 60)` | `oklch(0.20 0.02 60)` | Label on user-edited — 4.77:1 |
| `handle` | `oklch(0.97 0.005 80)` | `oklch(0.22 0.01 70)` | Drag handles, playhead |
| `s1` | `oklch(0.74 0.16 52)` | `oklch(0.56 0.16 45)` | Speaker 1 |
| `s2` | `oklch(0.72 0.13 175)` | `oklch(0.48 0.12 190)` | Speaker 2 |
| `s3` | `oklch(0.70 0.14 285)` | `oklch(0.50 0.13 290)` | Speaker 3 (pane cap is 3) |
| `plateA` / `plateB` | `oklch(0.27 / 0.23 0.008 70)` | `oklch(0.33 / 0.285 0.006 85)` | Video plate — **stays dark in both** |
| `plateInk` | `oklch(0.72 0.01 80)` | `oklch(0.78 0.01 80)` | Text over the video plate |
| `ok` | `oklch(0.72 0.13 155)` | `oklch(0.52 0.13 155)` | Success, service healthy |
| `warn` | `oklch(0.80 0.13 40)` | `oklch(0.48 0.15 35)` | Overlap flags, warnings |
| `warnBg` | `oklch(0.62 0.15 30 / .2)` | `oklch(0.62 0.15 30 / .14)` | Warning chip background |
| `sel` | `oklch(0.21 0.008 70)` | `oklch(0.955 0.012 70)` | Selected transcript turn |
| `shadow` | `0 2px 16px rgba(0,0,0,.24)` | `0 2px 16px rgba(0,0,0,.10)` | Window elevation |

**Three theme rules that must survive implementation:**

1. **The accent never flips.** Amber with dark text clears 7.5:1 on both grounds. It is the only colour meaning "the app is telling you something," and keeping it byte-identical is what makes the two themes read as one product.
2. **Speaker colours do flip.** At L 0.74 they are legible on black and invisible on white. Light mode drops them to ~L 0.5 and keeps the hues.
3. **The video plate stays dark in both themes.** A light surround changes how a person judges exposure and skin tone. Light mode only lifts it enough not to look like a hole punched in the window.

### Theme mode

Three-state, persisted: `system` (default) / `light` / `dark`. `system` subscribes to `window.matchMedia('(prefers-color-scheme: dark)')` and must react live, not only on mount. A video editor is the one app class where users deliberately override the OS setting, so the manual override is required — do not ship system-only.

### Typography

- **UI + body:** Instrument Sans (Google Fonts), weights 400/500/600.
- **Machine values:** JetBrains Mono, weights 400/500.

**The one rule that carries the whole system:** monospace is used *only* for something the machine measured — timecodes, file sizes, resolutions, filenames, percentages, shell commands, error strings. If a human wrote it or a human is meant to feel it, it's Instrument Sans. Never use mono for prose.

| Role | Size / line-height | Weight | Tracking |
| --- | --- | --- | --- |
| Display (marketing) | 48 / 52 | 600 | −0.035em |
| Screen title | 18–19 / 24 | 600 | −0.01em |
| Section heading | 15 / 20 | 600 | 0 |
| Body — transcript | 13.5 / 22 | 400 | 0 |
| Secondary / reasons | 11–12.5 / 17–19 | 400 | 0 |
| Label (uppercase) | 9.5–10 mono | 500–600 | 0.08em |
| Metadata mono | 10–12 | 400–500 | 0 |

Minimum body size in-app is 11px; anything smaller must be mono metadata only.

### Spacing, radius, elevation

- Spacing scale (px): `2, 4, 5, 6, 7, 9, 10, 11, 13, 14, 16, 18, 20, 22, 24, 26, 28, 34, 44, 52`. In practice: 4/8-ish with half steps at small sizes.
- Radius: `3` chips/regions · `5–6` buttons and inputs · `7–8` cards · `9–11` panels · `17` app-icon container · `50%` avatars and speaker dots.
- Border: always `1px solid line`. Emphasis borders use the accent at 45% alpha.
- Elevation: one shadow only, the `shadow` token. No layered shadow scale.

### Accessibility floor

All text meets **4.5:1** against its composited background (3:1 for headline-scale). This was verified across every screen. Two deliberate exceptions, both opacity-based rather than colour-based, so they read as state rather than as mistakes: out-of-focus transcript lines, and pending/disabled pipeline stages.

---

## The logo mark

**Name:** Cutroom — one word, everywhere. Project files use the `.cutroom` extension. The two-word form "cut room" is used only in running prose describing the physical room.

**Concept:** two people at a table with two boom mics swinging in from opposite corners, inside a rounded square that reads as both the room and the shot. The mic capsules are the only accent-coloured elements.

**Ship it as SVG.** Geometry below is given for a 72×72 viewBox; scale proportionally. Coordinates are relative to the inner content box (i.e. inside the 4px frame stroke).

| Element | Geometry (72px box) | Fill |
| --- | --- | --- |
| Frame | 72×72, `border: 4px`, radius 17, clips children | `ink` |
| Left boom | group at (1, 1), `rotate(34deg)` about left-centre: arm 20×4 r2, gap 2, capsule 7×11 r4 | arm `ink`, capsule `accent` |
| Right boom | group at (right 0, top 18), `rotate(-22deg)` about right-centre: capsule 5×8 r3, gap 2, arm 13×3 r2 | arm `ink`, capsule `accent` |
| Left head | left 14, bottom 21, 12×12 circle | `ink` |
| Left body | left 9, bottom 10, 22×16, radius `11 11 0 0` | `ink` |
| Right head | right 10, bottom 18, 9×9 circle | `ink` |
| Right body | right 6, bottom 10, 17×12, radius `8.5 8.5 0 0` | `ink` |
| Counter | full width, bottom 0, height 10 | `ink` |

**Two constraints that are not decoration — breaking either breaks the mark:**

1. **It must stay asymmetric.** An earlier symmetric version (matched booms, matched heads, centred table bar) read as eyebrows / eyes / mouth — an angry face — and it got *worse* as detail dropped. The differing boom angles (34° vs −22°), differing arm lengths (20 vs 13), differing head sizes (12 vs 9) and the counter running flush to the frame are what prevent that. Do not "tidy" them into symmetry.
2. **The capsules must clear the heads by ~4px.** They read as mics suspended on booms only if there is air beneath them; touching the heads makes them read as orange hats.

### Reduction ladder — switch by rendered size, never scale one file

| Size | Version | Contents |
| --- | --- | --- |
| ≥ 40px | Full | Everything above |
| 26–39px | Mid | Booms, bodies, counter — **heads dropped** |
| ≤ 20px | Tiny | Two accent capsules (left 3×5.5 rot 22°, right 2.5×4 rot −14°) + counter + frame |

Tiny still reads as "two mics over a table" and is what belongs in the app title bar and favicon.

---

## Screens

Six stages: **Set up → Drop in → Read it → Name them → Edit → Publish.**
`App.tsx`'s existing `Status` union needs a new `publishing` member; `error` states are handled per-screen rather than as a global route (see Edge cases).

### 1. Setup gate — `2d` in `Product Design.dc.html`

**Purpose:** get the local processing service running before the user ever sees the product. This was identified as the single biggest drop-off risk, so it is a real screen, not a README line.

**Layout:** centred card, 470px wide, 26px padding, `bg` canvas, radius 11.

**Components:**
- Title "Two things need to be running" — 19px/600, `text`.
- Subtitle — 12.5/1.6, `text3`. Copy: "Cutroom does all the work on your own machine, so the machine has to be awake. This page checks every few seconds — it'll move on by itself."
- Three status rows, 12–14px padding, radius 7, `raised` background, `line` border:
  - **This window** — filled `ok` circle 19px with a checkmark. Sub-line `localhost:5173` in mono.
  - **The processing service** — 19px ring in `accent`, border on the row is `accent / 45%`. Expands to show an instruction line, a command block, and a success hint.
  - **Captions available** — 19px ring in a muted grey, row at 60% opacity. Sub-line "Optional — needs ffmpeg built with libass".
- Command block: `oklch(0.11 0.008 70)` background, `line` border, radius 6, mono 11.5px, with a `COPY` button on the right. Command: `cd server && uv run uvicorn main:app --port 8787`
- Footer: a **deliberately inert** "Waiting…" button in `control`/`text3` — there is nothing correct to click — plus a text link "Read the 4-step setup".

**Behaviour:** poll `GET /health` on `localhost:8787` every 2s. On success, advance automatically with a brief confirmation; success must be unmissable and must not require a click. The row must name *which* service is down, not report a generic connection failure.

### 2. Drop in — `7a` in `Screens.dc.html`

**Purpose:** accept one recording; offer previous episodes.

**Layout:** 412px card. Logo lockup, title, drop zone, privacy note, recents list.

**Components:**
- Drop zone — `1.5px dashed` `oklch(0.34 0.01 80)`, radius 9, 30px vertical padding, `panel` background. Centre: a 38px `control` tile, "Drag a recording here" (13px/500), "or **choose a file**" with the accent as the link colour.
- Privacy note — `raised` row with an `ok` dot. Copy: "Everything happens on this machine. Nothing is uploaded, and a 4 GB file doesn't cost you 4 GB of bandwidth."
- Recents — 40×24 thumbnail, name in 12/500, status in mono 10px ("edited · not published"), `Open` button.

**Drag state (the whole window changes, not just the zone):**
- Card border → `2px solid accent`, plus a `0 0 0 6px accent/12%` ring.
- Logo lockup drops to 40% opacity.
- Drop zone grows to fill, background `accent / 9%`, border `2px solid accent`.
- Copy changes to "Let go to start", and **the filename and size are echoed back before release** so a wrong file is caught while it is still cancellable.
- Footnote: "A second file would replace this one — only one recording per episode."

**Behaviour:** real `onDragOver` / `onDragLeave` / `onDrop` on the drop zone. Accepts `video/*,audio/*`. Use `XMLHttpRequest` for upload — `fetch()` cannot report upload progress.

### 3. Read it (processing) — `2e` in `Product Design.dc.html`

**Purpose:** make a 5-minute wait legible as work rather than as a hang.

**Layout:** 640px card. Header row (title + elapsed/remaining), four stage rows, divider, then a two-column evidence area (transcript ~1fr, faces 208px).

**Components:**
- Elapsed — 22px mono in `accent`; remaining — 10.5px `text3` beneath.
- Stage rows — `150px | 1fr | 46px` grid. Label, 6px bar radius 3, right-aligned status. Completed bars fill `oklch(0.50 0.10 155)` and read "done"; the active bar fills `accent` and shows a percentage; pending rows sit at 50% opacity with an em-dash.
- Stage labels are plain English, not pipeline names: "Sending the file", "Writing the transcript", "Finding who's on camera", "Matching voices to faces".
- **Live transcript** — lines stream in as they're produced, older lines at 55–75% opacity, newest at full, with a 2px accent caret and a mono `05:41 / 24:18` position.
- **Faces found** — square thumbnails appearing as people are recognised, each ringed in that person's speaker colour, with a dashed empty slot for the next. Caption: "You'll name them on the next screen."
- Footer: "Roughly a fifth of the recording's length on a laptop. Keep this tab open — the work is happening on your machine, not in the cloud."

**Behaviour:** poll `GET /progress/{job_id}`. The evidence area is the point of this screen — a progress bar proves time passed, output proves work happened. Streaming the transcript also front-loads the Cast screen: by the time the user arrives, they've already watched two people appear and been told they'll name them.

### 4. Name them (cast) — `2f` in `Product Design.dc.html`

**Purpose:** confirm who each voice is. This is the most consequential input in the pipeline, so it is presented as one answerable question at a time rather than as a form.

**Layout:** 540px card. Header with "voice N of M", a quote block, face candidates, confirm row.

**Components:**
- Quote block — `raised`, radius 8: the longest utterance from this voice at **16px/1.55** (large on purpose — it's the evidence), a 32px accent play button, a 15-bar waveform in `oklch(0.38 0.01 80)`, and a mono duration.
- Face candidates — cards in a row. Selected: `2px solid` that person's speaker colour. Each has a 1.2 aspect thumbnail, a name field (13px/600) and a confidence line: **"Lips match 91% of this clip"** — a percentage of the clip, never a bare "uncertain" flag.
- A dashed "Someone we didn't see" card for off-camera voices.
- Confirm: accent button "Yes, that's Dev", with "We guessed Dev. Play the clip if you're not sure." beside it.

**Behaviour:** naming is inline on the card, so there is no separate naming step. Alternative one-screen cast sheet is documented as `2g` — it is faster on a re-run but a beginner will click through without listening, which is how the pipeline's most important input gets guessed. Ship `2f`.

### 5. Edit — `5a` in `Product Design.dc.html` (**the definitive editor; `2a` and `4a` are earlier iterations**)

**Purpose:** review and change the automatic framing decisions.

**Layout:** `1280 × ~560`. Title bar 44px. Body splits: transcript 404px fixed | preview `1fr`. Timeline tray pinned below, spanning full width.

**Title bar:** traffic lights, 18px tiny logo mark, filename in mono with a `text3` extension, save state, **theme switcher** (three segmented buttons in a 3px-padded `raised` group), service health dot, accent `Export` button.

**Transcript column (`panel`):**
- Header: "Transcript" 13/600 + a review counter chip (`raised`, accent square, "3 to review").
- Turn rows: 10–13px padding, a **3px left border** carrying state — transparent (normal), `accent` (selected), `rBoth` (overlap), `warn` (needs attention).
- Each row: speaker dot (7px, speaker colour), name 11.5/600, mono timecode, and on the selected row an accent right-aligned status.
- Selected row: `sel` background, body text at 13.5/1.6 in `text`; unselected at 12.5/1.55 in `text3`.
- Overlap rows carry a `TALKING OVER` chip — mono 9.5, `warnBg` / `warn`, radius 3, tracking 0.04em.
- Every automatic decision carries a one-clause reason beneath it: "Maya is talking alone here, so we cut in close."

**Preview (`bg`):** 16:9 plate filling available height, radius 8. Overlay chips top-left (current framing, source resolution) and a mono timecode bottom-right on a 55%-black pill. Below: 32px accent play button, mono position, and right-aligned `Captions on` / `Fit` chips.

**Timeline tray (`panel`, top border `line`):**
- Toolbar: "FRAMING" label, `+ Close-up` / `+ Both on screen` buttons, and a right-aligned legend — a `rClose` swatch for **Suggested**, a `rMine` swatch with a `handle` border for **Yours**.
- **Framing lane** — 38px tall, radius 5, `track` background, `line` border. Contains absolutely-positioned regions:
  - Suggested regions: `rClose` / `rBoth` fill, label in `rInk`.
  - User-edited regions: `rMine` fill, `1px solid handle` border, radius 3, label in **`rMineInk`** (dark — this is a separate token precisely because `rMine` is light enough to need dark ink).
  - Wide regions: `rWide`.
  - Drag handles: 4px × (height − 12), `handle`, radius 2, seated 3px inside each edge of the selected region.
  - Playhead: 2px full-height `handle`.
- Speaker lanes — 15px, `track`, blocks in each speaker's colour at their speaking times.
- Captions lane — 11px.
- Footer: a contextual hint on the left, `Reset to suggested` and accent `Export episode` on the right.

**The central interaction:** framing is a **region with draggable edges**, not three buttons bound to a turn. Regions do not have to agree with turn boundaries — that is what lets an editor hold a close-up through a short interjection, which is what a human editor does and what a per-turn model cannot express. Anything not covered by a region renders wide.

**Critical layout note:** every region is `position:absolute` with a percentage `width` **plus** horizontal padding and, for user-edited regions, a 1px border. Without `box-sizing: border-box` these overflow their slots, overlap each other and drift out of alignment with the speaker lanes below. Set it globally.

### 6. Publish — `7b` in `Screens.dc.html` (**new — this is the scope change**)

**Purpose:** turn "an editor" into "a way to publish." Export is reframed from *a button* into *a manifest* of everything an episode actually needs before it can go out.

**Layout:** 700px. Header (title + mono summary + "Back to editing"). Body is `1fr | 230px`: artefact checklist and destinations on the left, a 9:16 clip preview on the right. Footer bar with time estimate and actions.

**Artefact rows** — radius 7, 11×13 padding. Checked rows: `raised` background, `accent / 45%` border, 17px accent tile with a dark checkmark. Unchecked: `panel` background, `line` border, 17px `oklch(0.42 0.01 80)` ring.

| Artefact | State | Sub-line |
| --- | --- | --- |
| The episode | on, not optional | `MP4 · 3840×2160 · original audio untouched` |
| Captions | on | `burned in · also saved as .srt` |
| Chapters | on, has a `Review` action | `6 found · YouTube timestamps ready` |
| Show notes | off | `draft from the transcript — yours to rewrite` |
| Short clips | off, `BETA` chip | `3 suggested · 9:16 · adds ~4 min` |

**Destinations:** chips — "A folder on this Mac" (selected), "YouTube", "RSS / host". Note beneath: "Connecting a destination is the only thing here that ever leaves your machine, and it asks first, every time." This is the one exception to the local-first promise in the entire product, so it is stated out loud.

**Clip preview:** 9:16 plate with a burned-caption bar, and the honest explanation: "Clips are cut where the transcript gets dense and nobody interrupts — a heuristic, not a model, so it stays offline."

**Footer:** "About 6 minutes. You can keep using your machine — it'll be slower." + `Save a draft` + accent `Render & publish`.

Show notes and clips are unbuilt. They appear **unchecked and honest**, not hidden.

---

## Render states — `7c` in `Screens.dc.html`

Four states, 250–290px cards, ~196px min-height.

| State | Shows | Action |
| --- | --- | --- |
| `idle` | Just the button. **No progress bar sitting at zero.** | accent `Render & publish` |
| `rendering` | 5px accent bar, "Turn 12 of 31 · about 4 minutes left", plus "Leave this window open — closing it stops the render." | inert `Rendering…` |
| `done` | `ok` border. "Episode 12 is out" + the artefact list + output path in mono. | accent `Show me` + `New` |
| `error` | `warn` border. Plain-English line **plus the raw server message in mono** on `oklch(0.11 0.008 70)`. "Your edits are safe." | accent `Try again` |

**Backend note carried over from the PRD:** `/export` is a synchronous request. Closing the tab aborts it client-side but may orphan the `ffmpeg` subprocess. The server should watch for a dropped connection and kill the child process. There is no cancel button until that exists.

---

## Edge cases — `7d` in `Screens.dc.html`

Every one follows the same four-beat pattern: **what happened → why → what we did instead → how to change it.** No dead ends. The raw server message is always shown in mono beneath the plain-English version so it stays copy-pasteable into a GitHub issue.

| Case | Trigger | Behaviour |
| --- | --- | --- |
| Nobody on camera | Zero faces detected | "Maybe it's an audio-only recording…" → stays wide throughout. `Keep going anyway` / `Pick a different file` |
| Voice with no face | A diarized voice never coincides with a visible face | Their turns stay wide. Shows turn count and total duration. `Give them a name anyway` |
| Forced split, one person | User selects multi-person on a stretch where only one is visible | Falls back to close-up on whoever is visible; takes effect the moment the other reappears. `Fine, close on Maya` / `Go wide` |
| Four people at once | More than the 3-pane cap | Three panes plus a dashed `+1` tile. Names who is excluded — never silently dropped. `Choose who's shown` |
| Captions unavailable | ffmpeg lacks libass | Caught **before** the render, not after. Copyable `brew install ffmpeg-full`. `Publish without them` |
| Stopped while reading | Pipeline failure mid-processing | Mono error, how far it got, "Nothing was lost". `Try again` / `Copy the details` |
| Closing mid-render | Window close during render | "It's 38% through… only the rendered video is lost." `Keep rendering` / destructive-outline `Close anyway` |
| Not built yet | Annotations | Explains what it will be and that the issue is open. Dashed disabled control + `Follow the issue` |

---

## Voice & copy rules

- Every automatic decision states **what it did and why**, in one clause, in words the user would use.
- **Never announce that something is automatic.** Show the result and the reason; let the override do the reassuring.
- No exclamation marks, no emoji, no "magic", no "AI-powered".
- Plain-English shot names in the UI: **"Close on Maya"**, not "Zoom". "Both on screen", not "Split".
- Say: "We couldn't see a face here, so we stayed wide." Not: "No face mapping available for this segment."
- Error copy names the thing that broke and what to do. The technical string goes in mono underneath, never instead.

---

## Landing page — `4b` in `Product Design.dc.html`

**Light theme** (the app is dark; the marketing site is light — that split is deliberate).

Structure: nav with a `Star on GitHub` button · centred hero · looping demo video · three feature blocks with looping clips · four proof numbers · "What it can't do yet" table · closing band.

- Price anchor pill above the headline: "A free, local alternative to the $30-a-month podcast editors".
- Headline 52px/600, −0.035em: **"Podcast video that cuts itself"**.
- Primary action is per-OS download buttons, dark fill. Sub-line: "Free forever · MIT · nothing leaves your machine · or build from source".
- Hero is the **output playing**, not a diagram — a 16:9 autoplay loop in a white 10px-padded frame with a soft shadow.
- Proof numbers: `~5 min` to edit 25 minutes · `0 bytes` leave your laptop · `4K` source resolution kept · `$0` no tier above this one.
- **"What it can't do yet"** table — annotations (button exists), voice ducking (unsolved), social clips (not started), multi-cam (not started). This is the credibility block and the contributor funnel; it is the one thing competitors omit and it should not be cut.
- Closing: "Free because the expensive part — the GPU, the storage, the render — is already sitting on your desk. There's nothing to host, so there's nothing to charge for."

**Blocker to flag before this page ships:** the per-OS download buttons are untrue until the app is packaged. Today's install path is uv + ffmpeg + a Hugging Face token + a model licence + two terminal windows. Until packaging exists, the primary button must read "Build from source". **Desktop packaging is the single highest-leverage item on the roadmap** — the design ceiling for the stated audience (new creators, small editors) is set by it, not by anything in this document.

---

## State management

```
type Status =
  | 'checking'    // setup gate polling /health
  | 'idle'        // drop-in screen
  | 'processing'  // polling /progress/{job_id}
  | 'cast'        // voice-to-face confirmation
  | 'editing'     // the editor
  | 'publishing'  // publish manifest + render states
  | 'error'
```

Additional state:
- `theme: 'system' | 'light' | 'dark'` — persisted; `system` subscribes live to `matchMedia`.
- `regions: FramingRegion[]` — `{ id, startMs, endMs, layout, subjectIds[], source: 'suggested' | 'user' }`. **Not** a per-turn field; regions are independent of turn boundaries and are the editor's source of truth.
- `selectedTurnId` — drives transcript, preview and playhead from one selection.
- `flaggedTurnIds` — powers the "N to review" counter and the review queue.
- `project` — `{ name, path, savedAt }` for `.cutroom` save/reopen.
- Per-screen error state; `error` is not a global route except for a fatal pipeline failure.

**Keep in sync:** the live preview's crop maths, pane layout and 3-pane cap must match `server/pipeline/render.py` exactly. A preview that disagrees with the export is worse than no preview. The padding ratio in `faceCrop.ts` and `framing.py` must always change together.

---

## Assets

- **Fonts:** Instrument Sans and JetBrains Mono, both Google Fonts. Self-host for a local-first desktop app.
- **Logo:** no file supplied — rebuild as SVG from the geometry table above.
- **Placeholders:** every striped `repeating-linear-gradient` block is a placeholder for real video frames, face thumbnails or demo footage. None are assets.
- **Icons:** the design deliberately uses almost none. Speaker identity is carried by colour, not iconography. Do not add an icon set.

---

## Files in this bundle

| File | Contents |
| --- | --- |
| `Brand Kit.dc.html` | **Turn 8** — the shipped mark `8a`, five alternates, lockups and the reduction ladder `8g`. **Turn 6** — superseded marks, plus the still-current colour, type and voice sections. |
| `Product Design.dc.html` | **Turn 5** — the definitive themed editor `5a` and the token table `5b`. **Turn 4** — `4a` region editor, `4b` landing page. **Turn 2** — `2d` setup gate, `2e` processing, `2f`/`2g` cast, earlier editor layouts `2a`/`2b`/`2c`. |
| `Screens.dc.html` | **Turn 7** — `7a` drop-in, `7b` publish, `7c` render states, `7d` edge cases. |
| `Brand.dc.html` | Naming rationale and the earliest brand exploration. Historical context only. |

Each file is a design canvas: options are grouped into numbered turns, newest at the top, and every option has a stable id (`5a`, `7b`…) shown as a badge. **Where turns conflict, the higher number wins.**

Open any file directly in a browser.

## Implementation order

1. Token layer + theme switching — everything else depends on it.
2. Logo as SVG at three reduction levels.
3. Setup gate and drop-in — the two screens gating first use.
4. Processing with live evidence.
5. Cast.
6. Editor — the region model first, then the transcript and preview bound to it.
7. Publish + render states.
8. Edge cases, swept as a pass across all screens.
9. Landing page — last, and only ship the download buttons once packaging is real.

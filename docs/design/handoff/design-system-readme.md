# Cutroom — design system

Cutroom is an **open-source, local-first tool that turns a single-camera podcast recording into a published episode.** One flat frame with two or three people and one mixed audio track goes in; an auto-framed video with burned-in captions, chapters, show notes and short clips comes out.

The product's honest claim is narrower and better than "AI video editor": **it does the camera work you don't have a camera operator for.** Everything is decided in advance and everything is overridable. Every byte stays on the user's machine.

There are two surfaces:

1. **The app** — a desktop-shaped web UI, six stages: Set up → Drop in → Read it → Name them → Edit → Publish. Runs **dark**.
2. **The marketing site** — a single page. Runs **light**.

That split is deliberate: you judge video frames in the app, and a bright chrome lies about exposure; a dark marketing page reads as "for engineers", which is the audience the project already has. Both run off one token layer.

---

## Sources this was built from

| Source | What it gave |
| --- | --- |
| `design_handoff_cutroom/README.md` (in this project) | The engineering handoff: full token table, screen-by-screen spec, logo geometry, voice rules, state model |
| `Product Design.dc.html` | `5a` themed editor (definitive) · `5b` token table · `4a` region editor · `4b` landing page · `2d` setup gate · `2e` processing · `2f`/`2g` cast · `2a`–`2c` earlier editors · `2h` earlier landing |
| `Screens.dc.html` | `7a` drop-in (+ drag state) · `7b` publish · `7c` four render states · `7d` eight edge cases |
| `Brand Kit.dc.html` | `8a` the shipped mark · `8b`–`8f` alternates and lockups · `8g` reduction ladder |
| `Brand.dc.html` | Naming rationale, three brand directions, the dark-app/light-site correction |
| Upstream repo referenced by the handoff | `jain-eshan/podcast-editor` — React + Vite + TypeScript + Tailwind; `docs/UX_PRD.md` §5 deferred the visual system to this pass. **Not read directly; not attached to this project.** |

Where the source design turns conflict, **the higher-numbered turn wins** — that is how the design canvases are ordered.

---

## Index

| Path | Contents |
| --- | --- |
| `styles.css` | The one file consumers link. `@import`s only. |
| `tokens/colors.css` | Dark on `:root`, light on `[data-theme="light"]`. All OKLCH. |
| `tokens/typography.css` | Families, sizes, line-heights, tracking, weights. |
| `tokens/layout.css` | Spacing scale, radius ladder, border weights, lane heights. |
| `tokens/fonts.css` | Webfont loading. **See Caveats — the binaries are not in this project.** |
| `components/core/` | Button · Chip · Card · SectionLabel · Timecode · MonoBlock · Placeholder · Logo |
| `components/pipeline/` | StatusRow · CommandBlock · StageRow · DropZone · FaceCard · Waveform · PlayButton |
| `components/editor/` | TitleBar · ThemeSwitch · TranscriptTurn · SpeakerDot / SpeakerDots · VideoPlate · FramingLane / SpeakerLane · FramingRegion |
| `components/publish/` | ArtefactRow · DestinationChip · RenderStateCard · EdgeCaseCard |
| `components/marketing/` | SiteNav · ProofStat · FeatureBlock / RoadmapRow |
| `ui_kits/app/` | Six-stage click-through of the product, plus all eight edge-case states. Start here. |
| `ui_kits/site/` | The landing page. |
| `guidelines/*.html` | 27 specimen cards — type, colour, spacing, states, motion, brand, voice. |
| `assets/logo/` | The mark as SVG at three rungs of the reduction ladder, plus two lockups. |
| `SKILL.md` | Makes this folder usable as an Agent Skill in Claude Code. |

---

## Content fundamentals

### The one voice rule

**Every automatic decision states what it did and why, in one clause, in words the user would use.**

> "Maya is talking alone here, so we cut in close."
> "We couldn't see a face here, so we stayed wide."

A reason is what makes an override feel safe. Without it, an automatic decision reads as something happening *to* the user.

### Never announce that something is automatic

Show the result and the reason; let the override do the reassuring. There is no "AI-powered", no "magic", no "smart", no sparkle. The word "AI" appears nowhere in the product.

### Plain English over shot jargon

| Say | Not |
| --- | --- |
| Close on Maya | Zoom |
| Both on screen | Split |
| Finding who's on camera | Face detection |
| Writing the transcript | Transcribing (ASR) |
| Lips match 91% of this clip | Confidence: uncertain |
| The processing service isn't answering | Connection failed |

The user never has to learn a vocabulary to use the tool — they learn it by using it.

### Errors

Four beats, always in this order: **what happened → why → what we did instead → how to change it.** No dead ends: every state has at least one way forward and one way out. The raw server message always sits in the mono well *beneath* the plain-English version, never instead of it, so it stays copy-pasteable into a GitHub issue.

> "The render stopped." → `ffmpeg: no space left on device` → "Your edits are safe. Free up space and run it again." → `Try again`

### Numbers are always specific

"About 6 minutes." "Turn 12 of 31." "3 to review." "6 found." "0 bytes leave your laptop." A vague reassurance is worse than a number that turns out to be a bit off.

### Casing, punctuation, person

- **Sentence case** for everything a person reads. The only uppercase is the mono micro-label (`WHAT COMES OUT`, `TALKING OVER`, `BETA`) and mono region labels (`CLOSE · MAYA`).
- **No exclamation marks. No emoji. Ever.**
- Mostly **"we"** for what the app did ("We guessed Dev") and **"you"** for the user's work ("4 you changed", "yours to rewrite"). Never "I".
- Em dashes and the middot `·` do a lot of work; the middot separates machine values (`24:18 · 31 turns · 4 you changed`).
- Contractions throughout — "it'll move on by itself", "you can't breathe".

### The local-first promise, and its one exception

The product says "nothing leaves your machine" repeatedly and concretely ("a 4 GB file doesn't cost you 4 GB of bandwidth"). Connecting a publish destination is the only exception in the entire product, so it is **stated out loud** rather than buried: "Connecting a destination is the only thing here that ever leaves your machine, and it asks first, every time."

### Be honest about what isn't built

Show notes and short clips appear on the publish screen **unchecked and honest**, not hidden. The marketing site carries a "What it can't do yet" table. This is the credibility block and the contributor funnel at the same time — do not cut it.

---

## Visual foundations

### Colour

Every value is authored in **OKLCH**. The palette is warm-neutral, not cold grey — cold grey reads as surveillance software.

Surfaces step in lightness rather than stacking shadows: `--bg` (0.15) → `--panel` (0.17) → `--chrome` (0.20) → `--raised` (0.22) → `--control` (0.26), with `--well` (0.11) below all of them for machine strings.

**Three rules that must survive any implementation:**

1. **The accent never flips.** `oklch(0.74 0.16 52)` amber with `oklch(0.20 0.02 60)` ink clears 7.5:1 on both grounds. It is the only colour meaning "the app is telling you something," and keeping it byte-identical is what makes the two themes read as one product. One accent action per screen.
2. **Speaker colours do flip.** At L 0.74 they are legible on black and invisible on white; light mode drops them to ~L 0.50 and keeps the hues. Within a theme they share identical lightness and chroma, so no participant reads as more important than another. The pane cap is 3.
3. **The video plate stays dark in both themes.** A light surround changes how a person judges exposure and skin tone. Light mode lifts it only enough not to look like a hole punched in the window.

Semantic colour beyond that: `--ok` for healthy/success, `--warn` + `--warn-bg` for overlaps and warnings, `--beta` for unfinished features, and a four-token region family for the timeline (`--region-wide` untouched, `--region-close` suggested, `--region-mine` user-edited, `--region-both` multi-person) each with its own ink token — `--region-mine-ink` exists precisely because `--region-mine` is light enough to need dark ink.

### Type

**Instrument Sans** (400/500/600) and **JetBrains Mono** (400/500). Two families, no third.

**The one rule that carries the whole system:** monospace is used *only* for something the machine measured — timecodes, file sizes, resolutions, filenames, percentages, shell commands, error strings. If a human wrote it, or a human is meant to feel it, it's Instrument Sans. **Never mono for prose.**

Display type is 48–52px at −0.035em and only appears on marketing. In-app titles are 18–19px/600 at −0.01em. Body is 13.5/22 on the selected transcript turn and 12.5/19 everywhere else. **11px is the floor for words**; anything smaller must be mono metadata.

### Spacing, radius, borders, elevation

- Spacing: `2, 4, 5, 6, 7, 9, 10, 11, 13, 14, 16, 18, 20, 22, 24, 26, 28, 34, 44, 52` — 4/8-ish with deliberate half steps at small sizes. **Lifted verbatim from the source. If a spec says 13px, write 13px.**
- Radius ladder: `3` chips and timeline regions · `5–6` buttons and inputs · `7–8` cards and plates · `9–11` panels and the app window · `17` app-icon container · `50%` avatars and speaker dots. Marketing surfaces run rounder: `10`.
- Borders: **always `1px solid var(--line)`.** Emphasis borders use the accent at 45% alpha (`--accent-edge`). The drag state is the only 2px border, and it comes with a `0 0 0 6px` accent ring at 12%.
- Elevation: **one shadow token, no scale.** `0 2px 16px rgba(0,0,0,.24)` dark / `.10` light. The marketing hero gets one softer variant.
- `box-sizing: border-box` globally. The timeline regions are percentage-width with padding and borders; without it they overflow their slots and drift out of register with the speaker lanes.

### Backgrounds and imagery

No photographs, no illustrations, no patterns, no textures, **no gradients** — with exactly one exception: the 135° two-tone `repeating-linear-gradient` that stands in for a video frame, a face thumbnail or a demo clip. Those are **placeholders, not assets**; each carries a mono caption in caps saying what belongs there. Face thumbs get a 2px ring in that person's speaker colour; the next unfound person is a dashed empty slot.

Imagery, when real footage lands, is whatever the user recorded — the plate tokens exist so the surround never colour-casts it.

### Motion

Almost none, on purpose — this is a tool for judging frames, and a moving UI competes with a moving picture.

- Progress bars: width transitions, `240ms linear`. Linear because it's a measurement.
- Hover/press on controls: `~90ms linear` background change only.
- No easing curves with personality, no bounces, no spring physics, no entrance animations, no skeleton shimmer, no spinners. Streaming transcript lines simply appear.
- The only "animated" thing in the marketing page is the demo video itself.

### States

- **Hover** — one step up the surface ladder (`--control` → lighter) or a small opacity lift on text links. Never a colour change of hue.
- **Press** — no scale transform. The surface goes one step darker.
- **Selected** — `--sel` ground plus a state-carrying 3px left rail (transcript turns) or a 2px speaker-coloured border (face candidates) or the `--accent-edge` border (artefact rows, destinations).
- **Disabled vs inert** — two different things. `disabled` is 50% opacity on something that *will* become clickable. `inert` is a full-opacity `--control` button with `--text-3` text ("Waiting…", "Rendering…") for when there is nothing correct to click.
- **Out-of-focus / pending** — opacity-based (55–75% on older transcript lines, 50% on pending stages, 60% on optional dependencies), so it reads as state rather than as a colour mistake. These are the two deliberate exceptions to the contrast floor.

### Transparency and blur

No blur anywhere. Transparency is used in exactly four places: accent alpha (45% borders, 12% rings, 9% washes), the warn chip background, the 55%-black timecode pill over a video frame, and the caption bar over a clip preview. Text is never alpha-muted — secondary and tertiary ink are their own solid tokens.

### Accessibility floor

All text meets **4.5:1** against its composited background (3:1 at headline scale), verified across every screen in the source. The two exceptions above are opacity-based and deliberate.

---

## Iconography

**Cutroom deliberately has almost no iconography, and adding an icon set would be a mistake.** There is no icon font, no sprite sheet, no Lucide/Heroicons dependency, and no PNG icons — none were present in the source, and none were added here.

What carries meaning instead:

- **Colour.** Speaker identity is a 7px coloured dot. Framing state is a region fill. Status is a filled/ringed circle.
- **Shape drawn in CSS.** The play triangle is a CSS border triangle inside a circle (`PlayButton`). The upload glyph in the drop zone is a 14×2.5px rounded bar. Checkmarks are the literal character `✓` in Instrument Sans 700. Traffic lights are three 11px circles.
- **The mark itself**, at its tiny rung, in the title bar.
- **No emoji, anywhere**, including in copy, commit-style labels and empty states.

If a future screen genuinely needs a glyph, add it as an `Icon` wrapper around a single SVG set with a **1.5px stroke and no fill**, matched to the 1px border weight — and record it here. Do not introduce a filled icon style.

### Intentional additions

Two components have no single counterpart in the source and were factored out of repeated markup rather than invented:

- **`Card`** — the source repeats one surface recipe (panel/raised ground, 1px `--line`, one shadow) across every screen; `Card` names it so nobody re-derives it.
- **`EdgeCaseCard`** — the eight edge cases in `7d` are the same four-beat card eight times. Making the pattern a component is what keeps the ninth one honest.

Everything else maps 1:1 to something drawn in the source files.

---

## Token names vs the handoff's names

The handoff table uses camelCase role names. The CSS uses kebab-case:

`bg → --bg` · `panel → --panel` · `chrome → --chrome` · `raised → --raised` · `control → --control` · `line → --line` · `text/text2/text3 → --text / --text-2 / --text-3` · `accent → --accent` · `onAccent → --on-accent` · `accentText → --accent-text` · `track → --track` · `rWide/rClose/rMine/rBoth → --region-wide / --region-close / --region-mine / --region-both` · `rInk/rMineInk → --region-ink / --region-mine-ink` · `handle → --handle` · `s1/s2/s3 → --speaker-1/2/3` · `plateA/plateB/plateInk → --plate-a / --plate-b / --plate-ink` · `ok → --ok` · `warn/warnBg → --warn / --warn-bg` · `sel → --sel` · `shadow → --shadow`

Added beyond the handoff, all derived from values already used inline in the source: `--well` (the `oklch(0.11 0.008 70)` command/error ground), `--accent-edge` / `--accent-wash` / `--accent-ring` (the 45% / 9% / 12% accent alphas), `--ok-done` (the completed-stage bar), `--ok-edge`, `--warn-edge`, `--beta` / `--beta-bg`, and the three traffic-light colours.

---

## State model (for implementers)

```ts
type Status =
  | 'checking'    // setup gate polling /health
  | 'idle'        // drop-in screen
  | 'processing'  // polling /progress/{job_id}
  | 'cast'        // voice-to-face confirmation
  | 'editing'     // the editor
  | 'publishing'  // publish manifest + render states
  | 'error'
```

- `theme: 'system' | 'light' | 'dark'` — persisted; `system` subscribes live to `matchMedia`.
- `regions: FramingRegion[]` — `{ id, startMs, endMs, layout, subjectIds[], source: 'suggested' | 'user' }`. **Not** a per-turn field. Regions are independent of turn boundaries and are the editor's source of truth; anything uncovered renders wide.
- `selectedTurnId` — drives transcript, preview and playhead from one selection.
- `flaggedTurnIds` — powers the "N to review" counter.
- Per-screen error state; `error` is a global route only for a fatal pipeline failure.

The live preview's crop maths, pane layout and 3-pane cap must match the render pipeline exactly. A preview that disagrees with the export is worse than no preview.

---

## Caveats

1. **No font binaries.** None were supplied. `tokens/fonts.css` loads Instrument Sans and JetBrains Mono from the Google Fonts CDN. Both are the correct families — this is a delivery substitution, not a typeface substitution. **For a local-first desktop app you must self-host them**; drop the `.woff2` files into `assets/fonts/` and replace the `@import` with `@font-face` rules.
2. **The mark was rebuilt, not supplied.** No logo file existed; the source drew it with absolutely-positioned divs. `assets/logo/*.svg` is that geometry converted to SVG (72×72 and 16×16 viewBoxes) and is the version to ship. It matches the source construction, but a designer should eyeball the curves at 72px before it goes on a release page.
3. **The reduction ladder and the source lockups disagree.** The handoff's written ladder drops the heads at 26–39px, but every mark actually *drawn* in the source keeps them down to 24px and jumps straight to tiny at 16–18px. `Logo` follows the drawn version — tiny at ≤20px, full above it — and keeps `version="mid"` available explicitly. `assets/logo/cutroom-mark-mid*.svg` ships the middle rung either way. Say which one is canonical and I'll make the other the exception.
4. **No real footage.** Every image is a striped placeholder. Send real frames, face crops and a demo loop and I'll drop them in.
5. **Not read from the codebase.** The upstream repo was not attached to this project, so components were built from the design files and the handoff spec, not from `src/`. If you connect the repo I can reconcile naming with the real `src/features/` components.
6. **Chapters and show-notes editors don't exist.** Both are reachable from the publish screen (`Review`, "yours to rewrite") and neither was drawn in the source. They are the obvious next design pass, along with the first-run walkthrough.

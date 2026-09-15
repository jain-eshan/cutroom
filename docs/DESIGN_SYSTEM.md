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
  `ExportButton`. Copy was brought in line with the handoff's "Voice & copy
  rules" where it was cheap to do (plain-English shot names — "Wide" /
  "Close-up" / "Both on screen", not "Original" / "Zoom" / "Split"; "Lips
  match N% of this clip" on the cast screen's confidence chip).

## Known, deliberate deviations

- **Drop zone border color** — the handoff gives one literal OKLCH value
  (`oklch(0.34 0.01 80)`), not a light/dark pair. Used the `line` token
  instead so it adapts across themes; the literal was almost certainly
  tuned against the handoff's dark screenshots and looks wrong in light
  mode otherwise.
- **No filename/size echo on drag-over** (`UploadScreen`) — the handoff
  wants the dragged file's name and size shown before the user releases it.
  Most browsers don't expose `DataTransferItem` file contents until
  `drop`, only on `dragover`, so this isn't implementable as specified
  without a different browser API or a fallback UX. Left for a follow-up
  investigation rather than faked.
- **Recents list** (`UploadScreen`, part of `7a`) — needs project
  persistence (`.cutroom` save/reopen) that doesn't exist yet. Not built.
- **Live transcript / faces-found evidence area** (`ProcessingScreen`,
  `2e`) — the handoff's evidence area streams transcript lines and face
  thumbnails as they're produced. `GET /progress/{job_id}` doesn't return
  that data today, only per-stage fractions. The current screen is a
  faithful visual reskin of the 4-stage progress view only.
- **Cast screen stayed one page** (`CastScreen`) — the handoff specifies
  `2f`, a one-voice-at-a-time confirmation flow, explicitly over `2g`
  (everything on one page — "faster on a re-run but a beginner will click
  through without listening"). The existing screen is architecturally
  closer to `2g`. Restyled in place rather than restructured, since the
  one-at-a-time flow is a real interaction change, not a reskin. **This is
  the one deviation worth revisiting soonest** — it's what the handoff
  flags as the highest-risk screen to get wrong.

## What's left

In the handoff's own implementation order (`docs/design/handoff/README.md`,
bottom section), unstarted items only:

1. ~~Token layer + theme switching~~ — **done**.
2. ~~Logo as SVG~~ — **done**.
3. **Setup gate** (`2d`) — a real screen, not built. Purely additive: a new
   `Status` member before `idle`, polling `GET /health` (already exists on
   the backend, see `server/main.py`). No backend changes needed.
4. **Processing evidence area** — see "Known deviations" above. Needs
   `/progress` to carry partial transcript lines and face thumbnails, so
   it's a backend change, not just frontend.
5. **Cast as one-question-at-a-time (`2f`)** — see "Known deviations."
   Frontend-only, but a real interaction rewrite of `CastScreen.tsx`.
6. **Editor: region-based framing (`5a`)** — the big one. Replaces
   "layout per turn" with draggable `FramingRegion[]` independent of turn
   boundaries (drag handles, a framing lane, `Reset to suggested`). This
   **also requires changing `server/pipeline/render.py`'s export logic** to
   consume regions instead of per-turn layout choices — the handoff is
   explicit that a preview which disagrees with the export is worse than no
   preview, so frontend and backend have to land together. Do not start
   this half-finished.
7. **Publish screen (`7b`) + render states (`7c`)** — the scope change:
   export becomes a manifest (episode / captions / chapters / show notes /
   show clips) rather than a single button. The current `ExportButton` is
   already visually styled to match the four render states (`idle` /
   `rendering` / `done` / `error`) from `7c`, so that half transfers
   directly into whatever wraps it. Show notes and short clips should ship
   **unchecked and honest**, not hidden — they're unbuilt.
8. **Edge-case sweep (`7d`)** — a pass across all screens once the above
   exist; several of these (e.g. "four people at once," "captions
   unavailable") already have partial backend support and just need the
   UI treatment.
9. **Landing page (`4b`)** — last, and explicitly gated: the handoff says
   not to ship real per-OS download buttons until desktop packaging exists
   ("Build from source" until then). Packaging itself isn't on this list
   because it's a backend/build-tooling project, not a design one — see
   `docs/STATUS.md`.

## Open question, not decided here

The product is now named **Cutroom** in the UI (title, favicon, in-app
wordmark). `package.json`'s `name` field and the GitHub repo are still
`podcast-editor` — renaming those is a bigger, more visible change
(breaks any existing clone URLs/bookmarks, npm name if ever published) and
wasn't made unilaterally. Worth an explicit decision before the landing page
phase, since marketing copy throughout the handoff assumes "Cutroom"
everywhere.

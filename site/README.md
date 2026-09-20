# Website

The public landing page for Cutroom. It's a separate small Vite + React app
that shares the app's design tokens (`src/index.css`) and logo
(`src/components/Logo.tsx`), so the site and the product always look like the
same thing. The layout follows the site kit in the Cutroom design system
(`ui_kits/site/` and `components/marketing/` in the Claude Design project),
which is the source of truth for anything visual.

It has nothing to do with running Cutroom itself. You only need this folder if
you're changing the website.

## Run it

From the repository root:

```bash
npm install
npm run site
```

Then open http://localhost:3461. It doesn't start the processing service.

To build the static files the way the host does:

```bash
npm run site:build
```

The output lands in `site/dist/`.

## What's where

| Path | What it is |
|---|---|
| `index.html` | Page title, description and social preview tags. |
| `src/Landing.tsx` | Every section of the page, top to bottom. Copy lives here. |
| `src/Scene.tsx` | The illustrated podcast set and the two demos built from it: the framing demo in the hero (`FramingDemo`) and the small auto-framing loop in "It cuts to whoever's talking" (`AutoFramingLoop`). Crops use the same proportions as `server/pipeline/framing.py`. See "The hero demo" below before changing or removing it. |
| `src/site.css` | Pulls in the app's tokens, plus the two marketing-only values the app doesn't need: the 10px marketing radius and the softer hero shadow. |
| `src/Waitlist.tsx` | The waitlist, an embedded [Tally](https://tally.so) form. |
| `public/shots/` | Screenshots of the app used on the page. |
| `public/og.png` | The image shown when the link is shared. |

## The waitlist

Sign-ups are collected by a Tally form, embedded in the page. To connect a
form, put its ID in `TALLY_FORM_ID` at the top of `src/Waitlist.tsx`. The ID
is the last part of the form's share link, `tally.so/r/<ID>`. Until an ID is
set, the section says the waitlist opens soon instead of showing an empty
form, which is also what you'll see when running the site locally.

The form's answers live in the maintainer's Tally account, not in this
repository.

## Deploying

The site is live at https://www.cutroom.in (also https://cutroom-ruddy.vercel.app), hosted on Vercel.
`vercel.json` in the repository root tells Vercel to install with `npm ci`,
build with `npm run site:build` and publish `site/dist`. Every push to `main`
redeploys it.

## The hero demo

The hero and the "It cuts to whoever's talking" block show an animated
illustration of a three-person podcast set being cut between wide shots,
close-ups and a two-person shot, with a timeline underneath. It is a
cartoon, not footage, and the page says so under the demo.

That is a **deliberate, temporary exception** to the design system's "no
illustrations" rule. History, so nobody has to rediscover it:

- 2026-09-15: built as the stand-in for a real demo clip, because a real
  clip needs everyone in it to agree to be published.
- 2026-09-19: removed by the move onto the design system's site kit, which
  has no illustrations and uses striped placeholders until footage exists.
  That left the two most visible spots on the live page as empty striped
  boxes captioned "DEMO LOOP · 30 S" and "LOOP · AUTO-FRAMING".
- 2026-09-20: put back, at the founder's call. The frames around it (the
  card, chips, timeline labels) use the current tokens; only the artwork
  itself is off-system.

**When to remove it:** as soon as there is real footage everyone in it has
agreed to publish. Cut it through Cutroom, record the editor playing it, and
replace `FramingDemo` and `AutoFramingLoop` with that. Then delete
`Scene.tsx`, drop this exception from `docs/DESIGN_SYSTEM.md`, and restore the
"no illustrations" bullet below to its plain form.

The screenshots in `public/shots/` are the real app on sample data, with the
same illustrated set as the picture so the page tells one story. They were
retaken on 2026-09-20 from the redesigned app (dark theme, the current
editor and cast screens); the older ones showed the pre-redesign look. They
go stale whenever those screens change, so retake them after any visible
change to the editor or the cast screen. The recipe: run the app's
`?fixture` mode, use a conversation where every line earns its own shot (so
each reason line under the transcript is true), drop the illustrated frame
into the picture, and capture at 1400×875 (the cast screen from a 1000×625
window at 1.4× scale).

## Writing rules

The page follows the design system's `readme.md` (summarised in
[docs/design/handoff/README.md](../docs/design/handoff/README.md)):

- Light theme only. The app follows the OS; the website doesn't.
- One amber accent button per screen. On this page that's "Join the
  waitlist" in the hero. Downloads use the dark button, everything else the
  quiet one.
- No illustrations, icons, blur or gradients, with one temporary exception:
  the illustrated demo in `Scene.tsx` (see "The hero demo" below). Everything
  else on the page follows the rule. Where footage would go and there is
  none, the design's answer is the 135° striped placeholder with a mono
  caption saying what goes there.
- Headline 48px on phones, 52px from 640px up, at −0.035em. Section titles
  25px. Marketing surfaces use the 10px radius.
- Monospace only for things a machine measured: the numbers row, commands,
  placeholder captions.
- Plain words. "Close on Maya", not "zoom". Never "AI" or "magic", no emoji,
  no exclamation marks.
- Keep the "What it can't do yet" table. It's the credibility block and where
  contributors start.
- Every number on the page has to come from a measurement in
  [docs/STATUS.md](../docs/STATUS.md).

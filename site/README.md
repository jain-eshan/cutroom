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

The site is live at https://cutroom-ruddy.vercel.app, hosted on Vercel.
`vercel.json` in the repository root tells Vercel to install with `npm ci`,
build with `npm run site:build` and publish `site/dist`. Every push to `main`
redeploys it.

## Writing rules

The page follows the design system's `readme.md` (summarised in
[docs/design/handoff/README.md](../docs/design/handoff/README.md)):

- Light theme only. The app follows the OS; the website doesn't.
- One amber accent button per screen. On this page that's "Join the
  waitlist" in the hero. Downloads use the dark button, everything else the
  quiet one.
- No illustrations, icons, blur or gradients. Until a real demo clip is
  recorded, the hero and the first feature show the 135° striped placeholder
  with a mono caption saying what goes there. Swap in the real footage when it
  exists; the app screenshots in `public/shots/` are real and stay.
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

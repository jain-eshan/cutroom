# Website

The public landing page for Cutroom. It's a separate small Vite + React app
that shares the app's design tokens (`src/index.css`) and logo
(`src/components/Logo.tsx`), so the site and the product always look like the
same thing.

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
| `src/Scene.tsx` | The illustrated podcast set and the animated framing demo in the hero. The crops use the same proportions as `server/pipeline/framing.py`. |
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

The page follows the same rules as the app (see
[docs/design/handoff/README.md](../docs/design/handoff/README.md)):

- Light theme only. The app follows the OS; the website doesn't.
- Monospace only for things a machine measured: timecodes, numbers, commands.
- Plain words. "Close on Maya", not "zoom". Say what it can't do yet.
- Every number on the page has to come from a measurement in
  [docs/STATUS.md](../docs/STATUS.md).

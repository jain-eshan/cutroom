# Contributing to Cutroom

Thanks for looking. Cutroom is a free, local tool that edits one-camera
podcast video: it works out who's talking from the recording itself and
frames the shot on them. It's in developer preview, built so far by one
person, and there's plenty of real work left.

This guide covers where help is most useful, how to get the code running, how
the repository is laid out, the rules that keep the product correct, and how
to send a change.

## Where help is most useful right now

1. **Better automatic framing.** The edit cuts to people who only say "yeah",
   and flashes the wide shot at every pause. The rules that should replace
   today's logic, the 45 situations they need to handle, and a suggested build
   order are in [docs/EDGE_CASES.md](docs/EDGE_CASES.md). Most of it is pure
   TypeScript in one function, with tests, and needs no machine-learning
   background.
2. **Windows and Linux.** Only macOS on Apple silicon has been tried. Getting
   it running elsewhere, and writing down what broke, is very useful.
3. **Reports of edits it got wrong.** Use the "The edit got it wrong" issue
   form. Timestamps and a description are enough; please don't share footage
   of people who haven't agreed to it.
4. **Anything on the roadmap** in [docs/STATUS.md](docs/STATUS.md), such as
   saving episodes so closing the window doesn't lose work.

For anything bigger than a small fix, open an issue first and say what you
plan to do. Some product questions are still open (they're listed at the end
of [docs/EDGE_CASES.md](docs/EDGE_CASES.md)), and it's better to agree on the
direction before you spend a weekend on it.

## Getting it running

You need:

- **macOS on Apple silicon** for now (it's the only setup tested; help with
  others is welcome)
- **Node.js 22.18 or newer.** `npm test` runs TypeScript directly with Node's
  own test runner, which needs 22.18.
- **[uv](https://docs.astral.sh/uv/)**, which installs Python 3.12 and the
  service's packages for you
- **ffmpeg** on your `PATH` (`brew install ffmpeg`)

Then:

```bash
git clone https://github.com/jain-eshan/cutroom.git
cd cutroom
npm install
npm run dev
```

Open http://localhost:3460. `npm run dev` starts both the app and the local
processing service, and the setup screen waits for them and then moves on by
itself — there's no account to make and nothing to paste in. The
[README](README.md) has the full first-run walkthrough and a troubleshooting
section.

You don't need a real recording to work on most of the app: see
[Testing without real footage](#testing-without-real-footage).

## How the repository is laid out

Cutroom is two programs that talk over HTTP on your own machine, plus a
website.

```
src/                    The app: React 19, TypeScript, Tailwind CSS v4, Vite
  App.tsx               The screen-by-screen state machine (setup → drop-in →
                        processing → cast → editor → publish)
  features/
    setup/              Setup screen: waits for the service and the models
    upload/             Drop-in screen, processing progress, failure screen
    faces/              Naming the cast, one voice at a time
    timeline/           The editor
      EditorView.tsx    Transcript, preview, keyboard shortcuts, undo
      TimelineTray.tsx  Overview strip, ruler, framing lane, speaker lanes
      regions.ts        Suggested shots and shot edits (mirrors render.py)
      timelineView.ts   Zoom, ruler and snapping maths (unit tested)
    publish/            Export options and render states
  lib/api.ts            Every call to the processing service, and its types
  lib/faceCrop.ts       Crop maths for the preview (mirrors framing.py)
  index.css             Design tokens: colours, fonts, radii, light and dark

server/                 The processing service: Python 3.12, FastAPI, uv
  main.py               The HTTP API (/health, /process, /progress, /export…)
  pipeline/
    audio.py            Pulls a 16 kHz mono wav out of the recording
    transcribe.py       faster-whisper: transcript with word timings
    diarize.py          pyannote community-1: who speaks when, and overlaps
    turns.py            Words + speakers → transcript lines
    faces.py            YuNet detection, tracking, SFace recognition, clustering
    lipsync.py          LR-ASD: whose lips move with the audio
    fuse.py             Matches voices to faces (Hungarian matching)
    framing.py          How a person is cropped (measured from real edits)
    render.py           Shots → an ffmpeg filter graph → the MP4
    captions.py         Burned-in captions from word timings
    trim.py             Dead air and filler-word cutting
    progress.py         Per-stage progress for the processing screen
  tests/                pytest suite

site/                   The website (a separate small Vite app), see site/README.md
docs/                   Product, status, architecture, edge cases, design handoff
.github/                CI, issue forms, pull request template
```

A recording goes through the service like this: `/process` extracts audio,
then runs transcription and speaker detection alongside face detection, then
lip-sync, then matching. The app shows progress by polling `/progress`. After
the cast is confirmed, `regions.ts` suggests shots, the editor changes them,
and `/export` hands the shots to `render.py`. Details, including every
dependency and why it's there, are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Rules that keep the product correct

Some of these look like style preferences. They aren't: each one exists
because breaking it produced a real bug.

**The preview must match the export.** The editor's preview and the renderer
are written in two languages, and they have to agree exactly, or people will
approve an edit they don't get. Two pairs must always change together:

| Frontend | Backend | What they share |
|---|---|---|
| `src/features/timeline/regions.ts` (`resolveFraming`) | `server/pipeline/render.py` (`build_render_segments`) | Which shot is on screen at each moment |
| `src/lib/faceCrop.ts` | `server/pipeline/framing.py` | How a person is cropped |

If you change one side, change the other in the same pull request and say so.

**Framing is shots on a timeline, not a layout per transcript line.** A shot
(a "region" in the code) can start partway through a line and run through
several. Anything no shot covers is the wide shot. Don't reintroduce per-turn
layouts.

**Recordings never leave the machine.** No uploads, no analytics, no cloud
APIs. The only network calls are one-time model downloads and, in a packaged
build, the update check.

**Numbers must be measured.** Framing proportions, thresholds and claims in
the docs or on the website come from measurements on real recordings, noted
where they're used. If you tune a number, say what you measured.

**Words on screen are plain.** "Close on Maya", not "zoom". "Both on screen",
not "split". Error messages say what broke and what to do, with the technical
detail underneath. The full copy and design rules are in
[docs/design/handoff/README.md](docs/design/handoff/README.md), and how they
were applied is in [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md). In short:
use the tokens in `src/index.css` rather than raw colours, and use monospace
only for things a machine measured (timecodes, sizes, commands).

**No new dependency without a reason.** Check whether the standard library,
the platform, or a package already installed does the job. If you add one,
add a line for it to the dependency table in `docs/ARCHITECTURE.md`.

## Checks

Run these before sending a change. CI runs the same ones on every pull
request.

```bash
npx tsc -b                          # typecheck the app, website and configs
npm run lint                        # oxlint
npm test                            # frontend unit tests
npm run build                       # build the app
npm run site:build                  # build the website
uv run --directory server pytest    # processing service tests
```

The backend tests need no network, model weights, ffmpeg or GPU, so they run
anywhere.

### Writing tests

- **Frontend:** tests sit next to the code as `*.test.ts` and use Node's
  built-in `node:test` and `node:assert`. There's no test library. This works
  for pure modules with no React, like `timelineView.ts`. One catch: Node
  can't follow the `@/` import shortcut, so a module you want to test directly
  should import with relative paths, or the shortcut needs sorting out first
  (the next module waiting for tests is `regions.ts`).
- **Backend:** `server/tests/`, one file per pipeline module, plain pytest.
  Stand in for models and outside services rather than downloading anything.
- **Bug fixes:** add a test that fails without the fix.

### Testing without real footage

Most of the editor can be checked with a made-up clip. ffmpeg can generate
one:

```bash
ffmpeg -f lavfi -i "color=c=0x223344:s=1280x720:d=120:r=5" \
  -f lavfi -i "anullsrc=r=16000:cl=mono" -t 120 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac test-clip.mp4
```

A clip like this has no faces or speech, so processing will stop at the "no
faces" screen, which is itself a path worth testing. To work on the editor
with realistic data, a common approach is a short temporary block in
`App.tsx` that sets the `editing` state with invented transcript lines and
face positions, then removing it before committing. For anything about the
quality of the edit, nothing replaces a real multi-person recording.

## Code style

- **Indentation:** tabs, in TypeScript and Python alike.
- **Comments explain why,** not what. If a value or a branch exists because of
  a measurement or a past bug, say so where it lives.
- **Match what's around you.** Keep changes focused: don't reformat or
  refactor code your change doesn't need.
- **TypeScript** is strict, with `noUnusedLocals` and `noUnusedParameters` on.
- **Python** uses type hints and dataclasses, like the existing modules.

## Sending a change

1. Fork the repository and create a branch from `main`.
2. Make the change, with tests and any doc updates it needs. If behaviour
   changed, update `docs/STATUS.md`, `docs/FEATURES.md` or
   `docs/EDGE_CASES.md` as appropriate.
3. Run the checks above.
4. Commit with a short prefix: `feat:`, `fix:`, `docs:`, `test:` or
   `refactor:`, then what changed, in plain words. The body says why.
5. Open a pull request and fill in the template. For UI changes, include a
   screenshot.

Small, focused pull requests get reviewed fastest. If a review asks for
changes, push more commits to the same branch.

## Reporting problems

- **Bugs:** the "Something broke" issue form.
- **A bad edit:** the "The edit got it wrong" form.
- **Ideas:** the "An idea" form. Start with the problem.
- **Security problems:** privately, as described in [SECURITY.md](SECURITY.md).

## Licence

Cutroom is MIT licensed. By contributing, you agree that your contribution is
released under the same licence.

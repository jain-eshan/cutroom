# Podcast Editor

Open-source, auto-editing tool for podcast video. Upload a single-camera
recording (one frame, multiple speakers, one mixed audio track) and it
transcribes it, splits it into speaker turns, and suggests zoom / split-screen
framing for each turn — fully editable before export.

Not a screen recorder or capture tool. Post-production only: bring your own
recording, this handles the edit.

📖 **[Status](docs/STATUS.md)** — what works, what's measured, what's left.
**[Full documentation](docs/ARCHITECTURE.md)** — the plan, architecture,
every dependency and why, setup, and limitations.

**Docs map:** [Product](docs/PRODUCT.md) (what this is, who it's for) ·
[Features](docs/FEATURES.md) (every feature, status, where it's implemented) ·
[Market research](docs/MARKET_RESEARCH.md) (competitive landscape) ·
[Business model](docs/BUSINESS_MODEL.md) (why it's free, and stays that way) ·
[Architecture](docs/ARCHITECTURE.md) (system design, API, dependencies) ·
[Technical architecture](docs/TECHNICAL_ARCHITECTURE.md) (export/render
pipeline design) · [UX PRD](docs/UX_PRD.md) (UI requirements, Phase 4) ·
[Status](docs/STATUS.md) (current state, measured results, what's next) ·
[Edge cases](docs/EDGE_CASES.md) (framing rules and known edge cases)

## Status

**Working end-to-end, including real export:** upload a recording (with live
progress) → the local service transcribes it, diarizes speakers on the mixed
track, *recognises* the distinct people on screen, and matches each voice to
a face automatically via lip-sync → you name everyone once and confirm the
matches, with the uncertain ones flagged → the editor shows turns with real
names, a live preview using the same framing maths as the export, and a
framing timeline you can zoom, scrub, drag, snap and undo → Export renders
an actual MP4 with medium-shot framing, multi-person composites, source
resolution preserved, the original audio stream-copied, and optional
burned-in captions.

Annotations remain a stub. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full picture and [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md)
/ [docs/UX_PRD.md](docs/UX_PRD.md) for the export phase's design.

See [server/README.md](server/README.md) for how diarization and face
tracking work and their current accuracy limits.

## How it works

1. **Transcript + timestamps** (done) — Whisper transcription, plus speaker
   diarization on the mixed audio track (`pyannote` community-1, needs a free
   Hugging Face token), giving speaker-labeled, timestamped dialogue turns.
   No speaker count is forced. Stretches where two people talk at once come
   out of the same pass.
2. **Face recognition + automatic casting** (done) — detects faces (OpenCV
   YuNet), tracks them, then embeds and clusters them (SFace + DBSCAN) so one
   person is one person rather than one entry per head-turn. A lip-sync model
   (LR-ASD) then works out which face is speaking when, and each voice is
   matched to a face by how much the two coincide. You name everyone once and
   confirm the matches — the uncertain ones are flagged. From then on framing
   is automatic, and any turn it gets wrong is a one-click fix.
3. **Auto-framing** (done) — Original, Zoom, and a real multi-speaker
   composite (up to 3 people, tiled side by side within the 16:9 frame) are
   all live previews per turn, computed from the real detected face
   positions and kept in sync with playback.
4. **Editor** (done) — timeline of turns with layout override. Export
   renders the same decisions into a real MP4 via `ffmpeg`, re-encoded at a
   quality target high enough not to visibly degrade 4K source footage.
   Text/bubble annotations remain a stub.
5. **Stretch** (not started) — voice ducking for overlapping speech (a
   genuinely open research question, not scoped yet), multi-camera-angle
   support, desktop packaging.

Processing (transcription, diarization, face tracking, export rendering)
runs in a local service on your machine — nothing is uploaded anywhere.

## Stack

- React + Vite + TypeScript + Tailwind (frontend)
- Python + FastAPI local processing service (`server/`) — `faster-whisper`
  for transcription, `pyannote.audio` community-1 for speaker diarization,
  OpenCV (YuNet + SFace) for face detection and recognition, LR-ASD for
  lip-sync, `ffmpeg` for the export render pipeline

The diarization model needs a free Hugging Face token: create one at
[huggingface.co/settings/tokens](https://huggingface.co/settings/tokens),
accept the licence for
[community-1](https://huggingface.co/pyannote/speaker-diarization-community-1),
then put `HF_TOKEN=...` in `server/.env`.

## Setup

Needs Node, [uv](https://docs.astral.sh/uv/), and `ffmpeg` on your PATH.

Speaker detection needs a free Hugging Face token, set once. Create a read
token at https://huggingface.co/settings/tokens and accept the model licence
at https://huggingface.co/pyannote/speaker-diarization-community-1 with the
same account, then paste the token into the app's setup screen. It checks the
token with Hugging Face — licence included — and saves it to `server/.env`
for you, with no restart. (Setting `HF_TOKEN=` in `server/.env` yourself still
works.)

Burned-in captions need an `ffmpeg` built with libass. Homebrew's regular
`ffmpeg` formula is not — `brew install ffmpeg-full` is, and because that
formula is keg-only it does not replace your existing ffmpeg. Point the
server at it in `server/.env`:

```
FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
```

Everything else works on either build, and the export says so up front rather
than dropping the captions silently.

```bash
npm install
npm run dev
```

That's the whole start. `npm run dev` also starts the processing service and
stops it when you quit, so there's no second terminal. The first start installs
the service's Python dependencies, which takes a few minutes; the setup screen
shows it working and moves on by itself. (To run the service on its own, see
`server/README.md`.)

To run the tests, `npm test` covers the timeline maths and
`uv run --directory server pytest` covers the processing service.

## License

MIT.

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

## Status

**Working end-to-end, including real export:** upload a recording (with live
progress) → the local service transcribes it, diarizes speakers on the mixed
track, and *recognises* the distinct people on screen → you name everyone
once and match each voice to a person by ear → the editor shows turns with
real names, a live preview using the same framing maths as the export,
per-turn layout override and per-turn correction of who's on screen →
Export renders an actual MP4 with medium-shot framing, multi-person
composites, source resolution preserved and the original audio
stream-copied.

Annotations remain a stub. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full picture and [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md)
/ [docs/UX_PRD.md](docs/UX_PRD.md) for the export phase's design.

See [server/README.md](server/README.md) for how diarization and face
tracking work and their current accuracy limits.

## How it works

1. **Transcript + timestamps** (done) — Whisper transcription + speaker
   diarization on the mixed audio track, giving speaker-labeled, timestamped
   dialogue turns. Optional overlap detection (`pyannote.audio`, needs a
   Hugging Face token) finds stretches where two people talk at once.
2. **Face recognition + one-time cast setup** (done) — detects faces (OpenCV
   YuNet), tracks them, then embeds and clusters them (SFace + DBSCAN) so one
   person is one person rather than one entry per head-turn. You name everyone
   once and say which voice is whose. From then on, framing is automatic, and
   any turn it gets wrong is a one-click fix.
3. **Auto-framing** (done) — Original, Zoom, and a real multi-speaker
   composite (up to 3 people, tiled side by side within the 16:9 frame) are
   all live previews per turn, computed from the real detected face
   positions and kept in sync with playback.
4. **Editor** (done) — timeline of turns with layout override. Export
   renders the same decisions into a real MP4 via `ffmpeg`, re-encoded at a
   quality target high enough not to visibly degrade 4K source footage.
   Text/bubble annotations remain a stub.
5. **Stretch** (not started) — automatic speaker-to-face matching (skip the
   manual labeling step), voice ducking for overlapping speech (a genuinely
   open research question, not scoped yet), multi-camera-angle support,
   desktop packaging.

Processing (transcription, diarization, face tracking, export rendering)
runs in a local service on your machine — nothing is uploaded anywhere.

## Stack

- React + Vite + TypeScript + Tailwind (frontend)
- Python + FastAPI local processing service (`server/`) — `faster-whisper`
  for transcription, `resemblyzer` for speaker diarization, `pyannote.audio`
  for optional overlap detection, OpenCV (YuNet) for face detection/tracking,
  `ffmpeg` for the export render pipeline

## Setup

Needs Node, [uv](https://docs.astral.sh/uv/), and `ffmpeg` on your PATH.

```bash
# frontend
npm install
npm run dev

# processing service (separate terminal — see server/README.md)
cd server
uv sync
uv run uvicorn main:app --port 8787
```

## License

MIT.

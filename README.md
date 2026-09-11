# Podcast Editor

Open-source, auto-editing tool for podcast video. Upload a single-camera
recording (one frame, multiple speakers, one mixed audio track) and it
transcribes it, splits it into speaker turns, and suggests zoom / split-screen
framing for each turn — fully editable before export.

Not a screen recorder or capture tool. Post-production only: bring your own
recording, this handles the edit.

📖 **[Full documentation](docs/ARCHITECTURE.md)** — the plan, what's built,
architecture, every dependency and why, setup, limitations, and roadmap, all
in one place.

## Status

**Working end-to-end:** upload a video → local service transcribes it,
diarizes speakers on the mixed track, and detects/tracks faces → you do a
one-time face-to-speaker labeling step → editor shows turns with a live
zoom-to-speaker preview, per-turn layout override (Original / Zoom / Split),
and a stub Annotation/Export UI marking what's not built yet.

Split-screen (visual) and annotations/export (functional) are intentionally
stubbed — see "How it works" below for what's real vs. placeholder.

See [server/README.md](server/README.md) for how diarization and face
tracking work and their current accuracy limits.

## How it works

1. **Transcript + timestamps** (done) — Whisper transcription + speaker
   diarization on the mixed audio track, giving speaker-labeled, timestamped
   dialogue turns.
2. **Face detection + one-time speaker labeling** (done) — the tool detects
   and tracks faces in frame (OpenCV YuNet + greedy IOU tracking); you label
   each one once per episode. From then on, zoom-to-speaker framing is
   automatic.
3. **Auto-framing** (partial) — Original and Zoom layouts are live CSS
   previews per turn, computed from the real detected face position. Split
   (showing two speakers at once) is a placeholder — needs a real
   compositor, not just CSS, to show two different crops of one video
   simultaneously.
4. **Editor** (scaffolded) — timeline of turns with layout override, done.
   Text/bubble annotations and export (burning the layout choices into an
   actual output file) are stubbed — both need the render/compositor
   pipeline, which is unbuilt.
5. **Stretch** (not started) — automatic speaker-to-face matching (skip the
   manual labeling step), multi-camera-angle support, desktop packaging.

Processing (transcription, diarization, face tracking) runs in a local
service on your machine — nothing is uploaded anywhere.

## Stack

- React + Vite + TypeScript + Tailwind (frontend)
- Python + FastAPI local processing service (`server/`) — `faster-whisper`
  for transcription, `resemblyzer` for speaker diarization, OpenCV (YuNet)
  for face detection/tracking; the render/export compositor is unbuilt

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

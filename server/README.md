# Local processing service

Runs transcription, speaker diarization, turn-segmentation, and face
detection/tracking. The web app talks to this on `localhost:8787`. Nothing
leaves the machine.

## How diarization works here

There's no per-speaker audio to lean on (single camera, one mixed track), so
this diarizes by voice: it embeds sliding windows of the audio and clusters
them by voice similarity (via `resemblyzer`), then merges consecutive
same-cluster windows into speaker segments. Those get matched up against
Whisper's word-level timestamps (`faster-whisper`) to build dialogue turns.

This is audio-only — it doesn't know *which face* is speaking. See below for
how that gets connected.

Turn boundaries right at a speaker change can be off by a word or so — an
accuracy ceiling of window-based clustering, not a bug. Good enough to build
the editor UI against; can be tightened later (e.g. boundary refinement, or
an upgrade path to `pyannote.audio` for higher accuracy — see below).

## How face detection/tracking works here

`pipeline/faces.py` samples frames from the video (default: 1/sec), runs a
face detector on each (OpenCV's YuNet — light, no GPU dependency, no gated
model download), and links detections across frames into persistent tracks
via greedy IOU matching: a detection in frame N matches an existing track if
its box overlaps that track's last-seen box enough, otherwise it starts a
new track. A track closes out if unmatched for more than a few seconds
(handles someone leaving frame without merging them into whoever enters
later).

This gives face *tracks*, not face *identities* tied to the diarized
speakers — that link is the one-time manual labeling step in the UI (you
tell it which detected face is "Speaker 1", etc.). No face-recognition model
involved, deliberately — it's more moving parts for a problem a 30-second
one-time click solves per episode.

Tried `mediapipe` first; its Tasks API hard-crashes on this macOS setup with
a native `DrishtiMetalHelper`/GPU-graph error unrelated to our code, even
forcing the CPU delegate. Switched to OpenCV YuNet, which has no such issue.
Also note: `opencv-python-headless` resolved to a `5.0.0.93` pre-release by
default with a broken DNN backend (silently returned zero detections) —
pinned to `opencv-python-headless>=4.9,<5` in `pyproject.toml`.

## Setup

Needs [uv](https://docs.astral.sh/uv/) and `ffmpeg` on your PATH.

```bash
cd server
uv sync
uv run uvicorn main:app --port 8787
```

First run downloads the Whisper model (`small` by default, ~500MB) and the
voice-embedding model (small, bundled via `resemblyzer`) — both public, no
account needed.

## Optional: higher-accuracy diarization

`pyannote.audio` is generally more accurate than the resemblyzer-based
approach here, but its models are gated on HuggingFace (you'd need a free HF
account, to accept the model license, and an access token). Not wired up
yet — worth revisiting if diarization accuracy becomes the bottleneck.

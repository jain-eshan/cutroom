# Local processing service

Runs transcription, speaker diarization, turn-segmentation, and face
detection/tracking. The web app talks to this on `localhost:8787`. Nothing
leaves the machine.

## How diarization works here

There's no per-speaker audio to lean on (single camera, one mixed track), so
this diarizes by voice: `pipeline/diarize.py` runs `pyannote`'s
**community-1** model (CC-BY-4.0) on the extracted wav, which is overlap-aware
in a single pass — two people talking at once show up as two segments
covering the same instant, not a separate detector to cross-reference. No
speaker count is forced; passing one was measured to invent speakers (see
[STATUS.md](../docs/STATUS.md)). Those segments get matched up against
Whisper's word-level timestamps (`faster-whisper`) to build dialogue turns.

This is audio-only — it doesn't know *which face* is speaking. See below for
how that gets connected.

**Bundled, and no fallback.** community-1 replaced `resemblyzer`, which was
measured finding two speakers on a real four-person episode — a fallback that
produces a quietly wrong edit is worse than an error that says what to do.
The weights live in `server/.models/diarization/` (six files, 31MB), so
nothing is downloaded and no account is involved; they used to come from a
gated Hugging Face repo, which is why this service once needed `HF_TOKEN`.
That variable is no longer read anywhere, and one left over in an existing
`server/.env` is ignored. `/process` still returns a 400 if the weights
aren't on disk, which now means a damaged install rather than a missing step.
Runs on GPU (MPS) when available — measured 53s vs 398s on CPU for the same
10-minute slice, byte-identical output either way.

Turn boundaries right at a speaker change can still be off by a word or so.
Per-turn correction in the editor exists for this.

## How face detection/tracking works here

`pipeline/faces.py` samples frames from the video (default: 1/sec), runs a
face detector on each (OpenCV's YuNet — light, no GPU dependency, no gated
model download), and links detections across frames into persistent tracks
via greedy IOU matching: a detection in frame N matches an existing track if
its box overlaps that track's last-seen box enough, otherwise it starts a
new track. A track closes out if unmatched for more than a few seconds
(handles someone leaving frame without merging them into whoever enters
later).

Tracks then get collapsed into *people*: each track is embedded with
`cv2.FaceRecognizerSF` (SFace, ships inside `opencv-python-headless`) and
clustered by cosine distance (measured 0.66-0.91 between four real
participants), so fragments of the same person — a head turn, a hand over
the face — merge into one identity instead of staying separate tracks. A
"person" seen in too few sampled frames is dropped as junk (the threshold
scales with episode length; see `faces.py`).

That still isn't the same as knowing which person is *talking* — linking a
face to a voice is what `lipsync.py` and `fuse.py` do, below.

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

First run downloads the Whisper model (`small` by default, ~500MB), the
SFace face-recognition weights (~38MB), and the LR-ASD lip-sync weights
(~3.3MB) — all public, no account needed. The diarization model
(`pyannote` community-1) isn't downloaded at all: it's committed to the repo,
see above.

## Overlap detection

Shipped, not optional. community-1's diarisation pass is overlap-aware, so
two people talking at once show up directly as two segments covering the
same instant — there's no separate overlap model to configure or fail.
Measured on a 10-minute slice: 10 overlaps totalling 2.65s, every one
between 0.02s and 0.56s (interjections, not long enough to cut a composite
for on that episode).

This replaced an actual `pyannote.audio` 4.0.7 pipeline
(`pyannote/overlapped-speech-detection`) that was non-functional — its
config pointed at an `OverlappedSpeechDetection` pipeline class pyannote 4
had removed, so it raised on load and `/process` silently returned an empty
`overlapWindows` list. community-1 folding overlap into the main diarisation
pass made that separate, broken pipeline unnecessary rather than something
to fix.

## Lip-sync and voice-to-face matching

Diarization says *when* a voice talks; it has no idea whose face that is.
`pipeline/lipsync.py` runs an LR-ASD model (MIT, AVA weights, downloaded to
`pipeline/lrasd/` on first use) against each detected face, scoring how well
its mouth movement matches the audio in sliding windows — per second, which
face is most likely talking. `pipeline/fuse.py` then does Hungarian matching
between diarization's voices and lip-sync's per-second "who's on screen
talking" to assign each voice to a person, using each signal to catch the
other's mistake (one voice landing on two faces means diarization merged two
people; two voices landing on one face means it split someone in half).

The cast screen starts pre-filled with these matches; the user confirms them,
with low-confidence ones flagged rather than guessed at silently. Measured
end to end on a 3-minute clip: 97-100% agreement with a human-verified
benchmark, ~80s total including transcription, diarisation, faces, lip-sync,
and matching (see [STATUS.md](../docs/STATUS.md)).

## Captions

`pipeline/captions.py` cuts caption cues from Whisper's word-level
timestamps, not turn boundaries, so a cue starts and ends when speech
actually does. `/export` burns them in via ffmpeg's `ass`/libass filter when
`captions=true` is passed. This needs an ffmpeg built with libass — Homebrew's
default `ffmpeg` formula doesn't have it, `ffmpeg-full` does — see the root
[README.md](../README.md) for the `FFMPEG_BINARY` setup. Without it,
`/export` refuses the job up front with that instruction rather than
rendering 15 minutes of video with no captions on it.

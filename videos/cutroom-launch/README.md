# Cutroom launch film

A 61.5-second, 1920×1080 demo for the Product Hunt (26 November 2026) and LinkedIn launch, published at [youtu.be/Y2J9pnHOykg](https://youtu.be/Y2J9pnHOykg) and used on eshanjain.com's Work card and case study. It is cut from real screen recordings of Cutroom (`main` after v0.3.2, the code that became v0.4.0) processing and editing The Founders' Podcast, Episode 1, which everyone in it agreed to publish. Built with [HyperFrames](https://hyperframes.heygen.com), the same way as the Lumen launch film.

## The story

| Beat | Time | On screen | Problem it answers |
|---|---|---|---|
| Hook | 0-15 s | The real wide shot, a hand-cut timeline, "what auto-editors expect" vs "what you have" | One camera and one mixed track means cutting by hand, and auto-editors assume a mic and camera per person |
| Meet | 15-18.5 s | The mark, "Cutroom", "Podcast video that cuts itself." | |
| 1 | 18.6-24.2 s | Drop zone, then processing: sending, transcript, faces | Getting started needs nothing else |
| 2 | 24.2-29.4 s | Cast screen matching a voice to a face, then the editor cutting from the guest to Person 4 | Who's talking, from voice and lips |
| 3 | 29.4-35.8 s | Framing mode, Trim dead air, zoomed timeline | Every automatic decision can be changed |
| 4 | 35.8-42 s | Render and publish with the subtitle file and MP3 ticked | Full-resolution MP4 plus the extras |
| Result | 42.2-47.8 s | Five seconds of Cutroom's own render, with the episode's sound | Proof |
| Close | 47.8-61.5 s | "53 min → 15 min", privacy badges, open source, cutroom.in | |

The "15 min" figure is the measurement in the case study and `docs/STATUS.md`, not the filmed run, which shared the machine with another render.

## Narration

Kokoro `af_heart`, generated locally (no paid voice). One file per line, from `tools/lines.txt`; word times from whisper (`small.en`) in `assets/vo/lNN.words.json`. Captions use the script's own spelling at whisper's times, so a mishearing never reaches the screen.

## How the footage was made

- `tools/record_upload.py` (take 1) drives Chrome with Playwright at 1440×1000: the drop, then processing. The take was stopped after five minutes of processing; only its first minute is used.
- `tools/record_editor.py` (take 2) reopens the processed episode, confirms the cast, plays a stretch with an automatic cut, changes the framing mode and dead-air trim, resets to Cutroom's suggestions and starts the export.
- The result clip: the full export finished, but the browser never handed the 53-minute file over. `tools/render_window.py` re-renders 22:05-22:25 with Cutroom's own `build_render_segments` and `render_export`, from the exact shot list the real export logged in `server/logs/<job>/decisions.jsonl` (every region `"source": "suggested"`). Run it with the server's Python and `PYTHONPATH=server`.

## Files

- `index.html`: the composition. `tools/build.py` writes clip, narration and caption timings into it from `tools/timing.json`.
- `tools/build.py`: cuts and crops the clips from `raw/`, mixes narration, the episode's audio, music and sound effects (music ducked under speech, -14 LUFS), and injects the timeline.
- `tools/timing.json`: where every narration line and clip sits, the result window and its captions.

Not in git (see `.gitignore`): `raw/` (the recordings, the cut window and a link to the 5.7 GB source), the cut clips, narration audio, the mix, the music and `renders/`.

## Rebuild

```bash
python3 tools/build.py
```

```bash
HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1 npx --yes hyperframes@0.8.164 render -f 30 -o renders/cutroom-launch-master.mp4
```

The web copy, loop and poster are cut from the master with ffmpeg: 1280×720 at CRF 27; the loop is 24.2-29.4 s plus 30.4-34.4 s, cropped to 1920×1032 and scaled to 540×290 at 20 fps; the poster is the frame at 28.3 s.

## Credits

- Music: "upbeattech" from Pixabay, Pixabay Content License (starts 53.5 s in, so its own ending lands on the end card).
- Sound effects: Pixabay Content License, bundled with HyperFrames.
- Fonts: Instrument Sans, Instrument Serif and JetBrains Mono, SIL Open Font License 1.1 (`assets/fonts/LICENSE.txt`).

#!/usr/bin/env python3
"""Builds the Cutroom launch film's media: clips, soundtrack, and the timeline injected into index.html.
Run from videos/cutroom-launch: python3 tools/build.py [--no-clips]
Inputs: raw/*.webm (screen recordings of Cutroom), raw/wide.mp4 (the wide source shot), raw/edit.mp4 (Cutroom's export),
assets/vo/lNN.wav + lNN.words.json (Kokoro narration + whisper word times), assets/music/upbeattech.mp3 (Pixabay)."""
import difflib, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SFX = Path.home() / ".claude/video-kit/hyperframes/media-use/audio/assets/sfx"
TIMING = json.loads((ROOT / "tools/timing.json").read_text())
END = TIMING["end"]
VO = TIMING["vo"]            # line id -> start in the film
CLIPS = TIMING["clips"]      # [name, source, in, out, speed, start in film]
RES = TIMING["result"]       # [source, in, out, start in film]
LINES = dict(l.split("|", 1) for l in (ROOT / "tools/lines.txt").read_text().splitlines() if l.strip())

def run(*a):
    subprocess.run(a, check=True, cwd=ROOT)

def clip_len(c): return (c[3] - c[2]) / c[4]

def cut_clips():
    (ROOT / "assets/clips").mkdir(parents=True, exist_ok=True)
    for n, src, a, b, s, _, *crop in CLIPS:
        vf = f"setpts=PTS/{s},fps=30,scale=1600:-2" if n != "w1" else "fps=30,scale=1280:-2"
        if crop: vf = f"crop={crop[0]}," + vf
        run("ffmpeg", "-y", "-v", "error", "-ss", str(a), "-to", str(b), "-i", f"raw/{src}", "-an", "-vf", vf,
            "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", f"assets/clips/{n}.mp4")
        print("clip", n, round((b - a) / s, 2))
    src, a, b, _ = RES
    run("ffmpeg", "-y", "-v", "error", "-ss", str(a), "-to", str(b), "-i", f"raw/{src}", "-an", "-vf", "fps=30,scale=1400:-2",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "assets/clips/res.mp4")

def mix():
    ids = sorted(VO)
    ins, f, v = [], [], []
    for i, k in enumerate(ids):
        ins += ["-i", f"assets/vo/{k}.wav"]; ms = int(VO[k] * 1000)
        f.append(f"[{i}:a]aresample=48000,adelay={ms}|{ms}[v{i}]"); v.append(f"[v{i}]")
    n = len(ids)
    src, a, b, at = RES; d = b - a; ms = int(at * 1000)
    ins += ["-i", f"raw/{src}"]
    f.append(f"[{n}:a]atrim={a}:{b},asetpts=PTS-STARTPTS,aresample=48000,volume=1.0,afade=t=in:d=0.15,afade=t=out:st={d-0.3:.2f}:d=0.3,adelay={ms}|{ms}[res]")
    ins += ["-i", "assets/music/upbeattech.mp3"]
    off = TIMING["music_from"]
    f.append(f"[{n+1}:a]aresample=48000,atrim={off}:{off+END},asetpts=PTS-STARTPTS,volume=0.22,afade=t=in:d=0.6,afade=t=out:st={END-1.0}:d=1.0[mus]")
    fx = []
    for j, (name, vol, t) in enumerate(TIMING["sfx"]):
        ins += ["-i", str(SFX / f"{name}.mp3")]; ms2 = int(t * 1000)
        f.append(f"[{n+2+j}:a]aresample=48000,volume={vol},adelay={ms2}|{ms2}[x{j}]"); fx.append(f"[x{j}]")
    f.append(f"{''.join(v)}amix=inputs={len(v)}:normalize=0[vo]")
    f.append(f"[vo][res]amix=inputs=2:normalize=0,apad=whole_dur={END},asplit=2[sp][key]")
    f.append("[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck]")
    f.append(f"{''.join(fx)}amix=inputs={len(fx)}:normalize=0[fx]")
    f.append(f"[sp][duck][fx]amix=inputs=3:normalize=0,atrim=0:{END},loudnorm=I=-14:TP=-1.5:LRA=11[out]")
    (ROOT / "assets/audio").mkdir(parents=True, exist_ok=True)
    run("ffmpeg", "-y", "-v", "error", *ins, "-filter_complex", ";".join(f), "-map", "[out]", "-ar", "48000", "-ac", "2", "assets/audio/mix.wav")
    print("mix done")

def norm(w): return re.sub(r"[^a-z0-9]", "", w.lower())

def words():
    """Script words (exact spelling) placed at whisper's times for each line."""
    out = []
    for k, at in VO.items():
        raw = json.loads((ROOT / f"assets/vo/{k}.words.json").read_text())
        raw = raw if isinstance(raw, list) else raw.get("words", [])
        heard = [(norm(w["text"]), w["start"]) for w in raw]
        script = LINES[k].split()
        sm = difflib.SequenceMatcher(a=[norm(w) for w in script], b=[h for h, _ in heard], autojunk=False)
        times = [None] * len(script)
        for blk in sm.get_matching_blocks():
            for i in range(blk.size): times[blk.a + i] = heard[blk.b + i][1]
        for i in range(len(script)):   # fill gaps from neighbours
            if times[i] is None:
                prev = next((times[j] for j in range(i - 1, -1, -1) if times[j] is not None), 0.0)
                times[i] = prev + 0.18
        out += [[w, round(at + t, 3), k] for w, t in zip(script, times)]
    return sorted(out, key=lambda x: x[1])

def inject():
    tl = {"vo": VO, "words": words(), "demo": TIMING["demo"], "steps": TIMING["steps"], "result": [RES[3], RES[3] + RES[2] - RES[1]],
          "rcap": TIMING["rcap"], "badges": TIMING["badges"], "end": END}
    html = (ROOT / "index.html").read_text()
    html = re.sub(r"const TL = .*?; // TL", lambda _: "const TL = " + json.dumps(tl, ensure_ascii=False) + "; // TL", html, flags=re.S)
    vids = "\n".join(f'          <video id="v-{c[0]}" src="assets/clips/{c[0]}.mp4" muted playsinline data-start="{c[5]}" data-duration="{clip_len(c):.3f}" data-track-index="1"></video>'
                     for c in CLIPS if c[0] != "w1")
    html = re.sub(r'<div id="screen">.*?</div></div>', lambda _: f'<div id="screen"><!-- CLIPS -->\n{vids}\n        </div></div>', html, flags=re.S)
    w1 = next(c for c in CLIPS if c[0] == "w1")
    html = re.sub(r'(<video id="v-w1"[^>]*data-start=")[^"]*(" data-duration=")[^"]*', lambda m: f'{m.group(1)}{w1[5]}{m.group(2)}{clip_len(w1):.3f}', html)
    html = re.sub(r'(<video id="v-res"[^>]*data-start=")[^"]*(" data-duration=")[^"]*', lambda m: f'{m.group(1)}{RES[3]}{m.group(2)}{RES[2]-RES[1]:.3f}', html)
    html = re.sub(r'(data-composition-id="main"[^>]*data-duration=")[^"]*', lambda m: f"{m.group(1)}{END}", html)
    html = re.sub(r'(<audio id="mix"[^>]*data-duration=")[^"]*', lambda m: f"{m.group(1)}{END}", html)
    html = html.replace("__PROC__", str(TIMING["proc_minutes"]))
    (ROOT / "index.html").write_text(html)
    print("timeline injected:", len(tl["words"]), "words")

if __name__ == "__main__":
    if "--no-clips" not in sys.argv: cut_clips()
    mix(); inject()

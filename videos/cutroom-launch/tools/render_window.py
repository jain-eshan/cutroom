"""Render a short window of Cutroom's export with Cutroom's own render code, from the shot list the
real export logged (server/logs/<job>/decisions.jsonl). Same regions, same faces, same filters;
only the time span is shorter. Run with the Cutroom server's python, from the server folder:
  .venv/bin/python <this> <job_dir> <decisions.jsonl> <start> <end> <out.mp4>"""
import json, subprocess, sys
from dataclasses import replace
from pathlib import Path
from pipeline.faces import BBox, get_video_duration
from pipeline.render import Keyframe, Region, Track, build_render_segments, render_export

job, log, a, b, out = Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), Path(sys.argv[5])
regions_data = json.loads(log.read_text().splitlines()[-1])["regions"]
faces = json.loads((job / "result.json").read_text())["faces"]
src = (job / "input.mp4").resolve()

regions = [Region(start=r["start"], end=r["end"], layout=r["layout"], person_ids=r["personIds"], source=r.get("source", "suggested"),
                  crop_nudge=(r.get("cropNudge", {}).get("x", 0.0), r.get("cropNudge", {}).get("y", 0.0))) for r in regions_data]
people = [Track(id=t["id"], keyframes=[Keyframe(t=k["t"], bbox=BBox(**k["bbox"])) for k in t["keyframes"]]) for t in faces["people"]]
segs = build_render_segments(duration=get_video_duration(str(src)), regions=regions, people=people, drop_ranges=[])

window = [replace(s, start=max(s.start, a) - a, end=min(s.end, b) - a) for s in segs if s.end > a and s.start < b]
for s in window: print(f"{s.start + a:8.2f} {s.end + a:8.2f} {s.layout}")

clip = out.with_suffix(".src.mp4")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(a), "-i", str(src), "-t", str(b - a), "-c:v", "libx264", "-crf", "12",
                "-preset", "fast", "-c:a", "aac", "-b:a", "256k", str(clip)], check=True)
render_export(clip, out, window, faces["frameWidth"], faces["frameHeight"], b - a)
clip.unlink()
print("done", out)

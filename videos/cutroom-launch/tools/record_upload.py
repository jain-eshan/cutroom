"""Take 1: drop the episode into Cutroom and record processing through to the Cast screen.
Run with the onetake venv python. Writes raw/take1.webm and raw/take1-log.json (event times in the recording)."""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EPISODE = sys.argv[1]
URL = "http://localhost:3470/"
log, t0 = [], None

def mark(name):
    log.append([name, round(time.time() - t0, 2)]); print(name, log[-1][1], flush=True); (ROOT / "raw/take1-log.json").write_text(json.dumps(log))

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1,
                        record_video_dir=str(ROOT / "raw/tmp"), record_video_size={"width": 1440, "height": 1000}, color_scheme="dark")
    page = ctx.new_page(); t0 = time.time()
    page.goto(URL)
    page.wait_for_selector("text=/Start a new episode|keep it all local/", timeout=60000)
    if page.locator("text=keep it all local").count():
        page.wait_for_timeout(800); page.click("text=keep it all local")
    page.wait_for_selector("text=Start a new episode", timeout=90000); mark("upload_screen")
    page.wait_for_timeout(1500)
    # the drop zone's "let go" state, then the file goes in through the same input
    page.dispatch_event("label:has-text('Drag a recording here')", "dragover", {"dataTransfer": page.evaluate_handle("new DataTransfer()")})
    mark("drag_over"); page.wait_for_timeout(1200)
    page.locator('input[type="file"]').first.set_input_files(EPISODE); mark("dropped")
    deadline = time.time() + 40 * 60
    seen = set()
    while time.time() < deadline:
        body = page.inner_text("body")
        for key in ["Transcrib", "faces", "Matching", "Who's who", "Name them", "Cast"]:
            if key in body and key not in seen: seen.add(key); mark("text:" + key)
        if page.locator("text=/Who.s speaking here/").count() and "cast" not in seen:
            seen.add("cast"); mark("cast_screen"); page.wait_for_timeout(6000); break
        page.wait_for_timeout(1000)
    page.screenshot(path=str(ROOT / "raw/take1-end.png"))
    mark("end")
    vid = page.video.path(); ctx.close(); b.close()
    Path(vid).rename(ROOT / "raw/take1.webm")
    (ROOT / "raw/take1-log.json").write_text(json.dumps(log))

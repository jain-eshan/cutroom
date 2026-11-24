"""Take 2: reopen the processed episode, confirm the cast, show auto-framing, edit, export.
Run with the onetake venv python: record_editor.py [job-filename-substring]
Writes raw/take2.webm, raw/take2-log.json (event times) and raw/edit.mp4 (Cutroom's export, untouched)."""
import json, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = "http://localhost:3470/"
log, t0 = [], None

def mark(name):
    log.append([name, round(time.time() - t0, 2)]); print(name, log[-1][1], flush=True)
    (ROOT / "raw/take2-log.json").write_text(json.dumps(log))

def ruler_x(page, seconds):
    """Map an episode time to an x on the framing ruler, from the 0:00 and 50:00 labels."""
    pts = page.evaluate("""() => {
      const out = {};
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        const t = el.textContent.trim(); const r = el.getBoundingClientRect();
        if ((t === '0:00' || t === '50:00') && r.top > 650) out[t] = [r.left, r.top + r.height / 2];
      }
      return out;
    }""")
    x0, y = pts["0:00"]; x50 = pts["50:00"][0]
    return x0 + (x50 - x0) * seconds / 3000, y

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1, accept_downloads=True,
                        record_video_dir=str(ROOT / "raw/tmp2"), record_video_size={"width": 1440, "height": 1000}, color_scheme="dark")
    page = ctx.new_page(); t0 = time.time()
    page.goto(URL)
    page.wait_for_selector("text=/Start a new episode|keep it all local/", timeout=60000)
    if page.locator("text=keep it all local").count():
        page.wait_for_timeout(600); page.click("text=keep it all local")
    page.wait_for_selector("text=Start a new episode", timeout=90000); mark("upload_screen")
    page.wait_for_timeout(1200)
    page.locator("button:has-text('Reopen')").first.click()
    page.wait_for_selector("text=Who's speaking here?", timeout=60000); mark("cast")
    page.wait_for_timeout(1500)
    page.mouse.click(*page.evaluate("""() => { const h=[...document.querySelectorAll('h1')].find(e=>/speaking/.test(e.textContent)); const b=h.parentElement.parentElement.querySelector('button'); const r=b.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; }""")); mark("cast_play")   # play this voice's clip
    page.wait_for_timeout(3500)
    for i in range(10):
        btn = page.locator("button", has_text="That's Person")
        if not btn.count(): break
        btn.first.click(); mark(f"cast_confirm{i}"); page.wait_for_timeout(700)
    page.wait_for_selector("text=Export episode", timeout=30000); mark("editor")
    page.wait_for_timeout(2000)
    # auto-framing: jump to a stretch where the shot changes, and play it
    page.locator("button", has_text="22:11 – 22:16").first.click(); mark("seek_2211"); page.wait_for_timeout(900)
    page.locator("button[aria-label=Play], button[aria-label=Pause]").first.click(); mark("play"); page.wait_for_timeout(10000)
    page.locator("button[aria-label=Play], button[aria-label=Pause]").first.click(); mark("pause"); page.wait_for_timeout(800)
    # your call: change how often it cuts in, trim dead air, zoom in
    page.locator("button:has-text('Most answers')").first.click(); mark("most"); page.wait_for_timeout(1800)
    page.locator("button[role=checkbox]:has-text('Trim dead air')").first.click(); mark("trim_on"); page.wait_for_timeout(1800)
    page.locator("button:has-text('Over 0.5s')").first.click(); mark("over05"); page.wait_for_timeout(1600)
    for _ in range(3): page.locator("button[aria-label='Zoom in']").first.click(); page.wait_for_timeout(300)
    mark("zoomed"); page.wait_for_timeout(1800)
    page.locator("button[aria-label=Play], button[aria-label=Pause]").first.click(); mark("play2"); page.wait_for_timeout(4000)
    page.locator("button[aria-label=Play], button[aria-label=Pause]").first.click(); mark("pause2"); page.wait_for_timeout(600)
    # back to Cutroom's own suggestions, so the export is untouched
    page.locator("button[role=checkbox]:has-text('Trim dead air')").first.click(); page.wait_for_timeout(300)
    page.locator("button:has-text('Long answers')").first.click(); page.wait_for_timeout(300)
    page.locator("button:has-text('Reset to suggested')").first.click(); mark("reset"); page.wait_for_timeout(1000)
    page.locator("button:has-text('Export episode')").first.click()
    page.wait_for_selector("text=Render and publish", timeout=20000); mark("publish")
    page.wait_for_timeout(1500)
    page.locator("text=Subtitles file").first.click(); page.wait_for_timeout(500)
    page.locator("text=Audio for the podcast feed").first.click(); mark("options"); page.wait_for_timeout(1200)
    page.locator("button:has-text('Render & publish')").first.click(); mark("render")
    page.wait_for_selector("text=Your episode is ready", timeout=60 * 60 * 1000); mark("ready")
    page.wait_for_timeout(3000)
    with page.expect_download(timeout=120000) as dl:
        page.locator("a[download$='.mp4']").first.click()
    dl.value.save_as(str(ROOT / "raw/edit.mp4")); mark("saved")
    page.wait_for_timeout(1000); mark("end")
    vid = page.video.path(); ctx.close(); b.close()
    Path(vid).rename(ROOT / "raw/take2.webm")

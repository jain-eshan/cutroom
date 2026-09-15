# Market research — where this sits

Research pass, current as of September 2026. This is not a go-to-market plan
— the project stays free, open-source, and self-hosted by the founder's own
choice (see [BUSINESS_MODEL.md](BUSINESS_MODEL.md)). This doc exists so that
choice is made with eyes open: what else exists, how this project's approach
actually differs, and how big the underlying opportunity is, for context.

---

## Summary

Nothing found in this research does exactly what this project does: take a
single camera angle with multiple people in frame and one mixed audio
track, and turn it into a full, long-form edited episode — not a short
clip — using face recognition and lip-sync to figure out who's on screen
and talking, entirely on the user's own machine. The closest commercial
tools (Descript's Automatic Multicam, Riverside's Smart Layouts) solve a
related but different problem: they need separate per-speaker tracks,
which this project's target user — one camera, no isolated mics — doesn't
have. The closest *open-source* tools (below) get closer on the
single-mixed-track + diarization axis but stop at short vertical clips and
don't do face recognition or lip-sync casting. Whether that gap is worth
filling for anyone beyond this project's own use case is a separate
question from whether the gap exists — see Positioning and Risks below.

---

## Comparison

| Tool | Relevant feature | Single-track or multi-track input | Cloud or local | Pricing (found) | Open source? |
|---|---|---|---|---|---|
| **Descript** (Automatic Multicam / Underlord) | Cuts to whichever camera is speaking | **Multi-track only.** Descript's own help docs state Automatic Multicam's default style "only works with multi-track sequences," and instruct users to "assign each audio track to the correct camera" — [help.descript.com](https://help.descript.com/hc/en-us/articles/28736507904525-Automatic-multicam). Built around recording in Descript Rooms | Cloud (Rooms recording + AI processing) | Free (60 min/mo, capped AI); paid tiers $16–24 (Hobbyist) / $24 (Creator) / $50 (Business) per seat/mo depending on billing term — [eesel AI](https://www.eesel.ai/blog/descript-pricing), [Sonix](https://sonix.ai/resources/descript-pricing/) | No, proprietary |
| **Riverside.fm** (Smart Layouts / Speaker View / Magic Clips) | Auto multicam switching to active speaker; can also crop a single externally-recorded video into per-speaker views via face detection | Native workflow is **multi-track**: each participant's audio/video is recorded locally on their own device, then synced in the cloud — [Riverside via review coverage](https://www.castmagic.io/software-reviews/riverside-fm). The single-video-split feature is a **visual crop**, not audio diarization, and only works if the camera layout stays fixed the whole time — [cotovan.com](https://cotovan.com/post/how-to-split-a-single-video-into-multicam-in-riverside/) | Cloud (tracks recorded locally, then uploaded/synced to Riverside's servers) | Free (2h, 720p); Standard $19/mo annual; Pro $29/mo annual; Business custom — [Capterra](https://www.capterra.com/p/10004414/Riverside/) | No, proprietary |
| **Opus Clip** | Active-speaker detection reframes 16:9 to 9:16, split-screen for multi-person dialogue | Works on already-cut footage; sources describe "active speaker detection" but don't confirm whether it's audio-diarization-driven or purely visual/face-based. Produces **short clips**, not full episodes | Cloud | Reports conflict: some cite Free / Starter ~$15 / Pro ~$29 per month ([g2.com](https://www.g2.com/products/opusclip/pricing)); another cites Pro around $79/mo ([eesel AI](https://www.eesel.ai/blog/opusclip-pricing)) — noted here as unresolved rather than picking one | No, proprietary |
| **Submagic** | "AI reframe" added 2025/2026 | Sources disagree on whether genuine face/speaker tracking is included in the base product or gated behind a separate $19 add-on — [forkoff.xyz](https://forkoff.xyz/blog/clipping/submagic-review-deep-dive), [tekpon.com](https://tekpon.com/software/submagic/reviews/) | Cloud | Free (3 videos/mo, watermark); Starter $20; Pro $40; Agency $80/mo — [OMR Reviews](https://omr.com/en/reviews/product/submagic/pricing) | No, proprietary |
| **Captions.ai** | Auto reframe included from the Starter plan | Built primarily for single-person "talking videos," not multi-speaker turn-taking — [HyzenPro](https://hyzenpro.com/blog/captions-ai-review/) | Cloud | Sources disagree on exact tier prices ($8.99–9.99 Starter/Pro range, $29.99 Business) — [eesel AI](https://www.eesel.ai/blog/captions-ai-pricing) | No, proprietary |
| **Munch** | Auto-cropping / smart reframing for repurposed social clips | Not confirmed whether reframing is speaker-aware or a generic subject crop — [genesysgrowth.com](https://genesysgrowth.com/blog/opus-clip-vs-munch-vs-pictory) | Cloud | Pro $49/mo annual; Elite $116/mo; Ultimate $220/mo — [sendshort.ai](https://sendshort.ai/guides/munch-review/) | No, proprietary |
| **Klap** | "Reframe 2" detects the active speaker per clip and crops 16:9 to 9:16 keeping them centered | Visual active-speaker detection on already-produced footage, for **short clips** | Cloud | Starter from ~$23–29/mo; Reframe 2 + 4K gated to Pro and above — [scalereach.ai](https://www.scalereach.ai/blog/klap-review-for-short-form-teams) | No, proprietary |
| **Veed.io** | Auto-resize with "smart tracking" that keeps the speaker centered across aspect ratios | Single-subject visual tracking | Cloud — explicitly browser-based, "projects automatically saving to the cloud... accessible from any device" — [Sonix](https://sonix.ai/resources/veed-io-review/) | Lite $12–24/mo; Pro $29–55/mo; Enterprise custom — [SaaSworthy](https://www.saasworthy.com/product/veed-io/pricing) | No, proprietary |
| **CapCut Auto Reframe** | AI object tracking recenters the crop per aspect ratio | Documented to work best with "one dominant person, one clear product, one speaker" — i.e. single-subject, not multi-person turn-taking — [hitpaw.com](https://www.hitpaw.com/auto-reframe-tips/auto-reframe-capcut.html) | Cloud — described as consuming "cloud-based processing resources" even from the desktop client — [hitpaw.com](https://www.hitpaw.com/auto-reframe-tips/auto-reframe-capcut.html) | Free tier limited; Auto Reframe gated behind CapCut Pro — [capcut.com](https://www.capcut.com/help/why-do-i-have-to-pay-for-auto-reframe) | No, proprietary |
| **Adobe Premiere Pro** (Auto Reframe) | Sensei-driven subject/motion tracking repositions the crop on an aspect-ratio change, with three motion presets | Tracks one primary subject per clip; no audio diarization, no multi-speaker cut logic — [learningcurveglobal.com](https://learningcurveglobal.com/ai-auto-reframe-in-premiere-pro-optimising-video-for-every-platform/) | Local — runs inside the desktop NLE, not uploaded | Single-app subscription $22.99–34.99/mo depending on term — [costbench.com](https://costbench.com/software/video-editing/adobe-premiere-pro/) | No, proprietary |
| **Wisecut** | Facial-recognition-based auto-reframe across 9:16 / 1:1 / 16:9; cuts + captions in every plan | Face-detection based; not confirmed whether it handles multi-speaker turn-taking or just a single-subject crop — [lipiai.blog](https://lipiai.blog/wisecut-ai-review/) | Cloud | Free (1h/mo, watermark, 720p); Starter $15/mo; Professional $29/mo annual — [wisecut.ai/pricing](https://wisecut.ai/pricing) | No, proprietary |
| **Kapwing** | Auto-reframe with "speaker focus"; Smart Cut removes silences | Described as speaker-aware reframing; not confirmed whether it's audio-diarization-driven on a mixed track or visual face tracking — [katto.tech](https://katto.tech/compare/kapwing) | Cloud — browser-based editor | Free (720p, 1-min cap, watermark); Pro $16–24/mo; Business $50/mo — [socialrails.com](https://socialrails.com/blog/kapwing-review) | No, proprietary |
| **autoclip** (artbyjazi) | WhisperX-based speaker diarization drives reframing to whoever is talking | **Single mixed track + audio diarization** — closest to this project's audio approach — [github.com/artbyjazi/autoclip](https://github.com/artbyjazi/autoclip) | Local-first: "Nothing leaves your machine, no API costs" with Whisper + Ollama; optional cloud LLM gets transcript text only, never video/audio | Free | **Yes, MIT** — but short-clip output only: no face recognition, no lip-sync, no full-episode timeline or export |
| **opensource-clipping** (NaufalRizqullah) | Pyannote diarization + face tracking; split-screen, camera-switch, and dynamic layouts for "3+ speakers" | **Single mixed track + diarization + visual face tracking** — the closest feature overlap found | Not local-first: Google Gemini API is mandatory for content curation/metadata; Whisper transcription can run locally — [github.com/NaufalRizqullah/opensource-clipping](https://github.com/NaufalRizqullah/opensource-clipping) | Free to self-host, but dependent on paid Gemini API usage | **Yes, MIT** — but again short vertical clips only, not a full-length episode export |

Every commercial "auto-reframe" tool in this table is a cloud SaaS: footage
gets uploaded to a third party's servers. Premiere Pro's Auto Reframe is
the one local exception, but it's a single-subject motion tracker inside a
paid desktop NLE, not a speaker-turn-aware multi-person editor.

---

## Market size and growth context

**Podcasting market size:** figures vary widely by vendor and are not
treated here as reliable numbers, only as a rough sense of scale and
direction:

- IMARC Group: ~$28.2B in 2025 — [imarcgroup.com](https://www.imarcgroup.com/podcasting-market)
- Grand View Research: ~$50.8B estimated for 2026 — [grandviewresearch.com](https://www.grandviewresearch.com/industry-analysis/podcast-market)
- Market.us: ~$34.3B in 2025, 25% CAGR — [market.us](https://market.us/report/podcasting-market/)
- Precedence Research: projecting $115.57B by 2035 — [precedenceresearch.com](https://www.precedenceresearch.com/podcasting-market)

These four disagree by nearly 2x on the 2025/2026 figure alone, which is a
sign the "podcasting market" is being defined differently (ad revenue vs.
hosting/tools spend vs. something broader) across reports. None of them
should be read as a precise number.

A more grounded, single-methodology figure: the IAB/PwC **U.S. Podcast
Advertising Revenue Study** found podcast ad spend reached **$2.862
billion in 2025, up 17.6% year over year**, inside a broader "digital
audio" category (podcasts + streaming music/radio ads) that hit **$8.4
billion in 2025**, up 10.2% — [Radio Ink](https://radioink.com/2026/04/16/iab-digital-audio-grew-10-in-2025-as-podcasts-near-3b/), [Barrett Media](https://barrettmedia.com/2026/04/16/digital-audio-ad-spending-hits-8-4-billion-in-2025-new-iab-data-shows/). The same coverage notes the IAB's
podcast figures still use the traditional audio-only definition even as
video becomes the dominant consumption mode — meaning even this "solid"
number likely understates the real video-podcast economy.

**Audience size:** Edison Research's Infinite Dial 2025 (a long-running,
methodologically consistent annual survey, n=5,020) found **73% of
Americans age 12+ have consumed a podcast** (audio or video), an
estimated 210 million people, with 55% monthly and 40% weekly listeners
(up from 15% weekly in 2017) — [edisonresearch.com](https://www.edisonresearch.com/the-infinite-dial-2025/).

**Shift to video:** this is the trend most relevant to why this project
exists at all. Multiple secondary sources (not all traced to a single
primary study, so treated as directional rather than precise) report:

- YouTube is described as the most-used podcast platform, with roughly
  70% of podcast consumers using it to watch or listen, and over a
  billion monthly podcast viewers by early 2025 — [backlinko.com](https://backlinko.com/podcast-stats)
- Apple Podcasts began supporting video episodes by early 2026, meaning
  every major podcast platform now treats video as core — [podcastnewsdaily.com](https://www.podcastnewsdaily.com/news/iab-report-signals-podcast-evolution-as-video-redefines-the-medium/article_41242987-b362-40ff-b6b6-70d3109496f1.html)
- Spotify reports close to 500,000 video podcasts and 390M+ users who've
  watched one, a 54% YoY increase — cited in the same IAB coverage above
- A figure of "700 million hours watched on TV sets in October 2025, up
  from 400 million a year earlier" appears in several secondary write-ups
  without a clearly identified primary source — flagged here as
  **unverified**, not repeated as fact

**AI video editing tools market:** estimates here vary even more than
podcasting, largely because "AI video" gets scoped differently (editing
tools vs. generative video vs. the broader AI-video category):

- Market.us: AI video editing tools at ~$1.6B in 2025, projected to $9.3B
  by 2030 (42% CAGR) — [market.us](https://market.us/report/ai-in-video-editing-market/)
- A broader "AI video market" figure of $4.6B in 2025 growing to $42.3B
  by 2033 (33.7% CAGR) also appears, but that scope includes generation,
  not just editing — [grandviewresearch.com](https://www.grandviewresearch.com/industry-analysis/artificial-intelligence-ai-video-market-report)

**Bottom line:** there's no credible, precisely-scoped figure for "the
market for auto-editing single-camera, multi-person podcast video." That
specific niche isn't sized by any report found — it's a sub-segment of a
sub-segment (podcast tools, inside AI video editing, inside video
podcasting) that nobody appears to size on its own.

---

## Positioning

The honest read: the specific combination this project targets — single
camera, multiple people in frame, one mixed audio track, fully local
processing, open source, producing a complete long-form edit rather than
short clips — doesn't appear to be served by anything found in this
research. But that's a narrower claim than "nobody solves the underlying
problem," and it's worth separating out why:

- **Descript and Riverside solve the adjacent, more common version of the
  problem** — multi-track recordings where each speaker already has an
  isolated track — better than this project ever could, because they own
  the recording step too. Their auto-multicam features are explicitly
  gated on having separate tracks (confirmed directly in Descript's help
  docs). This project's whole reason to exist is the case where that
  isolation doesn't exist.
- **The commercial short-clip tools (Opus Clip, Klap, Submagic, Captions,
  Munch, Wisecut, Kapwing, Veed, CapCut) are optimized for a different
  output**: vertical social clips cut from already-produced footage, not
  a complete long-form episode edit. Several explicitly work best with a
  single dominant subject, not turn-taking between multiple people. None
  of the sources found confirm audio-diarization-driven speaker
  attribution on a single mixed track — most appear to rely on visual
  face/motion tracking, which is a materially easier and less accurate
  problem than "figure out who is actually talking from the audio and
  match it to a face."
- **The two open-source projects found (autoclip, opensource-clipping)
  are the closest analogs**, and validate that the underlying techniques
  (Whisper, pyannote diarization, face tracking) are accessible enough
  for hobbyist projects to combine. Neither does face recognition +
  lip-sync-based casting, and both stop at short-clip output rather than
  a full episode timeline and export — which is this project's actual
  deliverable.

So: underserved, as far as this research can tell, but in a narrow and
possibly small niche — not an obviously large, clearly underserved
market. See Risks below for why that gap might be smaller or more
temporary than it looks.

---

## Risks

- **Descript or Riverside could close this gap without much difficulty.**
  Both already run transcription and diarization at scale; both already
  have face-tracking-adjacent features (Riverside's single-video split).
  Adding lip-sync-based speaker-to-face matching for single-mixed-track
  input is an engineering lift, not a research problem, for teams with
  far more resources than this project. The likely reason they haven't:
  their paying customers overwhelmingly already use multi-track
  recording (that's the product they sell), so there's limited commercial
  incentive to serve the single-camera, no-isolated-mic case well.
- **The techniques aren't a moat.** `faster-whisper`, `pyannote`, YuNet/
  SFace, and LR-ASD are the same open building blocks any of the
  companies above could assemble. What differs here is the specific
  fusion (diarization + lip-sync + face recognition, cross-checked
  against each other — see [docs/STATUS.md](STATUS.md)) and that it's
  packaged as free, local, and open — not the underlying ML.
- **The target case may be shrinking.** Multi-track remote recording
  (Riverside, Zoom Cloud Recording, Squadcast, Descript Rooms) has gotten
  cheap and easy enough that fewer podcasters may end up in the
  single-mixed-track situation this project targets, especially for
  remote setups. The case that remains hardest to avoid is in-person,
  single-camera recording — multiple people physically in one room with
  one camera — which is common for local studios and casual setups, but
  no source in this research sizes that specific scenario.
- **No report sizes this niche directly**, as noted above. Every market
  figure cited here is for a broader category (all podcasting, all AI
  video editing) that includes this project's use case as an
  unmeasured sliver. Any claim about how big the actual addressable
  niche is would be invented, not researched — so none is made here.

---

## Closing note

This is a competitive/market awareness document, not a go-to-market plan
or a pitch. The project is staying free, open-source, and self-hosted —
that decision was made independently of anything in this research and
isn't being revisited here. The point of this doc is just to know what's
out there and be honest about where this project's approach is genuinely
different versus where it's covering ground someone else already covers
well.

# Documentation

Start with the root [README](../README.md) to run Cutroom, and
[CONTRIBUTING.md](../CONTRIBUTING.md) to change it. This folder is everything
behind those two.

## Current: kept up to date

| Doc | Read it for |
|---|---|
| [STATUS.md](STATUS.md) | What works today, what's been measured on real recordings, and the ordered roadmap. The source of truth for "what's next". |
| [FEATURES.md](FEATURES.md) | Every feature, what it does for the person using it, its status, and where the code is. |
| [EDGE_CASES.md](EDGE_CASES.md) | The rules the automatic edit should follow, 45 situations it has to handle, and the decisions still open. The best place to find something to work on. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system is built: the plan, the API, the frontend layout, every dependency and why it's there, known limitations, and bugs found along the way. |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | How the Cutroom design handoff was implemented: tokens, theming, logo, screens, and the deviations from the design with reasons. |
| [PRODUCT.md](PRODUCT.md) | What Cutroom is, who it's for, and what it deliberately isn't. |
| [BUSINESS_MODEL.md](BUSINESS_MODEL.md) | Why it's free, local and open source, and stays that way. |
| [MARKET_RESEARCH.md](MARKET_RESEARCH.md) | The other tools that edit podcast video, and where Cutroom differs. |

## Historical: design records

These were written to plan one phase of work. They explain why things are
the way they are, but parts no longer match the code. Where they disagree
with a current doc, the current doc wins.

| Doc | What it planned |
|---|---|
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Phase 4: the real export and multi-speaker framing. Its per-turn layout model was later replaced by shots on a timeline. |
| [UX_PRD.md](UX_PRD.md) | Phase 4's UI requirements, including the three-person limit on composites that `render.py` later dropped. |

## Design files

[`design/handoff/`](design/handoff/) holds the Cutroom design handoff: the
brand kit, every screen, and the landing page, as HTML design canvases. Open
any `.dc.html` file in a browser. Its [README](design/handoff/README.md) is
the written spec: tokens, typography, copy rules and each screen's layout.

## Other READMEs

- [`server/README.md`](../server/README.md): the processing service on its
  own, and how speaker detection, face tracking and lip-sync work.
- [`site/README.md`](../site/README.md): the website, live at
  https://cutroom-ruddy.vercel.app, and how to change or deploy it.

# Business model

Short, because the answer is short: this is free, open-source, and
self-hosted, and there's no plan to change that. This doc exists so that
"why isn't there a business plan" isn't an undocumented gap — it's a
decision, and this is the reasoning behind it.

## The model

- **Free.** No price, no subscription, no free tier vs. paid tier.
- **MIT-licensed.** Anyone can use it, modify it, or build on it, including
  commercially.
- **Self-hosted.** You run it on your own machine. There's no hosted
  version, no account system, no server this project operates that your
  recordings pass through.

## Why this fits the product, not just the budget

The core value proposition — nothing about your recording leaves your
machine — is a promise, not an implementation detail. Turning this into a
paid cloud service would mean breaking that promise (footage would have to
be uploaded somewhere to run on infrastructure this project pays for), or
building an entirely different local-license-key product, which is a
different project. See [PRODUCT.md](PRODUCT.md)'s "local-first, not a
habit — a requirement" for the fuller reasoning.

There's also no venture behind this to fund infrastructure even if the
architecture changed: it started, and remains, one person's tool for
editing their own podcast.

## Cost structure today

Effectively zero recurring cost, because there's no infrastructure:

- **No server costs.** Nothing runs except on the user's own machine.
- **No API costs.** Every model (Whisper, the diarization model, the face
  and lip-sync models) runs locally after a one-time download — no
  per-request cloud API bill for transcription, diarization, or anything
  else. None of them needs an account: the diarization weights ship inside
  the app, and the rest download from public repositories.
- **The real cost is development time** and, during development, the
  compute used to run and measure the pipeline against real footage (see
  [STATUS.md](STATUS.md)'s "Measured, not asserted" section for what that
  looked like — GPU time, mostly).

## Distribution

GitHub, the MIT license, and word of mouth. No marketing spend, no sales
process, no growth targets. Reach is currently: the person who built it,
plus whichever podcast hosts try it after the real-world validation test
described in [STATUS.md § What's left](STATUS.md#whats-left).

## What's deliberately not being pursued, and why

- **A hosted/SaaS version** — would require the recording to leave the
  user's machine, contradicting the core premise, and would require
  ongoing infrastructure spend this project isn't set up to carry.
- **A paid "Pro" tier** — there's no free/paid feature split planned; the
  whole tool is the free tool.
- **Ads or data monetization** — nothing is collected that could be
  monetized this way, and adding collection to enable it would again
  contradict the local-first premise.

## What would have to be true for this to change

Kept short and explicitly speculative — none of this is planned, it's the
honest answer to "what would make you reconsider":

- If the [target validation user](PRODUCT.md#who-its-for) test (a
  non-technical podcast host, unassisted) shows that getting it installed at
  all is the actual blocker to anyone but the builder using this, a hosted
  "just works" version aimed at removing that friction becomes a more
  serious conversation. There is less of that friction than there was: the
  desktop build ships `ffmpeg` and the speaker model, installs `uv` itself,
  and asks for no accounts, so there's no terminal and nothing to sign up
  for. What's left is still real, though — a download to find and run, and a
  Mac build that isn't code-signed, so Gatekeeper blocks it until you
  right-click and choose Open. That's a UX problem with a cloud-shaped
  solution, not a monetization strategy arrived at first.
- Even in that scenario, the more likely shape is "self-hosted stays free
  and canonical; a hosted convenience layer is a separate, optional thing
  people pay for if they want it" (an open-core-style split) rather than
  taking the free version away. That's speculation about a fork in the
  road, not a roadmap item — see [STATUS.md](STATUS.md) for what's
  actually being built next, which is none of this.

See [MARKET_RESEARCH.md](MARKET_RESEARCH.md) for what the competitive
landscape actually looks like — useful context for that hypothetical, not
because this project is being positioned against it today.

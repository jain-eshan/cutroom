# Product — what this is and who it's for

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) (how it's built) and
[STATUS.md](STATUS.md) (what's actually working right now). This doc is the
"what and why," not the "how."

---

## What it is

A free, open-source, local tool that turns a single-camera podcast
recording — one frame, multiple people, one mixed audio track — into an
edited video: zoomed to whoever's talking, split-screen when people talk
over each other, cut cleanly between speaker turns. You upload a recording,
name the people in it once, and get an MP4 out.

Nothing about the recording leaves your machine. Transcription, speaker
identification, face recognition, and rendering all run locally.

## The problem it solves

Editing a multi-person podcast video by hand — deciding who's on screen at
every moment, zooming to them, cutting when someone else starts talking,
splitting the screen when two people talk at once — is slow, repetitive
work that most podcasters either do themselves (hours per episode) or pay
an editor for. Tools that automate this already exist, but the ones that do
it well generally assume a studio setup: each speaker has their own
isolated microphone and camera angle, so the software can tell who's
talking just by checking which track has signal.

That assumption doesn't hold for most independent podcasters. A single
camera pointed at a table, phone audio, a Zoom recording — one video frame,
one mixed audio track, no per-speaker isolation. Figuring out who's talking
has to come from the recording itself: whose lips are moving, whose voice
this is. That's a harder problem, and it's the specific one this project
takes on. See [ARCHITECTURE.md § The Plan](ARCHITECTURE.md#the-plan) for
the engineering reasoning behind that scope decision.

## Who it's for

- **Primary user, today:** the person building it — self-use, editing their
  own recorded episodes.
- **Target validation user, next:** a podcast host who currently edits
  manually and has no relationship to this project's code. The real test
  (see [STATUS.md](STATUS.md)'s "What's left") is showing them a full
  episode and finding out whether the edit is good enough to be useful,
  unassisted.
- **Longer-term, if it goes anywhere:** independent podcasters and small
  shows recording single-camera, multi-person video who currently either
  edit by hand or don't bother producing a video cut at all. Not
  professional studios with multi-track rigs — they're already well served
  by existing tools built for that setup (see
  [MARKET_RESEARCH.md](MARKET_RESEARCH.md)).

No accounts, no multi-user concept, no roles. Every screen assumes one
person at a local machine, because that's the only case that's been built
for so far.

## Why it exists

Built because the person building it records a podcast on a single camera,
wanted an edited video out of it, and found that the tools which do this
well assume a recording setup they don't have. Rather than buy a multi-track
rig to make an existing tool work, the harder audio-visual problem became
the thing worth solving.

Two decisions shaped everything else:

1. **Post-production only.** This doesn't record anything — bring your own
   footage from whatever you already use (a camera, a phone, Zoom), this
   only edits it. Building a reliable recorder is a separately huge, mostly
   already-solved problem; the actual value here is the auto-editing
   intelligence layered on top of any recording.
2. **Local-first, not a habit — a requirement.** Transcription,
   diarization, face recognition, and rendering all run on the user's own
   machine. This isn't a cost-saving measure that happens to also be
   private; it's the reason the tool can exist as a free, self-hosted
   project at all — see [BUSINESS_MODEL.md](BUSINESS_MODEL.md) for why that
   matters to how this stays free.

## What this deliberately is not

- **Not a screen or camera recorder.** Post-production only — see above.
- **Not built for multi-track studio setups.** If every speaker already has
  an isolated mic and camera, tools designed for that setup (Descript,
  Riverside's Smart Reframe, and others — see
  [MARKET_RESEARCH.md](MARKET_RESEARCH.md)) will generally do better than
  this, because they don't have to solve "who's talking" from the recording
  itself.
- **Not a cloud service.** There's no server this project's footage gets
  sent to, no account, no subscription. That's a constraint, not just a
  feature — it's what keeps this free to run. See
  [BUSINESS_MODEL.md](BUSINESS_MODEL.md).
- **Not a general video editor.** No timeline scrubbing of arbitrary cuts,
  no multi-project library, no effects beyond what the auto-edit produces.
  It does one specific job.

## Where it's headed

Full detail and current priority order lives in
[STATUS.md § What's left](STATUS.md#whats-left) — that's the living
roadmap and it's kept current; this section is deliberately short so it
doesn't drift out of sync with it. In one line: finish automatic
speaker-to-face matching (the last piece of removing manual guesswork from
casting), then run a real episode past an actual podcast host and find out
if the edit is good enough to matter before building anything past that.

## Related docs

- [FEATURES.md](FEATURES.md) — every feature, what it does, current status
- [MARKET_RESEARCH.md](MARKET_RESEARCH.md) — the competitive landscape and
  where this sits in it
- [BUSINESS_MODEL.md](BUSINESS_MODEL.md) — why this is free and stays that
  way
- [ARCHITECTURE.md](ARCHITECTURE.md) — the plan, the system design, every
  dependency and why
- [STATUS.md](STATUS.md) — what's measured, what's working, what's next

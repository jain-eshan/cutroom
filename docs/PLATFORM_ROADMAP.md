# Cutroom as a place to work on a show: user journey and roadmap

Status: **proposal for the founder to review, written 2026-10-04.** Nothing here is
adopted yet. [STATUS.md](STATUS.md) stays the source of truth for "what's next" until
this is accepted, and section 14 lists the doc changes that acceptance would trigger.

How to read the tags used throughout:

| Tag | Meaning |
|---|---|
| **[E1]** | Said by the founder in this working session. One person, and that person also builds the product. |
| **[E1-obs]** | Observed by me while making real deliverables from the Practo episode on 2026-10-03/04. Same single source of evidence, but nobody said it. |
| **[E0]** | A fact from this repo's docs or code. |
| **[H]** | A hypothesis. Nobody has said it yet; the host test or a later test has to confirm it. |

Size legend, used for every item: **S** = days, **M** = 1 to 2 weeks, **L** = 3 to 4
weeks, **XL** = longer, or it needs a spike first. These are guesses for one builder
working with AI tools. Capacity per quarter is not known, so there are no dates in
this doc, only an order and gates.

---

## 0. The verdict on one screen

**Verdict: CONDITIONAL.** A discovery-gated plan, not a committed roadmap.

Why not a plain "ready":

1. **Cutroom is pre-product-market-fit.** The host test has not happened ([STATUS.md](STATUS.md#whats-left):
   "A host is lined up within two weeks"). The roadmap method used here says there is
   no roadmap before that point, only a discovery backlog. Every customer story below
   is the founder's own, which is real but one person.
2. **Recent work is near the fix-share limit.** In the last 40 commits, 13 were
   features and 8 were fixes, so fixes were about 38% of feature-plus-fix work. Both
   this method and STATUS.md's own capacity rule say new features stop at 40%. That
   is a rough count from commit prefixes, not a time measurement, but it is close
   enough to the line that this plan reserves 20% for upkeep and names the work
   that counts as upkeep.
3. **The ask changes a written decision.** [PRODUCT.md](PRODUCT.md) says Cutroom is
   "not a general video editor" and "a general media library isn't" planned, and
   STATUS.md parks automatic social clips until after the host test. Doing this is
   a scope change on purpose, and section 4 says where the new line goes.

Why it is still worth planning now:

- **A real gap, in your words:** "there's no landing page where I can click on Home
  to go back." That is a navigation hole, not a feature wish, and it is cheap to fix.
- **The Publish screen already promises these things.** It lists Chapters, Show
  notes and Short clips as "unbuilt" artefacts ([E0] `PublishScreen.tsx`). The
  promise exists; this plan decides how to keep it.
- **I made the work by hand this week.** Sixteen Shorts and two LinkedIn videos from
  one episode. What took the effort is a clear list of jobs (section 3), and most of
  them reuse things Cutroom already knows: the words, the speakers, the faces, the shots.

What I recommend, in order:

1. **Next 14 days: small and cheap.** Make "Home" reachable from everywhere (S). Add
   two questions to the host test script (section 8). Spike one thing: pick a range
   of words in the transcript and export a captioned vertical clip using the
   existing render path (M, throwaway UI). Nothing else.
2. **At the host test:** ask what they publish from an episode besides the video,
   before showing them anything new. That answer sets the order of H2.
3. **After it, if hosts want clips:** build the library and the cut engine first
   (H1), then clips (H2). If they don't, H1 still ships, because Home and a job
   queue are needed whatever the answer is.
4. **Hold the rest.** Brand kit, overlays, audio polish, intro/outro, publishing
   destinations all wait for evidence (H3 and later).

---

## 1. What triggered this: the evidence ledger

All [E1]. In the founder's words, in this working session:

| # | Said | What it tells us |
|---|---|---|
| 1 | "help me cut good reels from this for putting out in youtube shorts" | The first need after an episode exists is short pieces of it. |
| 2 | "give me multiple variants to push out in the ideal youtube shorts format with captions" | People want options to compare, not one take. |
| 3 | "there is no context before the video starts and talks about what Siddharth is mentioning" | A clip alone doesn't say who is speaking or what was asked. This is the sharpest finding. |
| 4 | "add some sort of image, not a watermark, of the founders' podcast logo in the bottom corner so that no one can use the clip and make it their own" | Clips get reused out of context; makers want their brand attached to the clip itself. |
| 5 | "Ensure that there is some sort of slide or opener which gives the user context about who Siddharth is and what he is talking about." | Same as 3, as a requirement. |
| 6 | "Don't keep the entire screen blank for this long. Maybe blur the video in the background…" | Dead time at the start loses viewers; the maker thinks in terms of the first seconds. |
| 7 | "Why is the LinkedIn video made in a 1:1 format? Why not in a horizontal video format, which would work well on LinkedIn?" | The right shape depends on where it is posted, and the maker has a view. The tool should ask, not decide. |
| 8 | "I want to add a short clip along with this post so that folks can understand what I am posting about better." | The clip is made for a specific post, to bring people to the full episode. |
| 9 | "Right now, there's no landing page where I can click on Home to go back." | No way back to a starting place. |
| 10 | "folks may want to stop their work, go to something else, and then come back again" | Work happens in sessions over days. |
| 11 | "make it a one-stop shop for editing the podcast end-to-end, along with these ancillary services" | The stated ambition. |

Plus what I observed while doing the work myself, in section 3.

**Limits of this evidence.** It is one person, who is also the builder, working on an
episode that was *already an edited multi-camera cut* with its own on-screen text.
Cutroom's target is raw single-camera footage. A host with a raw recording may need
different things (for example, no camera cuts to detect, but more framing decisions).
That is why this plan gates on the host test.

---

## 2. Where Cutroom is today

All [E0], from the docs and code on branch `claude/editor-legibility`.

- **One straight path.** `App.tsx` switches between screens by state: upload,
  processing, cast, editor, publish. There are no routes.
- **The upload screen is also the only "home".** Saved episodes appear as a list under
  "Start a new episode" (`UploadScreen.tsx`). `startOver()` goes back to that screen. There is no screen that is
  about your episodes, no status per episode, no resume.
- **Work is already durable.** Edits autosave to `jobs/{id}/edit.json` about 700 ms
  after a change. An episode saves as a `.cutroom` file of roughly 1.2 MB without the
  recording (`project.py`). Reopening goes straight back into the editor.
- **What the pipeline knows about an episode:** every word with a time, who said it,
  who is on camera and where their face is, overlap windows, a waveform, shots.
  Dead air and filler words can be trimmed on export (`trim.py`). Captions are
  burned in from word timings through libass (`captions.py`).
- **The Publish screen lists artefacts.** The episode and captions are built;
  Chapters, Show notes and Short clips are marked unbuilt. The only destination built
  is a folder on this computer.
- **Text annotations (#11) are a stub, automatic social clips (#14) are not started**
  ([FEATURES.md](FEATURES.md)).
- **Rules that constrain this plan:** free, local, MIT ([BUSINESS_MODEL.md](BUSINESS_MODEL.md)); the
  design system's rules (dark app, one accent action per screen, mono only for
  measured values, no icon set, no emoji, no "AI" or "magic" in copy);
  Windows is first-class; the Mac build is unsigned, so updates are manual.
- **Known weaknesses that new features would run into:** the editor drops to about
  4 fps while a cropped shot plays, because two video decoders run at once;
  the automatic framing cuts about once every 96 seconds against a typical 5 to 15
  ([STATUS.md](STATUS.md), "Found 2026-09-20").
- **Telemetry** is six opt-in counts, and the union in `telemetry.ts` is "the
  complete list" (`telemetry.ts`). New events need to be added there and in
  [PRIVACY.md](../PRIVACY.md).

---

## 3. The workshop: what editing around an episode involves

### 3.1 What I actually did, job by job

I turned one 44-minute recording into 8 clips in two styles (16 vertical files), then
a 94-second clip in square and horizontal versions for a LinkedIn post. Each row is a job a
person has to do, how it was done by hand, what hurt, and whether Cutroom already knows the thing it needs.

| # | Job | What it took by hand | What hurt, found on this episode | Cutroom already has | Fit |
|---|---|---|---|---|---|
| 1 | Find the moments worth clipping | Read about 800 transcript lines and rank them by gut | Hooks are specific: a strong claim, a number, a complete thought, no "this"/"it" that points outside the clip | Transcript, turns, speakers | Core |
| 2 | Cut at clean points | Speech-to-text word times were off by up to about 1 second in places (two passes disagreed; the source's own on-screen text showed which was closer). Cuts needed snapping to real silences, a check that a cut doesn't land inside a neighbouring word, and removal of words the transcript invented inside a silent gap | Hours of trial. Cutting by word time alone produces audible chops | Word timings, dead-air detection (`trim.py`) | Core |
| 3 | Remove pauses and interruptions | Trim silences over about half a second; cut an interviewer's interjection out of an answer | Needs to know *who* spoke each stretch | Speakers per word. Few tools know this from a single mixed track | Core, and a real edge |
| 4 | Stitch parts that weren't next to each other | Hook line, then an example, then the framework, with a bridging sentence picked so it reads as one thought | Choosing the join point | Text-based cutting is already a candidate in STATUS.md | Core |
| 5 | Reframe for 9:16, 1:1 and 16:9 | Follow the guest across camera cuts, including reaction shots; zoom wide shots; leave room on the side he looks toward; keep the source's burned-in text out of frame | Per-shot crop rules; shape differs by destination | `faceCrop.ts`, faces and keyframes, shots | Core |
| 6 | Captions | Word-timed, two styles; fix names ("Practo", "HbA1c", "VUPIM"); capitalise after a jump cut; keep clear of each platform's buttons | Re-timing after cuts; safe zones | Captions, word corrections | Core |
| 7 | A context opener | A card with the guest's name and role, the question that was asked, both logos, the video blurred behind for 3 seconds then revealed; the first frame doubles as the thumbnail | No tool does this for you; the question had to be found by reading the transcript | The interviewer's turn right before the answer *is in the transcript* | Core |
| 8 | A brand mark on the clip | Corner logos, sized and placed clear of the platform's buttons | Reuse protection; consistent look across clips | Nothing yet | Core |
| 9 | A cover image | Crop a photo to square and to 16:9, put text where it doesn't cover faces, add a dark gradient for contrast | Text placement | Face boxes | Core |
| 10 | Sound consistency | Loudness to -14 LUFS, short fades at every cut | Easy to forget, easy to automate | ffmpeg in the app | Core |
| 11 | Platform variants | Shorts under 3 minutes; LinkedIn square or horizontal; files over 30 MB can't be sent to a phone | Remembering each platform's limits | Nothing | Core |
| 12 | Style variants and "change one thing, redo all 16" | Rendering again after each piece of feedback | Feedback arrives one change at a time | Saved edits | Core |
| 13 | Reviewing the outputs | A folder of 16 files; look at one first, then ask for the rest | No overview, no status | Nothing | Core |
| 14 | Chapter list for the post | Hand-written timestamps ("19:50: Why a war in Ukraine…") | Finding topic shifts | Transcript, turns | Core |
| 15 | Facts the transcript can't contain | Guest's surname and title, the show's name and logo, the question asked | Had to be asked for; should be asked once and remembered | Nothing | Core |

Two findings that change how to build, not only what to build:

- **Word timestamps from speech-to-text cannot be trusted at the edges.** Any feature
  that cuts "at a word" needs an audio-based snap and a guard. This belongs in one
  shared engine, not in each feature (epic D).
- **Footage that is already an edited cut behaves differently from raw single-camera
  footage.** This episode had hard camera changes and its own on-screen text.
  Cutroom's reframing should say what it does with each (see risks, section 13).

### 3.2 What other editors in this audience would also want

The audience in [PRODUCT.md](PRODUCT.md): independent podcasters and small shows with
single-camera, multi-person video, who either edit by hand or don't publish video at
all. "Fit" is against the guardrail in section 4. **Core** = build. **Adjacent** =
only with evidence. **Out** = not Cutroom.

**Clips**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| Pick a range by clicking words in the transcript | [E1] | Core | E |
| Ranked suggestions of moments, each with a reason | [H] | Core | E |
| Hook first, then the context ("cold open") | [E1] | Core | E |
| Stitch several parts into one clip | [E1] | Core | D, E |
| Auto-trim pauses and fillers inside a clip | [E0] | Core | D |
| Remove one speaker's interjection from an answer | [E1] | Core | D |
| Length targets per platform | [E1] | Core | E |
| Stock footage or B-roll | [H] | Out | n/a |
| Screen-recording inserts | [H] | Out | n/a |

**Reframing**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| 9:16, 1:1, 4:5, 16:9 from one edit | [E1] | Core | E |
| Follow the speaker across the episode | [E0] | Core | E |
| Two people stacked top and bottom for vertical | [H] | Core (reuses composites) | E |
| Wide shot on a blurred background | [H] | Core, small | E |
| Safe-zone guides for each platform's buttons | [E1] | Core | E |

**Captions**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| A few styles, with your brand colours | [E1] | Core | F |
| Highlight the word being spoken | [E1] | Core | F |
| Export SRT/VTT for upload to YouTube and others | [H] | Core | J |
| Translate captions | [H] | Adjacent (local model) | O |
| Bleep or mark profanity | [H] | Adjacent | O |
| Emoji and animated stickers | [H] | Out | n/a |

**Text and graphics**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| Context opener (who, what was asked) | [E1] | Core | G |
| Name tag when someone first speaks | [H] | Core | G |
| Chapter title cards | [H] | Adjacent | G |
| Static pull-quote image from a transcript line | [H] | Core (shares cover studio) | H |
| On-screen emphasis text like "DID NOT SCALE" in the source | [E1-obs] | Adjacent | G |
| Free text layers anywhere | [H] | Out (general editor) | n/a |

**Brand**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| Logo mark on every clip | [E1] | Core | G, I |
| End card ("full episode: link in post") | [H] | Core | G |
| Intro and outro bumpers | parked in STATUS | Adjacent | O |
| Sponsor read insertion | [H] | Adjacent | O |

**Covers and thumbnails**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| Best-frame picker (face forward, eyes open, sharp) | [H] | Core | H |
| Use your own photo as the cover | [E1] | Core | H |
| Text templates, with text placed away from faces | [E1] | Core | H |
| Correct size per platform (YouTube, LinkedIn, podcast art) | [E1] | Core | H |
| Cut-out of a guest, background removed | [H] | Adjacent (local model) | O |
| Generated artwork | [H] | Out | n/a |

**Audio**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| Loudness to a platform target | [E1] | Core, small | L |
| Noise reduction | [H] | Adjacent (local model) | L |
| Music bed | [H] | Out (licensing, library) | n/a |
| Duck overlapping speech | cut in STATUS | Out | n/a |

**Episode packaging**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| Chapter timestamps for the description | [E1] | Core | J |
| Transcript as TXT, SRT, VTT | [H] | Core | J |
| Show-notes draft from the transcript | in Publish today | Adjacent | J |
| Title suggestions | [H] | Out until the local-model decision | O |

**Workflow and library**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| A Home to go back to | [E1] | Core | A |
| Continue where I left off | [E1] | Core | A |
| Choose what to do with a new recording | [E1] | Core | B |
| Add several recordings; they process while I do other things | [E1] | Core | C |
| Renders keep going if I switch screens or quit | [H] | Core | C |
| See all clips and covers for an episode with status | [E1] | Core | E |
| Batch export, and "change once, redo all" | [E1] | Core | K |
| A brand kit and a show, so the next episode starts set up | [E1] | Core | I |
| Remember who the regular hosts are across episodes | [H] | Core | I |
| Search every episode's transcript | [H] | Adjacent | M |
| Storage manager (recordings are gigabytes) | [H] | Core, small | A |

**Distribution, collaboration, other inputs**

| Use case | Evidence | Fit | Epic |
|---|---|---|---|
| Save to a folder | [E0] | Built | n/a |
| Upload straight to YouTube or LinkedIn | [H] | Adjacent (leaves the machine, must ask) | O |
| Scheduling, analytics, comments, cloud review | [H] | Out | n/a |
| Audio-only podcasts to a waveform video | [H] | Adjacent (test with hosts) | O |
| One audio file per speaker | [E0] expected later | Roadmap exists | O |
| Zoom gallery-view recordings | [H] | Adjacent | O |

---

## 4. Product thesis and the scope line

**Thesis.** The episode is the source. Everything you publish from it is a
*deliverable*: the full edited video, a clip, a cover, a transcript, a chapter list.
Cutroom's job is to know the episode well enough that each deliverable takes
minutes, and to put it in the right shape for where it is going.

**The scope line (replaces "not a general video editor" as the working test).** A
feature is in scope only if at least one of these is true:

1. It uses something Cutroom already knows about the episode: the words, who said them,
   who is on camera and where, the shots, the silences.
2. It is needed to put that knowledge into a destination's shape: size, length,
   loudness, safe zone, branding.

A feature that needs neither belongs to a general editor, and those exist already. This
keeps "one-stop shop" honest: one stop for *an episode and what comes out of it*, not
for any video.

**Four design principles.**

1. **One engine.** A deliverable is a cut list (ranges of the source), shots, and
   overlays. The full episode is just the largest deliverable. Build this once; the
   clip composer, text-based cutting of the full episode and the opener all sit on it.
2. **Preview equals export, and a test proves it.** The project learned this in September
   ([STATUS.md](STATUS.md): the preview framed 1.7% tighter than the export). Every new
   visual feature ships with a shared-numbers test on both sides.
3. **Anything made is saved, reopenable and re-renderable.** Clips are part of the
   `.cutroom` file, not loose exports.
4. **Start from a destination, not a format.** "LinkedIn post, horizontal" or
   "Short" is a preset that carries shape, length limit, loudness and safe zones. The
   person can change any of it. This answers the 1:1 versus 16:9 question: the tool
   suggests, the maker decides, and both are one click.

**What does not change:** free, local, MIT, post-production only, single camera first,
Windows first-class, nothing leaves the machine unless the person is asked each time.

---

## 5. Information architecture and navigation

**Objects**

```
Library (Home)
 └─ Show (optional, groups episodes; holds brand kit and regular cast)
     └─ Episode (the source recording + transcript + cast + the main edit)
         ├─ Deliverables
         │   ├─ Full episode
         │   ├─ Clips (many)
         │   ├─ Covers and quote images (many)
         │   └─ Transcript, captions files, chapters
         └─ Exports (files written, with when and where)
```

**Navigation**

- A bar at the top that is always there: `Cutroom  /  Library  /  <Show>  /  <Episode>`.
  Clicking "Cutroom" or "Library" goes Home. This alone fixes the gap you reported.
- Inside an episode, the existing stages become **tabs, not a one-way funnel**:
  Cast · Edit · Clips · Covers · Publish. A first-time person gets a next-step hint;
  nobody is forced down a path. Text only, no icons, to follow the design system.
- Leaving mid-work is always safe, because autosave exists. The Library shows where
  you left off.

**Screens**

| Screen | Purpose | Notes |
|---|---|---|
| Library (Home) | See episodes, resume, add a recording | One accent action: "Add a recording". "Continue" card for the last episode. Rows with a status: Processing 63%, Needs cast, Editing, Ready, Exported. Timecodes and sizes in mono. |
| Add a recording | Pick the file and what to do with it | See B. |
| Episode workspace | The tabs above | Reuses the current screens. |
| Clips | List of clips left, transcript centre, preview right | A clip is a range of words. |
| Clip editor | Trim handles, stitch, reframe, captions, opener, brand mark | Reuses the timeline tray. |
| Cover studio | Pick a frame or photo, set text and size | See H. |
| Show and brand kit | Logos, colours, caption styles, regular cast | See I. |
| Activity | Processing and render queue, with history | A panel, not a page. |
| Settings | Storage, models, shortcuts, usage data | Existing items move here. |

---

## 6. The user journey after someone downloads Cutroom

| Stage | The person is trying to | Today | Pain | Proposed | Epic |
|---|---|---|---|---|---|
| J0 Find and install | Get the app running | Site → download → on Mac, right-click Open because it is unsigned | Fear and friction before any value | Keep; add clear first-run steps for Mac and Windows; no signing until the host test says so (the founder's decision of 2026-09-20) | n/a |
| J1 First launch | Understand what it does | Consent card, then setup downloads models | Nothing to look at while waiting | Show what Cutroom will do while models download; offer a short sample episode to try [H] | A, N |
| J2 Add a recording | Start something | Upload screen, one path | One recording, one outcome | Choose what to do: edit the episode, find clips, transcript only, covers only | B |
| J3 Wait | Do something else | Processing screen holds you | Leaving feels risky | Background processing, a queue, leave and come back | C |
| J4 Confirm who is who | Name the people | Cast screen | Done every episode | Regular cast remembered per show | I |
| J5 Edit the episode | Frame and cut | Editor | Linear, no way back to Home | Tabbed workspace, always a way Home | A |
| J6 Make things from it | Clips, covers, chapters | Not available | Done by hand elsewhere | Clips, Covers, Publish tabs | E, H, J |
| J7 Publish | Get files to where they go | A folder | Platform limits are on you | Destination presets, file checks, a package folder | E, F |
| J8 Come back tomorrow | Continue | Upload screen with a list | No status, no "continue" | Library with status and resume | A |
| J9 Come back next month | Make a clip from an old episode | Reopen, nothing new to do | Old episodes can't use new features | Reopen any episode, make clips from it without reprocessing | D, E |
| J10 Second episode | Go faster | Same steps | Name everyone again | Brand kit and cast reused | I |
| J11 Update | Get new features | Manual download on Mac | Easy to miss | New-features note inside the app on first launch of a new version | A |
| Edge | Recover | Failed run, moved recording, full disk, quit mid-render | Some are handled | Make each one a named state in the Library | A, C |

---

## 7. Epics

Each epic has the four fields the roadmap method requires (problem, story, lever,
metric), plus scope, what it builds on, size and what "done" means. "Lever" is which
part of the strategy it pulls. The strategy here is the one in PRODUCT.md plus the
north star in STATUS.md: **episodes a host would publish without asking for help.**

### A. Navigation and Library

- **Problem:** nowhere to go back to; saved episodes are a list under an upload form.
- **Story [E1]:** "there's no landing page where I can click on Home to go back."
- **Lever:** time from opening the app to the first export; return use.
- **Metric:** share of sessions that start from the Library and resume an episode; time to first export.
- **Slice 1 (S, do now):** logo and a "Library" link in the title bar go to Home from any screen, with the current episode saved first. No new screen yet; Home is today's upload screen.
- **Full (M to L):** route per episode and tab; Library with status and resume; breadcrumb; storage manager; "what's new" note on first launch of a new version.
- **Out:** folders and tags (a show groups episodes), cloud sync, search (epic M).
- **Builds on:** `savedEpisodes`, `handleReopen`, `handleDelete`, `startOver` in `App.tsx`.
- **Risk:** `App.tsx` carries the whole flow in one state machine, and `EditorView.tsx` is 1,765 lines. Moving to per-episode state is a refactor. Count it as upkeep, not as feature work.
- **Done when:** every screen has a way Home, quitting and reopening lands on Home with the right "Continue", and a test opens an episode, goes Home and back without losing an edit.

### B. Add a recording: choose what to do

- **Problem:** a new file means one outcome, the full edit, even when the person wants something else.
- **Story [E1]:** "I can upload more media, wherein I can choose different actions other than the podcast."
- **Lever:** faster first value, wider use.
- **Metric:** share of imports that reach any deliverable; time to first deliverable.
- **Scope (M):** after choosing a file, pick one of: *Edit the episode*, *Find clips*, *Transcript only* (skips face work, much faster), *Covers from this video*. All use the same processing; they differ in which stages run and which tab opens first. Any choice can be widened later without starting over.
- **Out:** a different pipeline per choice. One pipeline, switched on in stages.
- **Builds on:** the stage list in `ProcessingScreen.tsx` and the `/process` endpoint.
- **Risk:** stages must be restartable on their own. Today processing is one unit.
- **Done when:** a transcript-only import finishes without detecting faces, then adding faces later does not redo transcription.

### C. Jobs, queue and background rendering

- **Problem:** processing and rendering hold the screen; leaving is risky.
- **Story [E1]:** "folks may want to stop their work, go to something else, and then come back."
- **Lever:** finish rate of runs; return use.
- **Metric:** processing finished / processing started (already counted); renders that survive leaving the screen.
- **Scope (L):** several imports in a queue; an Activity panel; renders keep going when you change screens; after quitting, an unfinished render is offered again, not lost; a clear state for failed, cancelled and finished.
- **Out:** running jobs in the cloud; priorities and scheduling.
- **Builds on:** `jobs.py`, `progress.py`, `rememberActiveJob`.
- **Done when:** start two imports, open a third episode and edit it, quit, reopen: nothing lost and the queue is correct.

### D. The cut engine (foundation)

- **Problem:** cutting "at a word" is not clean; every feature would reinvent it.
- **Story [E1-obs]:** found on the Practo episode (section 3.1, job 2).
- **Lever:** quality of every deliverable.
- **Metric:** cuts that need a hand correction (recorded per clip like framing decisions already are).
- **Scope (L):** one module that takes a list of word ranges and returns clean cut points: snaps in and out to real silences; refuses a cut that would land inside a neighbouring word; drops words the transcript placed in silence; trims long pauses; can remove one speaker's interjection; stitches ranges with a short fade. The same engine serves clips and, later, text-based cutting of the full episode.
- **Out:** a free-hand blade tool; keyframes.
- **Builds on:** `trim.py` (dead air), word timings, speakers, `regions.ts` shot model.
- **Done when:** a test set of real stretches shows no cut inside a word (checked by energy at the cut), and the same ranges give the same cuts every time.

### E. Clips

- **Problem:** getting short pieces out of an episode is manual, slow and done in other tools.
- **Story [E1]:** "help me cut good reels from this…", "multiple variants… with captions".
- **Lever:** the thing hosts publish after the episode; reasons to return.
- **Metric:** clips exported per episode; time from "open an episode" to first clip; share of suggested moments accepted.
- **Scope (XL, in slices):**
  1. *Range picker (M):* select words in the transcript, see it in the preview, export one clip. This is the spike in section 8.
  2. *Composer (L):* trim handles, stitch several ranges, reorder, remove pauses and an interjection, hook-first.
  3. *Reframe (M):* 9:16, 1:1, 4:5, 16:9; speaker follow; stacked two-person vertical; blurred-background fit; safe-zone guides.
  4. *Find moments (M):* a ranked list, each with a reason shown as plain text ("answers a question, 40 seconds, no pause longer than 1 second, starts with a claim"). Rules, not a score; no "virality" number, because there is no evidence to back one.
  5. *Presets (S):* Short, Reel, LinkedIn square, LinkedIn horizontal, YouTube. Each sets shape, length ceiling, loudness and safe zones, and warns when a limit is exceeded.
- **Out:** stock media, a free timeline, effects, transitions, stickers.
- **Builds on:** `render.py` segment pipeline, `faceCrop.ts`, `TimelineTray.tsx`, captions, epic D.
- **Risks:** the editor's playback rate while cropped (epic N); "find moments" quality can only be judged against what hosts actually pick.
- **Done when:** a person who has never seen the app picks a range and exports a captioned vertical clip in under five minutes, unassisted; preview and export match, tested on both sides.

### F. Captions: styles and files

- **Problem:** captions exist in one look.
- **Story [E1]:** two caption looks were asked for and compared; names needed fixing.
- **Metric:** share of exports with captions on.
- **Scope (M):** three built-in styles (a punchy word-highlight one, a calm subtitle one, a plain one); brand colours from the kit; position with safe zones; SRT and VTT export for platforms that take their own captions.
- **Out:** a style editor with every font; emoji; animated stickers.
- **Builds on:** `captions.py` writes `.ass` through `pysubs2`; libass supports the highlight and fade effects needed. Confirm the bundled ffmpeg includes libass on both platforms before committing.
- **Done when:** the three styles render identically in preview and export on Mac and Windows.

### G. Overlays: context opener, name tag, brand mark, end card

(This replaces the stub "text/bubble annotations", #11.)

- **Problem:** a clip alone doesn't say who is speaking, what was asked, or whose it is.
- **Story [E1]:** "no context before the video starts", "a slide or opener which gives the user context", "not a watermark… so that no one can use the clip and make it their own", "Don't keep the entire screen blank… blur the video".
- **Lever:** clips that make sense without the episode; credit stays with the maker.
- **Metric:** share of clips exported with an opener and a brand mark.
- **Scope (L):**
  - *Context opener:* guest name and role, topic, the question. **Cutroom suggests the question from the interviewer's turn just before the answer**; the person edits it. The video plays blurred behind it for about 3 seconds, then the blur lifts while the text fades first. Length and style are settings. The first frame is the thumbnail.
  - *Name tag:* shows the first time someone speaks.
  - *Brand mark:* logo or logos in a corner chosen from safe positions, with size and opacity.
  - *End card:* one line, such as "Full episode: link in the post."
- **Out:** free text layers anywhere on the frame.
- **Builds on:** `render.py` filter graph, brand kit (epic I), the transcript's turn before a range.
- **Risk:** suggesting the question needs care when the interviewer rambles; always editable, never auto-published.
- **Done when:** exporting a clip with the opener takes no typing beyond confirming names, and the opener never covers the captions.

### H. Cover studio

- **Problem:** a cover is made in a separate design tool, from a screenshot.
- **Story [E1]:** the LinkedIn cover from the founder's own photo.
- **Metric:** covers exported per episode.
- **Scope (M):** choose a frame from the video (candidates are scored on face visible, eyes open, sharpness) or bring a photo; pick a destination (YouTube 16:9, LinkedIn square or link preview, podcast art 1:1, Instagram 4:5); text templates with title, guest and role; text is placed away from faces using the face boxes already found, with an automatic dark gradient for contrast; export JPG or PNG within the platform's size limit. A pull-quote image from a transcript line shares the same studio.
- **Out:** generated artwork, free layers, a template marketplace.
- **Builds on:** `faces.py` boxes, the brand kit.
- **Done when:** a cover for a chosen destination exports in under two minutes with no text on a face.

### I. Show and brand kit

- **Problem:** every episode starts from nothing; a clip needs facts the transcript can't hold.
- **Story [E1]:** the guest's surname and title, the show's logo, Practo's logo, the question: all supplied by hand, one clip at a time.
- **Lever:** the second episode is much faster than the first; a reason to stay.
- **Metric:** time to first export on episode two versus episode one.
- **Scope (L):** a Show holds: name, logos, brand colours, caption style, default framing, default destinations, and **regular cast**, so a recognised host is named once. Guests are entered per episode with role and company.
- **Out:** accounts, sync between machines.
- **Privacy:** remembering faces across episodes keeps face data on disk between sessions. It stays local, can be deleted per person, and must be written into [PRIVACY.md](../PRIVACY.md) before it ships.
- **Done when:** episode two of the same show reaches the editor with the regular cast named and the brand applied, without typing.

### J. Episode packaging

- **Problem:** the description, chapter list and transcript files are written by hand after the edit.
- **Story [E1]:** the post's hand-written chapter timestamps.
- **Metric:** share of exports that include a chapters file.
- **Scope (M):** chapters from topic shifts (long pause plus a question turn plus a change of vocabulary), each with a timestamp, editable; transcript as TXT, SRT, VTT; a description template with the chapters filled in. Show notes stay as a draft of quotes and names from the transcript, not written prose.
- **Out:** generated titles and posts until the local-model decision (section 13).
- **Builds on:** transcript, turns, Publish artefacts.
- **Done when:** chapters on the reference episode land within a few seconds of where a person would put them, judged by the founder on that episode.

### K. Variants and batch

- **Problem:** testing two looks, or applying one change to many clips, means doing it again by hand.
- **Story [E1]:** "multiple variants", and asking for all the rest after checking one.
- **Scope (M):** render a clip in two styles side by side; apply a style, brand or destination change to every clip in an episode; export all, with a status per file; a review grid.
- **Done when:** change the caption style once and re-export 8 clips without opening each.

### L. Audio polish

- **Problem:** loudness varies between clips; background noise.
- **Scope:** *Loudness to a target (S, do with E).* *Noise reduction (M, only with evidence, using a model that runs locally).*
- **Out:** music beds, ducking.

### M. Search across episodes

- **Problem:** "where did I say that?" across a season.
- **Scope (M, only after a library exists):** search words across saved episodes, jump to the moment, start a clip from it. Local only.

### N. Enablers and upkeep (counted in the 20%)

- **Playback rate while cropped (M).** Fix before the clip editor ships, since clips are scrubbed constantly. One decode feeding several crops. Measure in the packaged app first.
- **A real-footage test set (S, ongoing).** The 53-minute reference episode and the Practo episode, with cuts and framing checked by test, not by eye.
- **Telemetry (S).** Add events for the new funnel to the `Event` union and to PRIVACY.md in the same change: clip started and exported, cover exported, library resumed, a destination chosen. Counts only.
- **Windows parity and the unsigned Mac notes (existing).**
- **Docs (existing rule):** update STATUS, FEATURES and ARCHITECTURE with each chunk.

### O. Later or conditional

Each needs evidence first: direct upload to YouTube and LinkedIn (leaves the machine, so it asks every time); caption translation; a local text model for titles and posts; audiograms for audio-only shows; intro/outro bumpers and sponsor reads; guest cut-outs; one audio file per speaker; Zoom gallery view; batched processing for very long recordings.

---

## 8. Sequencing: horizons, gates and capacity

**Capacity rule.** 80% new work and 20% upkeep per horizon. If upkeep passes 40%, new
work stops and the debt is paid first. Upkeep named for these horizons: the `App.tsx`
refactor, playback rate, Windows testing, the real-footage set, the fixes real footage
turns up. Today's rough fix share is about 38%, so H0 deliberately builds very little.

### H0: now to the host test (about 2 weeks)

| Do | Size | Why |
|---|---|---|
| "Library" and logo link to Home from every screen | S | Your reported gap; no new screen needed |
| Add questions to the host test (below) | S | Evidence before building |
| Spike: pick words → export a captioned vertical clip | M | Proves the engine path with throwaway UI; tells us how big E and D really are |
| Finish and merge the branch in flight | n/a | Don't start H1 with an unmerged base |

**Add to the host test.** After they have an edited episode, ask, without showing
anything: *What do you post after an episode, and where? How do you make it? How
long does it take?* Then: *If this could also give you one piece of that, which?*
Keep it open; do not offer a list.

**Gate G1:** at least one host names something they make after the episode that
Cutroom could produce from what it already knows. If hosts name only the full
video, H1 still goes (Home and the queue are needed anyway) but H2 waits.

### H1: a place to come back to (after G1)

A (full) · B · C · D · parts of N (playback rate, test set, telemetry).
Result: Library, add-with-intent, background queue, a clean cut engine, and an
episode that holds clips as documents (saved in the `.cutroom` file, version 2 with
a migration and a refusal path for newer files, as today).

**Gate G2:** the spike and D together show a clip can be cut cleanly on real footage
from at least two different recordings, not only the Practo episode.

### H2: clips and covers

E · F · G · H · J (chapters and transcript files) · L (loudness only).
Result: pick a moment, export it to a destination preset with captions, context opener
and brand mark; make a cover; get chapters.

**Gate G3:** at least three hosts publish a piece made in Cutroom, unassisted, or at
least say they would. Without this, stop and look at the clips for what is wrong.

### H3: the show

I (brand kit, regular cast) · K (variants, batch) · M (search) · more of G (name tags, end cards).
This is where the second episode becomes much faster than the first.

### H4+: conditional (epic O)

Chosen by what hosts ask for, one at a time, with a spike each.

### The first two weeks, day by day

| Days | Work |
|---|---|
| 1 to 2 | "Library" link and logo go Home; edit saved first; test that going Home and back keeps an edit |
| 3 | Write the host-test additions; decide the sample episode question |
| 4 to 9 | The spike: word range → clean cut → captioned 9:16 export through the existing render path |
| 10 | Review the spike; re-size epics D and E with what was learned; update this doc |
| 11 to 14 | Host test; record what they name |

---

## 9. Cut or parked, and why

| Item | Decision | Reason |
|---|---|---|
| Free timeline, tracks, transitions, effects, colour grading | **Out** | Fails the scope line in section 4; general editors do it better |
| Stock footage, music library | **Out** | Licensing, size, and no knowledge of the episode used |
| Generated artwork or generated thumbnails | **Out** | Needs a heavy model, hard to keep local and consistent with the brand rules; low evidence |
| Accounts, cloud sync, cloud review, collaboration | **Out** | Breaks the local-first premise ([BUSINESS_MODEL.md](BUSINESS_MODEL.md)) |
| Scheduling and analytics | **Out** | Not editing; other tools do it |
| A "virality" score | **Out** | No evidence behind a number; show reasons instead |
| Multi-camera | **Stays cut** | Single camera is the positioning (STATUS) |
| Voice ducking | **Stays cut** | Research problem, nobody asked |
| Intro/outro bumpers, sponsor reads | **Parked** | No problem evidence yet (STATUS parks them) |
| Direct publishing | **Parked** | Needs a consent design and evidence |
| Title and post writing | **Parked** | Needs the local-model decision |
| Audiograms | **Parked** | Possibly a large audience, but audio-only is a different positioning; ask hosts |
| Search across episodes | **Parked until the library exists** | Depends on A |
| Noise reduction, translation, cut-outs | **Parked** | Need a local model and evidence |

---

## 10. What to do and what not to do

**Do**

- Keep the scope line from section 4 in every feature review.
- Build the cut engine once and reuse it for clips, the opener, and later text-based
  editing of the full episode.
- Make every output start from a destination preset, with the limits shown.
- Ship the thinnest end-to-end slice first: one clip, one destination, captions.
- Test preview against export for every visual feature, on both sides.
- Test on real footage, including footage that is not edited yet.
- Save everything made, and let old episodes use new features without reprocessing.
- Keep copy plain: "Find moments", not "AI clips"; reasons, not scores.
- Update STATUS, FEATURES and PRIVACY with each change.
- Reserve 20% of every horizon for upkeep, and stop new work at 40%.

**Don't**

- Don't add a general editing surface because someone can think of a use for it.
- Don't build for the Practo episode only. It was already edited; raw single-camera
  footage is the target.
- Don't send anything off the machine to make a feature work. Ask first, every time,
  if a later feature ever needs to.
- Don't add accounts, sync or a hosted version to "support" the library.
- Don't invent a number to rank moments or covers.
- Don't start brand kit, overlays, audio or bumpers before the host test says they matter.
- Don't ship a new screen without a way Home.
- Don't add an icon set, emoji, a second accent colour or "AI" and "magic" wording to
  the app. The design rules stand.
- Don't make Mac signing a prerequisite for anything. It is deferred on purpose.
- Don't skip the migration: older `.cutroom` files must open, and newer ones must be
  refused with a sentence.

---

## 11. Scope summary

### Functional scope by horizon

| Horizon | In | Out |
|---|---|---|
| H0 | Home link from every screen; host-test questions; a spike | A new Library screen; any clip UI |
| H1 | Library with status and resume; per-episode routes and tabs; add-with-intent (edit, find clips, transcript only); queue and background renders; the cut engine; project file v2 with migration; playback-rate fix | Clips UI; brand kit; overlays |
| H2 | Clips (range picker, composer, reframe, find moments, presets); caption styles and SRT/VTT; context opener, brand mark (logo set per clip), end card; cover studio; chapters; loudness | Regular cast memory; variants grid; name tags |
| H3 | Show and brand kit; regular cast; variants and batch; name tags; search | Anything in epic O |

### Product scope

- **Positioning, new sentence for PRODUCT.md:** "Cutroom edits a single-camera podcast
  video, and turns it into everything you publish from it: the full episode, clips,
  covers, captions and chapters. It is still not a general video editor."
- **Price and model:** unchanged: free, open source, local.
- **Audience:** unchanged until the host test says otherwise.
- **Non-goals, rewritten:** no free timeline or effects; no stock media; no cloud, no
  accounts; no recording.

### Data model sketch (proposal)

```
Show        { id, name, logos[], colours, captionStyle, defaultFraming, regularCast[] }
Episode     { id, showId?, recording ref, transcript, cast, mainEdit, deliverables[] }
Deliverable { id, type: episode|clip|cover|files, preset, ranges[], shots[],
              overlays[], captionStyle, output spec, status, lastExport }
Preset      { destination, aspect, size, maxLength, loudness, safeZones }
Job         { id, kind: process|render, state, progress, startedAt }
```

The existing `edit.json` and `.cutroom` format are versioned and checked on read; the
new fields go in version 2 with a migration and a plain-language refusal for
anything newer, as today.

### Backend additions (names are suggestions)

`POST /jobs/{id}/clips` and render per deliverable; a queue listing; `POST /covers`;
chapters and transcript-file endpoints; shows and brand kit storage. All local.

### Non-functional

- **Local only:** no new network calls; the only candidates are in epic O and ask first.
- **Windows and Mac:** every feature runs on both; CI already runs on Windows.
- **Speed:** a 60-second clip should export in about the time it takes to play it, on
  a laptop. This is a target to measure, not a promise yet.
- **Large files:** recordings are gigabytes; never copy them, always reference them.
- **Accessibility:** captions on by default for new clips; keyboard-reachable Home.
- **Privacy:** remembered faces stay on disk, are deletable per person, and are
  documented before release.

---

## 12. Metrics and instrumentation

Cutroom collects only opt-in counts. Everything else comes from test sessions.

| Level | Measure | Source |
|---|---|---|
| North star (kept) | Episodes a host would publish without asking for help | Host tests |
| Added | Pieces published per episode beyond the full video | Host tests; self-report |
| Tier 1 | Time from opening the app to first export | Existing counts plus a new timestamp |
| Tier 1 | Time from opening an episode to first clip | New count |
| Tier 1 | Return use: sessions that start from the Library and resume | New count |
| Tier 2 | Share of suggested moments accepted | Decision log (already written to `decisions.jsonl`) |
| Tier 2 | Share of cuts corrected by hand | Decision log |
| Tier 2 | Exports that succeed | Existing count |
| Health | Fix share of commits per cycle | Git; stop new work at 40% |

New events to add to `telemetry.ts` (the complete list) and PRIVACY.md in the same
change: `library_resumed`, `clip_started`, `clip_exported` (preset, seconds, captions,
opener), `cover_exported`. No text of any kind, as today.

---

## 13. Risks, open decisions and questions

**Risks**

| Risk | Why it matters | What to do |
|---|---|---|
| Building for one person | Evidence is the founder's own work on an already-edited episode | Gate on the host test; run the spike on a second, raw recording |
| Scope creep into a general editor | "One-stop shop" is easy to stretch | Section 4's scope line, applied to every feature |
| Sequencing against the host test | STATUS.md says validate before building much further | H0 is deliberately small; H1 starts at G1 |
| Fix share near 40% | New work could stall | 20% reserved; list the upkeep; stop at 40% |
| Playback rate while cropped | Clip editing needs smooth scrubbing | Fix in H1 before the clip editor |
| Source footage that is already edited | Hard cuts and on-screen text appear in some recordings | Decide: detect cuts, or ask the person; test both |
| Captions through libass | Rich styles depend on the bundled ffmpeg | Confirm on both platforms before epic F |
| Remembering faces | Biometric-like data kept between sessions | Local, per-person delete, documented, opt in |
| Opener question suggested from the interviewer's turn | A rambling question reads badly | Always editable; never published automatically |
| Unsigned Mac updates | New features reach people slowly | In-app note on new versions; revisit signing only after the host test |
| Logos and brand marks | Users supply assets they may not own | The app uses what the person provides; no bundled third-party logos |

**Decisions needed from you**

1. **Reopen the scope sentence in PRODUCT.md?** Section 4's line replaces "not a general
   video editor" as the working test. Yes or no.
2. **Un-park social clips now, or after the host test?** I recommend building only the
   spike now, and the rest after G1.
3. **A local text model, yes or no?** It would unlock titles, post drafts and show notes.
   It adds a large download and a quality bar. I'd decide after H2, with evidence.
4. **Sample episode in the app:** do you have footage you may bundle? It shortens the
   path to a first result.
5. **"Show" or "Project"** as the word for the group of episodes? Show is clearer for podcasters.

**Questions I need answered to size this properly**

- How many builder-weeks do you have per quarter, and how much of them goes to fixes?
- Will the host in the test have a raw single-camera recording, or an edited one?
- Do you want clips and covers to be useful for audio-only shows eventually?
- Which destinations matter first: YouTube Shorts, LinkedIn, Instagram, others?

---

## 14. What accepting this changes in the other docs

Not done yet. Each follows only after you say yes.

| Doc | Change |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Rewrite "what this deliberately is not": replace "not a general video editor" and "a general media library isn't" with the scope line and the deliverables idea |
| [STATUS.md](STATUS.md) | Add the horizons and gates to "What's left"; unpark "Automatic social clips" in stages; replace "text annotations" with epic G |
| [FEATURES.md](FEATURES.md) | #11 becomes overlays (G); #14 becomes clips (E); add Library, queue, covers, packaging, brand kit |
| [ARCHITECTURE.md](ARCHITECTURE.md) | New routes, the deliverable model, project file v2, endpoints |
| [PRIVACY.md](../PRIVACY.md) | New events; remembered faces |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Library, tabs, activity panel and clip editor, built from the existing primitives |
| [EDGE_CASES.md](EDGE_CASES.md) | Cut-point rules from section 3.1 (snap to silence, neighbour-word guard, phantom words) |
| [docs/README.md](README.md) | Link this doc in the "Current" table |

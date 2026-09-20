# Privacy

Cutroom edits video on your own machine. This page says exactly what leaves
it, which is very little, and none of it is your recording.

For how the local pieces are exposed on your network, and how to report a
problem, see [SECURITY.md](SECURITY.md).

## Your recording

Your recording never leaves your computer. The app hands it to a processing
service running on the same machine, on `127.0.0.1`. There is no server to
upload it to, no account, and no subscription.

The same goes for everything derived from it: the transcript, the speaker
turns, the faces, the names you type, the edit you make, and the video you
export. All of it stays in Cutroom's own folder on your disk.

The one thing the app does fetch is model weights, once, on first run — see
[SECURITY.md](SECURITY.md#what-cutroom-does-with-your-data). After that,
processing works with the network off.

## Usage data in the app

**Off unless you turn it on.** The first time Cutroom opens it asks, in
plain words, with both lists below on screen. Saying no costs nothing and is
never asked again. You can change your answer at any time from **usage data**
in the title bar; turning it off also forgets the random id this install was
counted under, so turning it back on later starts a new one.

It exists for one reason. Cutroom is a developer preview that installs a
Python service and several models on first run, and the maintainer has no way
of knowing how often that install fails, or how many people ever reach a
finished video. These counts answer that and nothing else.

### Everything that can be sent

| Event | What it carries |
| --- | --- |
| `app_opened` | Operating system (`mac`, `windows`, `linux`), Cutroom's version |
| `setup_ready` | How many seconds the install took; whether this ffmpeg can burn captions |
| `processing_started` | Nothing |
| `processing_finished` | How many seconds it took; how many people were found |
| `processing_failed` | How far it got, as a fraction |
| `export_finished` | Whether captions were on; whether dead air was trimmed; how many shots |

Each one also carries a random id made on first use, which identifies one
copy of Cutroom and is not derived from anything about you or your machine.

### What is never sent

- Your recording, or any part of it
- File names, folder paths, transcripts, or the names you give people
- **Error messages.** A failure from the pipeline carries the path of the
  recording that caused it, so failures report which stage they reached and
  nothing else.
- Anything that identifies you, your machine, or where you are

This is not a promise you have to take on trust. The whole sender is one
file — [`src/lib/telemetry.ts`](src/lib/telemetry.ts) — and the list above is
the `Event` type in it. There is no analytics SDK in the app, deliberately,
so there is nothing else in there that could send something this page doesn't
mention.

## The website

[cutroom's landing page](https://cutroom-ruddy.vercel.app/) is a different
thing under a different promise: it is a public marketing page, and it counts
visits like one.

- **Vercel Web Analytics** — page views, referrer, country, and page speed.
  Cookieless and not tied to a person, which is why the site shows no cookie
  banner.
- **PostHog** — clicks on the download and GitHub buttons, and whether the
  waitlist section was reached and filled in. Session recording is off.
- **Amplitude** — one page-view event per visit. Autocapture and session
  replay are off.
- **Tally** — the waitlist form itself, when it's open. Your email is used to
  invite you to try Cutroom. Reply to any email from us and we'll remove you.

None of this is connected to the app. The website cannot tell that a visitor
later became a Cutroom install, and the app sends nothing at all unless you
have turned it on.

## Where the counts go

Both the site and the app send to [PostHog](https://posthog.com). The key
they use is a write-only ingest key: it can add an event and read nothing.

## For maintainers

Telemetry is dormant in a plain checkout. Both halves read
`VITE_POSTHOG_KEY` (and the site's Amplitude event reads `VITE_AMPLITUDE_API_KEY`), and with it unset nothing initialises, nothing is sent,
and the site doesn't even ship the PostHog bundle. Set it in Vercel's
environment variables for the site, and at build time for a release of the
app.

Two things this repository cannot enforce on its own, which have to match in
the PostHog project's settings: **GeoIP enrichment off**, and **person
profiles off** for anonymous events. The app asks for both on every event
(`$geoip_disable`, `$process_person_profile`), but the project setting is the
one that decides.

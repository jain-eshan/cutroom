# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately
through GitHub instead: go to the repository's **Security** tab and choose
**Report a vulnerability**
([direct link](https://github.com/jain-eshan/cutroom/security/advisories/new)).
You'll get a reply there.

Cutroom is maintained by one person in their own time, so there's no fixed
response window, but security reports are read before anything else.

## What Cutroom does with your data

- **Recordings stay on your computer.** The app sends the file to its own
  processing service on the same machine. Nothing is uploaded to a server
  this project runs, because there isn't one.
- **Models are downloaded once.** On first run the service downloads model
  weights from GitHub and Hugging Face. After that, processing works offline,
  except for the Hugging Face token check on the setup screen.
- **Your Hugging Face token** is saved to `server/.env` with owner-only
  permissions (`0600`). That file is ignored by git. Never commit it, and
  never paste it into an issue.

## How the local pieces are exposed

The development setup is meant for one person on their own machine:

- The processing service (FastAPI, port 8787) listens on `127.0.0.1` only,
  so other computers on your network can't reach it. It has no
  authentication, and its CORS settings allow requests only from the app at
  `http://localhost:3460` and `http://127.0.0.1:3460`.
- The Vite dev server (port 3460) adds two routes of its own:
  `GET /__service` returns the service's recent log lines, and
  `POST /__service/restart` restarts it. Don't expose the dev server beyond
  your machine, for example with `--host` or a tunnel.

Reports about any of these, and about how recordings or the token are
handled, are all in scope.

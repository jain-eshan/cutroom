"""Where this install keeps the things it writes.

Two kinds of file live under `server/`, and until now they were mixed
together: the ones that ship with the app and never change (Python source,
the YuNet face-detection model, the bundled diarisation weights), and the
ones created while someone uses it (saved episodes, downloaded model weights,
decision logs).

That distinction doesn't matter when you run `npm run dev` -- `server/` is
just a working directory. It matters a lot in the packaged desktop app,
where `server/` lives inside `Cutroom.app` itself:

  - macOS replaces the whole app bundle on update, so anything written
    inside it is destroyed every time. That costs the saved episodes, the
    token, and a multi-GB Python environment rebuild, on every release.
  - An app that writes inside its own bundle breaks its own code signature,
    which is exactly what notarisation checks. Signing can't ship while
    this is true.
  - A bundle installed for all users, or on a managed Mac, isn't writable
    by the person running it at all, so the app simply fails to start.

So `electron/main.mjs` passes `CUTROOM_DATA_DIR` (Electron's own
`app.getPath("userData")` -- `~/Library/Application Support/Cutroom` on
macOS, `%APPDATA%\\Cutroom` on Windows), the same way it already passes
`FFMPEG_BINARY`, and everything mutable hangs off that. Unset means dev, and
the old layout applies unchanged, so `npm run dev` and the test suite see
exactly what they always have.
"""

import os
from pathlib import Path

# Ships with the app: read-only in a packaged install. Python source and the
# small YuNet model that `package.json`'s extraResources copies in.
SERVER_DIR = Path(__file__).parent.parent

_configured = os.environ.get("CUTROOM_DATA_DIR")

# Written to while the app runs. Same place as SERVER_DIR in dev, which is
# what every path here used to be hardcoded to.
DATA_DIR = Path(_configured) if _configured else SERVER_DIR

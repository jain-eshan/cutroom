"""Which ffmpeg the pipeline runs.

Captions need an ffmpeg built with libass, and Homebrew's regular `ffmpeg`
formula is not -- its `ffmpeg-full` is, but that formula is keg-only, so it is
deliberately absent from PATH. Rather than asking anyone to reorder their
global PATH (which changes ffmpeg for everything else they run), point these
at the binary you want:

    FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg

server/.env is read at startup, so it belongs there.

Shared by every stage on purpose. When only the render honoured the override,
setting it fixed captions while audio extraction quietly kept using whatever
was on PATH -- a config that half-applies is worse than one that doesn't
exist, because it looks like it worked.
"""

import os

FFMPEG = os.environ.get("FFMPEG_BINARY", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BINARY", "ffprobe")

# Vendored from pyannote speaker-diarization-community-1

`config.yaml`, `segmentation/`, `embedding/` and `plda/` are copied
unmodified from
[pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1),
licensed **CC-BY-4.0**. `MODEL_CARD.md` is that repo's own README, kept as
the authors wrote it. CC-BY-4.0 permits redistribution with attribution,
which is what this file is; the credits screen in the app carries the same
notice where someone using Cutroom will actually see it.

Vendored rather than downloaded because the repo is gated: fetching it needs
a Hugging Face account, acceptance of the terms, and an access token. That
put a sign-up in front of the first edit anyone could make, for a 31MB
download of freely redistributable weights. The gate is Hugging Face's
distribution mechanism, not a licence term — the model card states the
pipeline is CC-BY-4.0 and will stay freely accessible.

The four files the pipeline loads are all inside this one repo:
`config.yaml` refers to `$model/segmentation`, `$model/embedding` and
`$model/plda`, each relative to itself. Nothing here reaches the network.

This is a reading of the licence, not legal advice. Confirm before a
commercial release.

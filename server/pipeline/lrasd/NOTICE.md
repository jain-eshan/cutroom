# Vendored from LR-ASD

`Model.py`, `Classifier.py` and `Encoder.py` are copied from
[LR-ASD](https://github.com/Junhua-Liao/LR-ASD) (MIT, Copyright (c) 2025 Liao
Junhua). `LICENSE` is theirs.

Copied rather than cloned at runtime so the pipeline has no network or git
dependency at import time, and so the exact model definition the weights were
validated against cannot drift underneath us.

**The only change** is in `Model.py`: `from model.Classifier import ...` and
`from model.Encoder import ...` became relative imports. Upstream expects its
repo root on `sys.path`, which would put a package as generically named as
`model` on the global import path — able to shadow anything else called that.
Everything else is byte-identical.

The weights (`pretrain_AVA.model`) are **not** vendored; they download on
first use into `server/.models/`, the same way the SFace face-recognition
model does.

Deliberately the AVA weights, not TalkSet: TalkSet's weights carry a
dataset licence restricted to non-commercial research, which would conflict
with this project being MIT and public. AVA-trained weights do not.

## What this changes

<!-- One or two sentences, in terms of what someone using Cutroom would notice. -->

## Why

<!-- The problem it solves. Link the issue or edge case (e.g. docs/EDGE_CASES.md A2) if there is one. -->

## How I checked it

<!-- Commands you ran and what you tried by hand. For UI changes, a screenshot. -->

- [ ] `npx tsc -b`, `npm run lint` and `npm test` pass
- [ ] `uv run --directory server pytest` passes (if the processing service changed)
- [ ] If framing changed: `src/features/timeline/regions.ts` and `server/pipeline/render.py` still agree, and so do `src/lib/faceCrop.ts` and `server/pipeline/framing.py`
- [ ] Docs updated where behaviour changed (`docs/STATUS.md`, `docs/FEATURES.md`, `docs/EDGE_CASES.md`)

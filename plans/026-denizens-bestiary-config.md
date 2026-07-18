# Plan 026 — Denizens bestiary + config (executable)

**Status:** PLAN (ready to execute)
**Spec:** `docs/superpowers/specs/2026-07-18-herald-denizens-design.md`
**Full task plan:** `docs/superpowers/plans/2026-07-18-denizens-p3-bestiary-config.md`
**Reconciliation (authoritative overrides):** `docs/superpowers/plans/2026-07-18-denizens-RECONCILE.md`

## One-liner

Config block `curtain.animation.denizens` with defaults + gate honoring
(`enabled`/`reducedMotion`), `validateDenizen` geometry/whitespace/frame-cap
verifier, and the remaining bestiary (crab, frog, snail, bird, bug) authored to
the canonical tiers with an all-species property test.

## Depends on

**Plan 025** (`denizens.mjs`/`denizens-data.mjs` must exist). Read RECONCILE
**R1** — every species authored to full ≤5×12, compact ≤3×8; the all-species
property test enforces it. **R5** — skip denizens on `classic`; byte-identical
when off.

## Execute

Follow `docs/superpowers/plans/2026-07-18-denizens-p3-bestiary-config.md` with
RECONCILE R1 + R5 applied. Use `superpowers:subagent-driven-development`. TDD
required. The eight-species art matrix (species × {full,compact} × 5 states ×
2–3 cels) is generated during execution and gated by `validateDenizen` + the
property test.

**STOP conditions:** `curtain.animation.enabled:false` or `reducedMotion:true`
→ byte-identical to baseline; every species passes `validateDenizen`; exact
geometry preserved; zero runtime deps. Verify with `node --test` + biome.

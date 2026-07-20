# Plan 025 — Denizens entities (executable)

**Status:** DONE (feat/denizens-p2; fox/cat/owl + seed funnel + mergeDenizen)
**Spec:** `docs/superpowers/specs/2026-07-18-herald-denizens-design.md`
**Full task plan:** `docs/superpowers/plans/2026-07-18-denizens-p2-denizens.md`
**Reconciliation (authoritative overrides):** `docs/superpowers/plans/2026-07-18-denizens-RECONCILE.md`

## One-liner

Per-session reactive entities: `lib/curtain/denizens.mjs`
(`speciesFor`/`seedFor`/`tierFor`/`denizenCel`) + `lib/curtain/denizens-data.mjs`
with fox+cat+owl authored across `full`/`compact` tiers and all five states; the
seed funnel `arm()` → `curtain-card-session.sh` → `cli.mjs` → `renderCard`; a
`mergeDenizen` whitespace-only composite step; responsive tier selection.

## Depends on

**Plan 024** (`driftField` + composite order must exist). Read the RECONCILE
addendum **R1** — use the canonical tier geometry (full ≤5×12, compact ≤3×8) and
`tierFor` thresholds there, NOT any dims in the phase-plan samples.

## Execute

Follow `docs/superpowers/plans/2026-07-18-denizens-p2-denizens.md` with
RECONCILE R1 (tier dims) + R5 (defensive config read) applied. Use
`superpowers:subagent-driven-development`. TDD required.

**STOP conditions:** art-sacred — no denizen cell may overwrite a non-space
base-art cell (property test); exact geometry (`renderCard` returns exactly
`rows` strings at every tier + resize); no `Math.random`/`Date.now` in render
(seed is injected); deterministic per session name; zero runtime deps. Verify
with `node --test` + biome on touched paths.

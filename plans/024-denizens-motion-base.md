# Plan 024 — Denizens motion base (executable)

**Status:** PLAN (ready to execute)
**Spec:** `docs/superpowers/specs/2026-07-18-herald-denizens-design.md`
**Full task plan:** `docs/superpowers/plans/2026-07-18-denizens-p1-motion-base.md`
**Reconciliation (authoritative overrides):** `docs/superpowers/plans/2026-07-18-denizens-RECONCILE.md`

## One-liner

Coherent particle engine (`driftField`) replacing the flickery `sparkRain`
(coordinate-only identity + continuous drift + age-ramp fade), ambient drifting
motes during WORKING, an upgraded rising DONE burst, and one-motion-language
hue/phase unification across the tmux segment, tmux tab glyph, and Claude bottom
bar (single `stateHue` source in `wash.mjs`). No entities, no new art.

## Depends on

Nothing — stands alone. `theatrics.seed` defaults to 0 until plan 025.

## Execute

Follow the full checklist in
`docs/superpowers/plans/2026-07-18-denizens-p1-motion-base.md`, applying the
RECONCILE overrides (esp. **R2** — Claude WORKING chip uses dark ink on amber,
not white). Use `superpowers:subagent-driven-development` or
`executing-plans`. TDD required.

**STOP conditions:** no `Math.random`/`Date.now` on any render path; `classic`
theme + motion-off must stay byte-identical to baseline; `wash.mjs` must not
import from `lib/status` (cycle); zero runtime deps. Verify each task with
`node --test` (`# fail 0`) and `./node_modules/.bin/biome check <touched>`.

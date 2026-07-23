# Denizens plans — reconciliation addendum (authoritative overrides)

**Date:** 2026-07-18. The plan-authoring reconcile pass was interrupted (session
limit); this file records the reconciliation decisions by hand. Where a phase
plan (P1/P2/P3) disagrees with this file, **this file wins.** Executors read it
alongside their phase plan.

## R1 — Canonical denizen tier geometry (supersedes P2 and P3 dims)

P2 authored fox/cat/owl at one tier size; P3's all-species property test assumed
another. Neither is canonical. Use these everywhere — `DENIZENS[*].tiers`,
`validateDenizen` caps, `tierFor` thresholds, and all authored art:

- **full tier:** frames ≤ **5 rows**, each line ≤ **12 cols**.
- **compact tier:** frames ≤ **3 rows**, each line ≤ **8 cols**.
- **`tierFor(rows, cols)`**: `none` if `rows < 5 || cols < 11`; else `compact`
  if `rows < 12 || cols < 26`; else `full`. (Full art needs 5×12 with margin →
  only offered when inner card ≥ 12×26; compact 3×8 → offered ≥ 5×11.)
- **`validateDenizen`** enforces: every frame ≤ its tier's rows/cols, each frame
  rectangular-safe (lines padded/truncated to declared cols by the renderer, but
  authored art must not EXCEED cols), ≤ 8 frames per pose, all 5 required poses
  (`working, done, needs, compacting, idle`) present for both tiers.

Any species already authored to different dims in a plan sample must be
re-authored to the above; the property test in P3 T3 is the guardrail.

## R2 — Claude bottom-bar WORKING chip contrast (supersedes P1 T7)

P1 T7 as drafted set amber(214) bg + white(231) fg ≈ 1.9:1 contrast — fails
WCAG. Override: WORKING chip = **bg `\x1b[48;5;214m` (amber) + fg
`\x1b[38;5;232m` (near-black ink)** + glyph `●`. This keeps the amber hue that
unifies with the curtain while staying readable. Update P1 T7's test assertion
to expect `48;5;214` **and** a dark fg (`38;5;232`), not `231`.

## R3 — Import-cycle guard (from P1 risk)

`side-effects.mjs` (lib/status) imports `stateHue` from `wash.mjs` (lib/curtain).
`wash.mjs` MUST NOT import anything from `lib/status`. If a cycle is unavoidable,
lift `stateHue` into a new leaf module `lib/curtain/hues.mjs` that both import.
Prefer keeping it in `wash.mjs` per the contract; only split on a real cycle.

## R4 — Accepted tradeoffs (no action, recorded)

- Ambient WORKING motes route the frame through the composite-recolor path,
  dropping per-line label bold (same tradeoff the existing DONE path already
  makes). Motion-off / `classic` stay byte-identical — the P1 T3 test proves it.
- The tmux tab glyph gains a `t` arg in P1 but live per-frame animation of the
  tab glyph stays deferred (`syncWindows` is event-driven). P1 ships the
  capability + unit test; live wiring is out of scope.
- The Claude bottom bar color/glyph-matches only; it does not animate mid-WORKING
  (event-only surface). Honest limitation, per spec.

## R5 — Phase gating recap

- P1 stands alone (no entities); `theatrics.seed` defaults to 0 until P2.
- P2 reads `theatrics.animCfg.denizens` defensively (absent ⇒ enabled/auto) so
  it works before P3's config lands.
- P3 skips denizens on `classic` and honors `denizens.enabled` + `reducedMotion`
  → byte-identical baseline (mirrors `selectEffects`).

# status-herald curtain theatrics + stage-manager CLI — design spec

**Date:** 2026-07-17 · **Status:** approved · **Phase:** 3 of the fleet UI campaign
**Branch base:** `design/herald-per-tab-curtain` (the live mainline — NOT `main`)
**Inputs (binding):** the status-herald section of `~/.cache/armory-research/UPGRADE-BRIEF.md`, the four audits `~/.cache/armory-research/repos/status-herald-*.md`, `~/.cache/armory-research/PLAYBOOK.md`.

## Prime directive
**The curtain is the beloved signature. Enhance with more theatrics — NEVER remove, never regress cover/reveal, never alter the glyph art itself (art is sacred).** The `classic` theme keeps its current static behavior as the regression baseline. The freshly merged lease/tracking fix (adapters + session.mjs classification) is off-limits for edits — read but do not modify classification logic.

## Act I — motion theatrics (child A)
1. **Stage-curtain draw** — cover: the curtain SLIDES SHUT over ~6–10 frames (panels closing from both edges to center, `░▒▓` density ramp); reveal: slides OPEN. Frame generation is a pure function `(cols, rows, t) → lines` (unit-testable, no I/O). Timing rides the EXISTING card repaint machinery (settleAfter/tick loop — discover it; do not build a new event loop). Full draw ≤ ~600ms. Config switch to disable motion entirely (follow the repo's existing config conventions; respect a reduced-motion option).
2. **DONE celebration** — on DONE: brief spark rain (golden/green sparks falling over 3–5 frames, upgrading the existing settle-spark machinery) + ONE soft green flash of the bar. Gentle, no strobe.
3. **NEEDS breathe** — while a session waits on the user: slow crimson breathe (dim⇄bright cycle) on the card border/bar, reusing the wash machinery. Explicitly no hard strobe (a11y).
4. Theme-aware: effects follow the active theme's palette; `classic` theme = static as today.

## Act II — stage-manager surfaces (child B, after A merges)
5. **`curtain inspect`** — replace dense key=value lines with a stage board: one mini-card per covered session (state glyph, lease counts by kind — shells/monitors/subagents, age); fzf drill-in to a single session's full detail when TTY + fzf (plain board otherwise).
6. **Unified `doctor`** — merge the split doctors into one health surface: banner + checklist (hooks wired? card loop alive? tmux options sane? settle RC first-class), fix-hint lines on failures. Follow herald's existing CLI conventions.
7. **`version`** — report the real package version (kill `version 0.0.0`).

## Acceptance
- Child A: pure frame-generator unit tests (shut/open sequences: first frame ≈ open, last ≈ closed, monotonic coverage; deterministic given (cols,rows,t)); effect-selection tests (DONE → spark-rain+flash, NEEDS → breathe, classic → none); existing suite stays green (403 pass; the 1 known env-bound integration failure `_curtain`-focus-cycle is pre-existing — not yours to fix, must not grow).
- Child B: inspect board renders fixture sessions correctly non-TTY; doctor exits 0/1 correctly with fixture states; version prints package.json version; suite green.
- Both: no edits to adapters/classification; no process restarts; art glyphs byte-identical; `node --test` green minus the known failure.

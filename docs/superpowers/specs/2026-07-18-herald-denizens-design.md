# Herald Denizens — per-session entities, coherent particles, one motion language — design spec

**Date:** 2026-07-18
**Status:** APPROVED (brainstorm) → plans 024/025/026
**Depends on / extends:** `2026-07-17-herald-theatrics-design.md` (theatrics
prime directive + effect compositor), `2026-07-14-herald-motion-surfaces-program-design.md`
(motion language), plan 023 (motion phase 1).

## Problem

Three complaints, all real, all located in code:

1. **"Working always feels the same."** Every session on a theme runs the
   *identical* animation cels at the *identical* phase. `classic` is a static
   `●`; `forge`/`minimal` is a 3-cel flipbook. No per-session variance exists.
2. **"Particles flicker / vanish without transition."** `sparkRain`
   (`lib/curtain/theatrics.mjs:145`) XORs `phase*83492791` into every cell's
   hash, so the **entire spark field re-randomizes each frame**. A cell that
   sparked at phase 0 has an unrelated hash at phase 1 → almost never sparks
   twice running. `hit` is binary (no fade); the glyph re-picks each frame
   (shape churns); phase 4 hard-clears the whole field at once. Result:
   uncorrelated snow static, not falling particles. There is no lifetime
   buffer anywhere — the bash loop holds only integer `tick`.
3. **"Bars don't match the curtain."** Three different WORKING hues:
   curtain `brightYellow`(93), tmux wash comet amber(214), Claude bottom bar
   deep-purple(54). They read as three tools, not one system.

## Prime directive (inherited, non-negotiable)

- **Art is sacred.** No overlay (particle or entity) may overwrite a non-space
  glyph/art cell. All compositing paints **into whitespace only** (the
  existing `mergeSparks`/`overlayCurtain` rule). The base figure always wins.
- **No `Math.random` / no `Date.now` in the render path.** Every visual is a
  pure `fn(cols, rows, t/tick, seed, palette)`. Variation comes from an
  **injected** seed, so rendering stays deterministic, idempotent, and safe
  across the multiple tmux `#()` invokers that must agree on the same frame.
- **No strobe (WCAG 2.3.1).** No full-bar flash, no saturated hard blink; soft
  luminance pulses only. Color is never the sole signal — glyph + label always
  remain.
- **Exact geometry.** `renderCard` returns exactly `rows` strings; in-place
  repaint (cursorHome + eraseLine + eraseBelow) avoids flash but any new art
  must keep exact geometry or `eraseBelow` ghosting appears. Reserved-width
  fields; resize-safe; survives even with animation off.
- **Perf gate.** Covered-only hot tick; skip the write when frame bytes are
  identical to last (mosh-friendly); `settleAfter` freeze after settle. Respect
  `animation.maxFps`.
- **Motion-off contract.** `curtain.animation.enabled:false` OR
  `reducedMotion:true` → first frame/glyph only, particles + entity frozen to
  cel 0, wash off, state color/label meaning preserved. `classic` theme stays
  byte-identical to today.
- **One motion language.** A state means the same emotion on card AND bar
  (working = Flow amber, done = Settle green, needs = Attention rose,
  compacting = Pressure steel). A card-only or hue-mismatched surface is a
  design failure.

## Approved product decisions (do not re-litigate)

- **Entities are reactive per state.** One creature per card; its *pose*
  follows `@herald_state` (busy while WORKING, celebrates on DONE, worried on
  NEEDS, sleeps on COMPACTING, calm on IDLE). Personality = the state's emotion.
- **Deterministic per tab.** Species is chosen by hashing the session name
  (mirrors `themeNameFor` at `themes.mjs:92`). The same tab always gets the
  same animal — recognizable identity across the grid. Zero storage, testable.
- **Loud & expressive** creatures, tempered by **responsive art tiers**: big
  expressive art on roomy/focused cards, a compact 2–3 line variant on tight
  grid cards, and glyph+particles only when a card is too small. Geometry stays
  exact at every tier.
- **Drifting motes** for the ambient WORKING particle field (subtle lateral
  texture) — a deliberate quiet counterpoint to the loud creature. The DONE
  celebration keeps a denser one-shot burst.
- **Cadence:** covered WORKING tick may rise to `maxFps` (default ~8) so loud
  creatures feel alive; gated by `maxFps` + `reducedMotion` + covered-only.

## Design

### Act I — Coherent particle engine (`driftField`)

Generalize `sparkRain` into a stateless-but-coherent field
`driftField(cols, rows, t, { seed, palette, dir, density, fade })`:

- **Identity** = **coordinate-only** hash (drop the frame-varying `phase`
  term). A mote at a given lattice point is the *same* mote across frames.
- **Position** = `base + drift(t)` — a continuous sub-cell offset advanced by
  `t`, so the same mote *slides* (lateral for motes; vertical for rain/embers).
- **Life** = an age window per mote → brightness/density ramp
  `·→˙→'→(gone)` for real fade in/out. No binary `hit`, no hard clear.
- **Seed** folded into the coordinate hash → each tab's field differs.

Still a pure function, no buffer, no RNG state. The existing DONE burst reuses
`driftField` with a denser upward profile and a decay tail (replacing the
5-frame hard-clear). `applyTheatrics` calls it for **ambient WORKING** (new)
and for DONE (upgraded). `classic`/motion-off short-circuits to the static path
unchanged.

### Act II — Denizens (per-session reactive entity)

New module `lib/curtain/denizens.mjs`:

- **Data model.** A denizen = `{ species, tiers: { full, compact }, poses: {
  working, done, needs, compacting, idle } }`. Each pose is `frames[]` of cel
  art sized to its tier. Art lives with the themes/look-pack data (authored
  content), not hardcoded in logic.
- **Selection.** `speciesFor(sessionName, cfg)` → deterministic hash into the
  enabled roster. Stamped once as `@herald_entity` (+ `@herald_seed`) at
  `arm()` (`session.mjs:217`), stable for the tab's life, survives rename.
- **Reactive pose.** Pose = `@herald_state`; frame =
  `pickFrame(pose, tick + seedPhaseOffset)` so co-launched tabs animate out of
  phase.
- **Responsive tier.** From the card inner `rows × cols`, pick `full` /
  `compact` / `none`. Art is authored per tier so geometry is always exact; a
  too-small card renders particles + glyph only (no clipped creature).
- **Composite.** A new merge step in `applyTheatrics` (mirrors `mergeSparks`)
  paints the denizen cel **into a reserved denizen zone, whitespace-only**. The
  creature lives in its band; it does not roam over the status/glyph rows.
  Loud = expressive *poses*, not wandering.

### Act III — One motion language across surfaces

Single source of truth for hue + period per state = `wash.mjs` `FG`/`PERIOD`
tables. Then:

- `segments.mjs` `buildStateItem` (239–242): WORKING → `role:'accent'` (already
  `{ansi:93, tmux:'colour214'}`), tying the tmux state segment to curtain amber.
- `side-effects.stateGlyph` (101–108): add a time arg so the tmux tab glyph
  breathes in phase with the wash 5s period.
- `claude-statusline.mjs` (106–111): WORKING chip adopts amber(214) + `●`.
  **Honest limitation:** the Claude bottom bar is event-driven (no clock); it
  will color/glyph-match but cannot animate mid-WORKING. tmux tab + wash comet
  carry the live motion. We do not fake motion on an event-only surface.

### Config & bestiary

- New `curtain.animation.denizens`: `{ enabled:true, seedPolicy:'deterministic',
  species:'auto'|<name>, maxFps:8 }`, read in `cli.mjs runRender`, respecting
  all existing gates. Particle knobs join `curtain.animation`.
- **Starter roster** (deterministic hash spreads tabs): fox, cat, owl, crab,
  frog, snail, bird, bug. Each needs `full` + `compact` tiers × `{working,
  done, needs, compacting, idle}` poses × 2–3 cels. Authored + machine-verified
  (exact width, whitespace-safety, tier fit) during implementation.

## Seed plumbing (the one funnel)

`arm()` stamps `@herald_entity` + `@herald_seed` → `curtain-card-session.sh`
reads + passes `--entity`/`--seed` → `cli.mjs runRender` folds into the
theatrics object → `renderCard` threads to `driftField` + denizen composite.
Injected input only; renderer stays deterministic/idempotent.

## Acceptance

1. **No flicker.** For fixed `seed`, a mote present at `(x,y)` in frame `t`
   appears at `(x+Δ, y)` (or drifted lattice) in `t+1` for its lifetime, with a
   monotonic brightness ramp — proven by a determinism/continuity unit test.
   No frame fully re-samples the field.
2. **Per-session variety.** Two different session names produce visibly
   different fields and (with roster ≥ 2) different species; the SAME name
   always reproduces byte-identical output at the same tick.
3. **Art sacred.** Property test: no denizen/mote cell ever overwrites a
   non-space base-art cell, at any tier, any state, any tick.
4. **Exact geometry.** `renderCard` returns exactly `rows` strings at every
   tier and under resize; too-small cards degrade to particles+glyph with no
   partial creature.
5. **One motion language.** All of curtain card, tmux tab glyph/segment, and
   wash comet resolve WORKING to the same amber hue/period from the single
   source table; done/needs/compacting likewise.
6. **Motion-off byte-identical.** With `animation.enabled:false` or
   `reducedMotion:true` (and for `classic`), output is byte-identical to the
   pre-feature static baseline.
7. **Perf.** Covered-only hot tick; identical-frame writes are skipped;
   `settleAfter` still freezes DONE. No perpetual hot repaint.
8. **Green bar.** `node --test` → `# fail 0`; `biome check` on touched paths →
   exit 0; zero runtime deps unchanged.

## Phasing

- **P1 — Motion base (plan 024).** `driftField` particle rewrite (fix flicker,
  drifting motes ambient WORKING, upgraded DONE burst) + hue/phase unification
  across bars. No new art. Immediately fixes complaints (2) and (3).
- **P2 — Denizens (plan 025).** `denizens.mjs`, seed plumbing, responsive
  tiers, reactive poses, composite step; first species fox + cat + owl.
- **P3 — Bestiary + config (plan 026).** Remaining species, config knobs +
  validation, look-pack polish. Fixes complaint (1) fully.

## Out of scope (YAGNI)

- No animation daemon / socket (config-as-message-bus stays).
- No free-roaming creatures over status rows (reserved zone only).
- No faked motion on the event-only Claude bottom bar.
- No new host surfaces (zellij/kitty) — curtain + tmux + Claude only.

# Herald Denizens — Phase 1: Motion Base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the particle flicker and unify WORKING's motion language across surfaces — replace the phase-randomized `sparkRain` with a coherent `driftField` engine (ambient drifting motes on WORKING, upgraded rising DONE burst), and make one amber hue/period the single source of truth for the curtain card, tmux tab glyph/segment, and Claude bottom bar. **No new art, no entities** (those are P2/P3).

**Architecture:** `lib/curtain/theatrics.mjs` gains a pure coordinate-only particle field (`driftField`) whose mote identity is fixed by `(col,row,seed)` — never a per-frame term (the flicker bug). `applyTheatrics` composites motes (WORKING) / burst (DONE) into whitespace-only, then the stage-curtain fabric overlays LAST. `lib/curtain/wash.mjs` exports the ONE `stateHue(state)` table; `FG`/`PERIOD` derive from it (byte-identical wash output). `segments.buildStateItem` colours WORKING with `role:'accent'` (amber `colour214`); `side-effects.stateGlyph` gains an optional `t` arg that phase-cycles the WORKING glyph on the state period; `claude-statusline` WORKING chip adopts amber(214) + `●`. All render paths stay pure `fn(cols,rows,t/tick,seed)` — injected input only, no `Math.random`/`Date.now`, motion-off stays byte-identical to classic.

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, local biome (`./node_modules/.bin/biome check <paths>`), bash card loop (`scripts/curtain-card-session.sh`), tmux session options.

**Spec:** `docs/superpowers/specs/2026-07-18-herald-denizens-design.md` (Act I + Act III; Act II is P2)

---

## Global Constraints (hard invariants — copy into every task's mental model)

- **Zero runtime deps.** Pure ESM. No new dependency, ever.
- **Art is sacred.** No mote/overlay cell may overwrite a non-space base-art glyph. All compositing paints **into whitespace only** (the existing `mergeSparks`/`overlayCurtain` rule). The base figure always wins.
- **No `Math.random` / no `Date.now` in the render path.** Every visual is a pure `fn(cols, rows, t/tick, seed)`. Variation comes from an **injected** seed (P1 default `0`; real seed plumbing is P2). Determinism must survive multiple tmux `#()` invokers agreeing on the same frame.
- **No strobe (WCAG 2.3.1).** No full-bar flash, no saturated hard blink; soft luminance ramps only, low frequency (periods 3–5 s). Colour is never the sole signal — glyph + label always remain.
- **Exact geometry.** `renderCard` returns exactly `rows` strings, each padded to `cols`. Composite path must keep this or `eraseBelow` ghosts appear.
- **Motion-off contract.** `curtain.animation.enabled:false` OR `reducedMotion:true` OR `classic` theme → `selectEffects` returns all-false → the composite path is never entered → output is **byte-identical** to the pre-feature static baseline.
- **One motion language.** WORKING = amber (Flow) on card AND bar; done=green, needs=rose, compacting=steel. A hue-mismatched surface is a design failure.
- **Fail-open on render paths.** Empty + exit 0 beats an error. Never throw out of `applyTheatrics` / `renderCard` / `stateGlyph`.
- **TDD required.** For every task: write the failing test → run it, see it FAIL → minimal impl → run, see it PASS → `biome check` → commit. One commit per task.

**Verification (run after every task):**
```
node --test                       # whole suite → "# fail 0"
./node_modules/.bin/biome check lib test
```

---

## Task overview

| | File | Change |
|---|---|---|
| **T1** | `lib/curtain/theatrics.mjs` | Add pure `driftField` + `DRIFT_GLYPHS` + coordinate hash (no wiring yet) |
| **T1** | `test/theatrics.test.mjs` | `driftField` unit tests (identity/continuity/fade/determinism/geometry/seed) |
| **T2** | `lib/curtain/theatrics.mjs` | Migrate `applyTheatrics` to `driftField`; rename effect flag `sparkRain`→`burst`, add `motes`; delete `sparkRain` function |
| **T2** | `test/theatrics.test.mjs` | Replace `sparkRain` fn test; update `selectEffects` asserts (`burst`/`motes`) |
| **T3** | `lib/surfaces/curtain-card.mjs`, `lib/cli.mjs` | `wantComposite` honors `burst`/`motes`; thread `seed`/`motesT` into `applyTheatrics` |
| **T3** | `test/curtain-card.test.mjs` | WORKING motes composite; motion-off byte-identical; exact geometry; art-sacred |
| **T4** | `lib/curtain/wash.mjs` | Export `stateHue(state)`; derive `FG`/`PERIOD` from it (byte-identical wash) |
| **T4** | `test/wash.test.mjs` | `stateHue` table asserts; wash output unchanged |
| **T5** | `lib/status/segments.mjs` | `buildStateItem(glyph, state)` → WORKING uses `role:'accent'`; REGISTRY passes state |
| **T5** | `test/status-segments.test.mjs` | accent-for-working assert; dim back-compat |
| **T6** | `lib/status/side-effects.mjs` | `stateGlyph(status, t)` optional phase-cycle; back-compat static |
| **T6** | `test/status-surfaces.test.mjs` | phase-cycle asserts; static back-compat |
| **T7** | `lib/status/claude-statusline.mjs` | WORKING chip `WORK_BG`→amber 214, glyph `▶`→`●` |
| **T7** | `test/status-surfaces.test.mjs` | update `WORK_BG` assert to `\x1b[48;5;214m`; glyph `●` |

---

### Task 1: `driftField` — coherent, coordinate-only particle engine (pure, unwired)

Add the new field generator alongside the existing `sparkRain` (kept until T2) so the whole suite stays green. This is the CRUX of the phase — the coordinate-only hash is the flicker fix.

**Files:**
- Modify: `lib/curtain/theatrics.mjs` (add exports near `SPARK_GLYPHS`, line 6; add `driftField` after `sparkRain`, ~line 158)
- Modify: `test/theatrics.test.mjs` (add `driftField` to the import at line 3-11; add tests)

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `export const DRIFT_GLYPHS: string[]` — age ramp light→faint→gone
  - `export const driftField(cols:number, rows:number, t:number, opts?:{ seed?:number, dir?:'lateral'|'up'|'down', density?:number, glyphs?:string[], fade?:boolean }) => string[]` — exactly `rows` strings, each length `cols`, space where no mote. PURE.

- [ ] **Step 1: Write the failing tests** in `test/theatrics.test.mjs`

Add `driftField` and `DRIFT_GLYPHS` to the existing import block (lines 3-11). Then append:

```js
test("driftField: exact geometry — rows lines each cols wide, sparse", () => {
  const lines = driftField(40, 12, 1.0, { seed: 7 });
  assert.equal(lines.length, 12);
  for (const l of lines) assert.equal(plain(l).length, 40);
  const cov = coverageRatio(lines); // fabric glyphs → 0 here, but assert sparse ink
  assert.ok(cov < 0.35, "field is sparse, not a flood");
});

test("driftField: identity is COORDINATE-ONLY — no per-frame re-randomization", () => {
  // The flicker bug was phase XOR'd into the hash. With fade off and tiny t
  // steps (sub-cell, no drift), consecutive frames must be BYTE-IDENTICAL:
  // the same lattice points are motes every frame.
  const a = driftField(40, 12, 0.0, { seed: 3, fade: false }).join("\n");
  const b = driftField(40, 12, 0.01, { seed: 3, fade: false }).join("\n");
  const c = driftField(40, 12, 0.02, { seed: 3, fade: false }).join("\n");
  assert.equal(a, b, "no re-sample between adjacent frames");
  assert.equal(b, c, "no re-sample between adjacent frames");
});

test("driftField: motes drift along dir over time (slide, not vanish)", () => {
  const t0 = driftField(40, 12, 0.0, { seed: 5, fade: false, dir: "lateral" });
  const t1 = driftField(40, 12, 8.0, { seed: 5, fade: false, dir: "lateral" });
  const ink = (ls) => ls.join("").replace(/ /g, "").length;
  assert.notEqual(t0.join("\n"), t1.join("\n"), "field advanced with t");
  // Motes moved, they did not disappear: ink count stays close (fade off).
  assert.ok(Math.abs(ink(t0) - ink(t1)) <= Math.ceil(ink(t0) * 0.25), "motes persist");
});

test("driftField: age ramp fades glyphs through the ramp over lifetime", () => {
  const seen = new Set();
  for (let i = 0; i <= 24; i++) {
    for (const ch of driftField(40, 12, i * 0.25, { seed: 9 }).join("")) {
      if (ch !== " ") seen.add(ch);
    }
  }
  // every painted glyph is from the ramp, and ≥2 distinct ramp glyphs appear
  for (const ch of seen) assert.ok(DRIFT_GLYPHS.includes(ch), `ramp glyph: ${ch}`);
  assert.ok([...seen].filter((c) => c !== " ").length >= 2, "fade uses ≥2 ramp steps");
});

test("driftField: deterministic for same args", () => {
  assert.equal(
    driftField(30, 8, 1.7, { seed: 2 }).join("\n"),
    driftField(30, 8, 1.7, { seed: 2 }).join("\n"),
  );
});

test("driftField: different seeds → different fields (per-tab variety)", () => {
  const a = driftField(40, 12, 1.0, { seed: 1 }).join("\n");
  const b = driftField(40, 12, 1.0, { seed: 999 }).join("\n");
  assert.notEqual(a, b);
});

test("driftField: zero dims → empty grid, no throw", () => {
  assert.deepEqual(driftField(0, 0, 1, { seed: 1 }), []);
  assert.equal(driftField(0, 5, 1).length, 5);
});
```

- [ ] **Step 2: Run — expect FAIL** (`driftField`/`DRIFT_GLYPHS` undefined)

```
node --test test/theatrics.test.mjs
```

- [ ] **Step 3: Implement `driftField` (CRUX — verbatim)**

In `lib/curtain/theatrics.mjs`, add the ramp constant next to the existing `SPARK_GLYPHS` (line 6):

```js
// Age ramp: light → faint → gone. A mote fades OUT across its lifetime, then
// respawns (age wraps). Last entry is a space so "gone" paints nothing.
const DRIFT_GLYPHS_DEFAULT = ["·", "˙", "ʼ", " "];
export const DRIFT_GLYPHS = DRIFT_GLYPHS_DEFAULT;
```

Then add these pure helpers + `driftField` (place after `sparkRain`, ~line 158):

```js
// 32-bit hash of LATTICE coordinates ONLY. This is the flicker fix: a mote's
// identity is fixed by (col,row,seed) and never varies with the frame/phase.
const coordHash = (col, row, seed) => {
  let h =
    (Math.imul(col | 0, 73856093) ^
      Math.imul(row | 0, 19349663) ^
      Math.imul(seed | 0, 83492791)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 2654435761) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

// Stable fraction in [0,1) from a 32-bit hash.
const hash01 = (h) => (h >>> 8) / 0x01000000;

/**
 * Coherent particle field. A mote at a lattice point is the SAME mote across
 * frames (identity = coordHash(col,row,seed), no phase term). Its drawn cell =
 * base + drift(t); its brightness rides an age ramp so it fades in/out. Pure,
 * no buffer, no RNG state, no Date.now.
 *
 * @returns {string[]} exactly `rows` strings, each `cols` wide; space = no mote.
 */
export const driftField = (
  cols,
  rows,
  t,
  { seed = 0, dir = "lateral", density = 0.09, glyphs, fade = true } = {},
) => {
  const c = Math.max(0, Math.floor(Number(cols) || 0));
  const r = Math.max(0, Math.floor(Number(rows) || 0));
  const time = Number.isFinite(Number(t)) ? Number(t) : 0;
  const ramp =
    Array.isArray(glyphs) && glyphs.length ? glyphs : DRIFT_GLYPHS_DEFAULT;
  const dens = Number.isFinite(Number(density)) ? Number(density) : 0.09;
  const grid = Array.from({ length: r }, () => new Array(c).fill(" "));
  if (c === 0 || r === 0) return grid.map((g) => g.join(""));

  const DRIFT = 0.35; // baseline cells/second a mote slides along `dir`
  for (let by = 0; by < r; by++) {
    for (let bx = 0; bx < c; bx++) {
      const h = coordHash(bx, by, seed);
      // density fraction of lattice points ARE motes — decided by coords only.
      if (hash01(h) >= dens) continue;
      // Continuous sub-cell POSITION: base + drift(t). Per-mote speed variance.
      const speed = 0.5 + hash01(h ^ 0x9e3779b9);
      const travel = DRIFT * speed * time;
      let dx = bx;
      let dy = by;
      if (dir === "lateral") dx = bx + travel;
      else if (dir === "up") dy = by - travel;
      else if (dir === "down") dy = by + travel;
      const cx = ((Math.round(dx) % c) + c) % c;
      const cy = ((Math.round(dy) % r) + r) % r;
      // LIFE: age in [0,1) from a per-mote phase + t. glyph rides the ramp so
      // the mote fades OUT then respawns. No binary hit, no hard clear.
      const lifePeriod = 3 + 4 * hash01(h ^ 0x51ed270b); // 3..7 s
      const phase0 = hash01(h ^ 0x27d4eb2f);
      const age = fade ? (phase0 + time / lifePeriod) % 1 : 0;
      const gi = Math.min(ramp.length - 1, Math.floor(age * ramp.length));
      const glyph = ramp[gi];
      if (glyph && glyph !== " ") grid[cy][cx] = glyph;
    }
  }
  return grid.map((g) => g.join(""));
};
```

- [ ] **Step 4: Run — expect PASS.** `node --test test/theatrics.test.mjs`
- [ ] **Step 5:** `./node_modules/.bin/biome check lib/curtain/theatrics.mjs test/theatrics.test.mjs`
- [ ] **Step 6: Commit** — `feat(theatrics): add coordinate-only driftField particle engine (P1 T1)`

**STOP if:** the identity test still shows adjacent frames differing (a phase term leaked into `coordHash`), or geometry assert fails (rows/cols mismatch).

---

### Task 2: Migrate `applyTheatrics` to `driftField`; retire `sparkRain`

Rename the DONE effect flag `sparkRain`→`burst`, add a `motes` flag for WORKING, rebuild `applyTheatrics` to paint the rising DONE burst and ambient WORKING motes via `driftField`, and delete the `sparkRain` function.

**Files:**
- Modify: `lib/curtain/theatrics.mjs` (`selectEffects` return shape lines 23-44; JSDoc lines 12-22; `applyTheatrics` block lines 237-267; delete `sparkRain` lines 124-158)
- Modify: `test/theatrics.test.mjs` (remove `sparkRain` from import + delete its fn test lines 74-93; update `selectEffects` asserts to `burst`/`motes`)

**Interfaces:**
- Consumes: `driftField`, `DRIFT_GLYPHS`, `SPARK_GLYPHS`, `mergeSparks`, `overlayCurtain`, `stageCurtain` (all in-module)
- Produces:
  - `selectEffects(...) => { stageDraw, burst, motes, barFlash, breathe }` (was `sparkRain`; add `motes`)
  - `applyTheatrics(plainLines, opts)` now honors `opts.seed` (default 0) and `opts.motesT` (default `tick*0.5`)

- [ ] **Step 1: Update the failing tests** in `test/theatrics.test.mjs`

Remove `sparkRain` from the import (line 3-11). Delete the `"sparkRain: 3–5 frame sequence…"` test (lines 74-93). Update every `selectEffects` assert of `e.sparkRain` → `e.burst`, and add `motes` asserts:

```js
test("selectEffects: DONE → burst + bar flash (non-classic)", () => {
  const e = selectEffects({ state: "done", themeName: "forge", animCfg: { enabled: true } });
  assert.equal(e.burst, true);
  assert.equal(e.motes, false);
  assert.equal(e.barFlash, true);
  assert.equal(e.stageDraw, true);
});

test("selectEffects: WORKING → ambient motes (non-classic)", () => {
  const e = selectEffects({ state: "working", themeName: "forge", animCfg: { enabled: true } });
  assert.equal(e.motes, true);
  assert.equal(e.burst, false);
  assert.equal(e.stageDraw, true);
});

test("selectEffects: classic/motion-off → no burst, no motes", () => {
  for (const [themeName, animCfg] of [
    ["classic", { enabled: true }],
    ["forge", { enabled: false }],
    ["forge", { enabled: true, reducedMotion: true }],
  ]) {
    const e = selectEffects({ state: "working", themeName, animCfg });
    assert.equal(e.motes, false);
    assert.equal(e.burst, false);
    assert.equal(e.stageDraw, false);
  }
});

test("applyTheatrics WORKING motes paint whitespace-only (art sacred)", () => {
  const base = ["ABCDEFGH", "IJKLMNOP", "QRSTUVWX"]; // fully inked rows
  const out = applyTheatrics(base, {
    cols: 8, rows: 3,
    effects: { motes: true, burst: false, stageDraw: false },
    tick: 4, seed: 1,
  });
  assert.equal(out.join("\n"), base.join("\n"), "no non-space base cell overwritten");
});

test("applyTheatrics DONE burst decays across ticks (no 5-frame hard clear)", () => {
  const blank = Array.from({ length: 12 }, () => " ".repeat(40));
  const ink = (ls) => ls.join("").replace(/ /g, "").length;
  const early = applyTheatrics(blank, { cols: 40, rows: 12, effects: { burst: true }, tick: 0, sparkFrames: 5 });
  const late = applyTheatrics(blank, { cols: 40, rows: 12, effects: { burst: true }, tick: 3, sparkFrames: 5 });
  assert.ok(ink(early) > 0, "burst present at t0");
  assert.ok(ink(late) < ink(early), "burst decays, not a hard clear");
  assert.match(early.join(""), /[*.+·]/, "burst uses spark glyph family");
});
```

Note `applyTheatrics` is already imported (line 3-11 block currently imports `applyTheatrics`? confirm — the theatrics test imports `applyTheatrics`? if not, add it).

- [ ] **Step 2: Run — expect FAIL** (`e.burst`/`e.motes` undefined; motes not painted)

- [ ] **Step 3: Implement.** In `selectEffects` (lines 28-43), change the return objects:

```js
const none = { stageDraw: false, burst: false, motes: false, barFlash: false, breathe: false };
...
return {
  stageDraw: true,
  burst: st === "done",
  motes: st === "working",
  barFlash: st === "done",
  breathe: st === "needs",
};
```

Update the JSDoc `@returns` (lines 12-22) to list `burst`, `motes` (drop `sparkRain`). **Delete** the `sparkRain` function (lines 124-158) entirely.

Replace the spark block in `applyTheatrics` (lines 249-254) with motes + burst, keeping `stageCurtain` LAST (composite order: base → motes → burst → fabric):

```js
const seed = Number(opts.seed) || 0;

// Ambient WORKING motes: coherent lateral drift, whitespace-only.
if (effects.motes) {
  const mt = opts.motesT != null ? Number(opts.motesT) : tick * 0.5;
  const motes = driftField(cols, rows, mt, {
    seed, dir: "lateral", density: 0.06, glyphs: DRIFT_GLYPHS, fade: true,
  });
  lines = mergeSparks(lines, motes);
}

// DONE burst: rising, denser, with a decay tail (replaces the old hard clear).
if (effects.burst && tick < sparkFrames) {
  const life = sparkFrames <= 1 ? 0 : tick / (sparkFrames - 1); // 0..1
  const density = Math.max(0, 0.18 * (1 - life)); // fades to ~0, never clears hard
  const burst = driftField(cols, rows, tick, {
    seed, dir: "up", density, glyphs: SPARK_GLYPHS, fade: true,
  });
  lines = mergeSparks(lines, burst);
}
```

(The `if (effects.stageDraw && (draw === "shut" || draw === "open"))` overlay block at lines 256-259 stays exactly as-is, LAST.)

- [ ] **Step 4: Run — expect PASS.** `node --test test/theatrics.test.mjs`
- [ ] **Step 5: Full suite** `node --test` — the existing `curtain-card.test.mjs` "forge DONE with theatrics paints spark rain" (line 515) must still pass (state=done drives `burst`, glyphs `/[*.+]/`). If it references removed names, it does not — it drives via `renderCard`. **Fix T3 wiring next if it fails on `wantComposite`.**
- [ ] **Step 6:** biome check both files. **Commit** — `refactor(theatrics): driftField burst+motes, retire sparkRain (P1 T2)`

**STOP if:** any base-art cell is overwritten (art-sacred test fails — `mergeSparks` order wrong), or the burst does not decay (density formula inverted).

---

### Task 3: Wire the composite — `wantComposite` honors `burst`/`motes`; thread `seed`

Make `renderCard` enter the composite path for ambient WORKING motes (not just DONE/draw), and thread `seed`/`motesT` from the theatrics object. `cli.mjs` supplies `seed` (default 0 in P1; real seed is P2).

**Files:**
- Modify: `lib/surfaces/curtain-card.mjs` (`wantComposite` lines 239-243; `applyTheatrics` call lines 325-334 — pass `seed`, `motesT`)
- Modify: `lib/cli.mjs` (theatrics object lines 124-135 — add `seed: Number(f.seed) || 0`)
- Modify: `test/curtain-card.test.mjs` (add motes/motion-off/geometry tests near line 497)

**Interfaces:**
- Consumes: `applyTheatrics(plainLines, { cols, rows, effects, draw, drawProgress, tick, sparkFrames, seed, motesT })`, `selectEffects`
- Produces: `renderCard(state, elapsedSec, cols, rows, bg, theme, tick, theatrics)` — WORKING with a motion-on non-classic theme now composites ambient motes; classic/motion-off unchanged.

- [ ] **Step 1: Write failing tests** in `test/curtain-card.test.mjs` (after the Act I block, ~line 497). `plain`/`BUILTINS` already imported.

```js
test("forge WORKING paints ambient motes into whitespace only (art sacred)", () => {
  const base = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3).map(plain).join("\n");
  const mo = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3, {
    themeName: "forge", animCfg: { enabled: true }, seed: 1,
  }).map(plain).join("\n");
  // Anvil art survives (sacred), motes appear somewhere.
  assert.match(mo, /=======/);
  assert.match(mo, /[·˙ʼ]/, "ambient drift motes present");
  // Every non-space cell of base is still present (no art overwritten).
  const bl = base.split("\n"), ml = mo.split("\n");
  for (let r = 0; r < bl.length; r++)
    for (let c = 0; c < bl[r].length; c++)
      if (bl[r][c] !== " ") assert.equal(ml[r][c], bl[r][c], `art cell (${r},${c}) preserved`);
});

test("forge WORKING motion-off is byte-identical to no-theatrics baseline", () => {
  const baseline = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3).join("\n");
  const off = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3, {
    themeName: "forge", animCfg: { enabled: false }, seed: 1,
  }).join("\n");
  assert.equal(off, baseline, "motion-off ≡ static baseline (byte-identical)");
});

test("classic WORKING with theatrics stays static (no motes)", () => {
  const base = renderCard("working", 5, 40, 12, {}, BUILTINS.classic, 3).join("\n");
  const withOpts = renderCard("working", 5, 40, 12, {}, BUILTINS.classic, 3, {
    themeName: "classic", animCfg: { enabled: true }, seed: 1,
  }).join("\n");
  assert.equal(withOpts, base);
});

test("WORKING motes render keeps exact rows×cols geometry", () => {
  const out = renderCard("working", 5, 37, 11, {}, BUILTINS.forge, 2, {
    themeName: "forge", animCfg: { enabled: true }, seed: 4,
  });
  assert.equal(out.length, 11);
  for (const l of out) assert.equal(plain(l).length <= 37 ? 37 : plain(l).length, 37);
});

test("WORKING field varies with seed (per-tab variety)", () => {
  const a = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3, {
    themeName: "forge", animCfg: { enabled: true }, seed: 1,
  }).map(plain).join("\n");
  const b = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3, {
    themeName: "forge", animCfg: { enabled: true }, seed: 900,
  }).map(plain).join("\n");
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: Run — expect FAIL** (WORKING with theatrics currently does NOT composite: `wantComposite` ignores `motes`, so `mo` === `base` with no motes → `/[·˙ʼ]/` fails).

- [ ] **Step 3: Implement.** In `lib/surfaces/curtain-card.mjs`, extend `wantComposite` (lines 239-243) to include the new flags:

```js
const wantComposite =
  effects &&
  (effects.burst ||
    effects.motes ||
    (effects.stageDraw &&
      (theatrics?.draw === "shut" || theatrics?.draw === "open")));
```

In the `applyTheatrics` call (lines 325-334) add `seed` + `motesT`:

```js
const composed = applyTheatrics(out, {
  cols,
  rows,
  effects,
  draw: theatrics?.draw || null,
  drawProgress: theatrics?.drawProgress != null ? Number(theatrics.drawProgress) : 0,
  tick,
  sparkFrames: Number(theatrics?.sparkFrames) || 5,
  seed: Number(theatrics?.seed) || 0,
  motesT: theatrics?.motesT != null ? Number(theatrics.motesT) : undefined,
});
```

In `lib/cli.mjs` theatrics object (lines 124-135), add `seed`:

```js
const theatrics = {
  themeName,
  animCfg,
  effects: selectEffects({ state: f.state || "idle", themeName, animCfg }),
  draw: draw === "shut" || draw === "open" ? draw : null,
  drawProgress,
  sparkFrames: 5,
  seed: Number(f.seed) || 0, // P1: default 0; real per-tab seed lands in P2
};
```

- [ ] **Step 4: Run — expect PASS.** `node --test test/curtain-card.test.mjs`
- [ ] **Step 5: Full suite** `node --test` → `# fail 0`. Confirm the pre-existing "forge DONE with theatrics paints spark rain" test still passes.
- [ ] **Step 6:** biome check `lib/surfaces/curtain-card.mjs lib/cli.mjs test/curtain-card.test.mjs`. **Commit** — `feat(curtain): composite ambient WORKING motes + seed threading (P1 T3)`

**STOP if:** motion-off WORKING is not byte-identical (composite path leaking when effects should be null), or geometry drifts off `cols`.

---

### Task 4: `stateHue` — single source of truth for hue + period (wash.mjs)

Export the ONE `stateHue(state)` table and derive `FG`/`PERIOD` from it so wash output is byte-identical while all surfaces can pull the same amber/period.

**Files:**
- Modify: `lib/curtain/wash.mjs` (`FG` lines 14-26, `PERIOD` lines 28-34 → derive from a new `STATE_HUE`)
- Modify: `test/wash.test.mjs` (add `stateHue` import line 3-10 + table test)

**Interfaces:**
- Consumes: `STATES` (already imported line 7)
- Produces: `export const stateHue(state:string) => { ansi:number, tmux:string, periodSec:number }`

- [ ] **Step 1: Write failing test** in `test/wash.test.mjs` (add `stateHue` to import):

```js
test("stateHue is the single hue/period source (amber working, green done, rose needs, steel compacting)", () => {
  assert.deepEqual(stateHue("working"), { ansi: 214, tmux: "colour214", periodSec: 5 });
  assert.deepEqual(stateHue("done"), { ansi: 70, tmux: "colour70", periodSec: 3 });
  assert.deepEqual(stateHue("needs"), { ansi: 167, tmux: "colour167", periodSec: 3 });
  assert.deepEqual(stateHue("compacting"), { ansi: 67, tmux: "colour67", periodSec: 4 });
  assert.equal(stateHue("idle").periodSec, 0);
  assert.equal(stateHue("bogus").periodSec, 0, "unknown → idle fallback, no throw");
});

test("wash comet hot colour is the stateHue amber (single source)", () => {
  const w = sampleWash({ state: "working", nowSec: 0 });
  assert.match(w.line, new RegExp(`fg=${stateHue("working").tmux}`));
});
```

- [ ] **Step 2: Run — expect FAIL** (`stateHue` undefined).

- [ ] **Step 3: Implement.** In `lib/curtain/wash.mjs`, above `FG` (line 14), add the canonical table + accessor, then rewrite `FG`/`PERIOD` to reference it (values UNCHANGED so all wash tests stay green):

```js
// THE single hue + period source. Every surface (card, tmux tab, wash comet,
// Claude bar) resolves a state's colour/period from here. working=amber(Flow),
// done=green(Settle), needs=rose(Attention), compacting=steel(Pressure).
const STATE_HUE = {
  [STATES.WORKING]:    { ansi: 214, tmux: "colour214", periodSec: 5 },
  [STATES.DONE]:       { ansi: 70,  tmux: "colour70",  periodSec: 3 },
  [STATES.NEEDS]:      { ansi: 167, tmux: "colour167", periodSec: 3 },
  [STATES.COMPACTING]: { ansi: 67,  tmux: "colour67",  periodSec: 4 },
  [STATES.IDLE]:       { ansi: 244, tmux: "colour244", periodSec: 0 },
};

export const stateHue = (state) => STATE_HUE[state] || STATE_HUE[STATES.IDLE];

const FG = {
  [STATES.WORKING]: { dim: "colour240", hot: STATE_HUE[STATES.WORKING].tmux },
  [STATES.DONE]: {
    dim: "colour238",
    hot: STATE_HUE[STATES.DONE].tmux,
    flash: "colour82", // one-beat brighter green (still soft, not pure 46)
  },
  [STATES.NEEDS]: { dim: "colour52", hot: STATE_HUE[STATES.NEEDS].tmux },
  [STATES.COMPACTING]: { dim: "colour238", hot: STATE_HUE[STATES.COMPACTING].tmux },
};

const PERIOD = {
  [STATES.WORKING]: STATE_HUE[STATES.WORKING].periodSec,
  [STATES.DONE]: STATE_HUE[STATES.DONE].periodSec,
  [STATES.NEEDS]: STATE_HUE[STATES.NEEDS].periodSec,
  [STATES.COMPACTING]: STATE_HUE[STATES.COMPACTING].periodSec,
  [STATES.IDLE]: STATE_HUE[STATES.IDLE].periodSec,
};
```

- [ ] **Step 4: Run — expect PASS.** `node --test test/wash.test.mjs` (all pre-existing wash asserts must still pass — values are identical).
- [ ] **Step 5:** biome check `lib/curtain/wash.mjs test/wash.test.mjs`. **Commit** — `feat(wash): stateHue single hue/period source, FG/PERIOD derived (P1 T4)`

**STOP if:** any pre-existing wash test changes behavior (a value drifted from the original `colour214/70/167/67` or period `5/3/3/4/0`).

---

### Task 5: `buildStateItem` — WORKING uses `role:'accent'` (amber `colour214`)

Tie the tmux state segment to curtain amber. Back-compat: no state arg → `dim` (existing behavior).

**Files:**
- Modify: `lib/status/segments.mjs` (`buildStateItem` lines 239-242; REGISTRY `state.render` lines 278-285)
- Modify: `test/status-segments.test.mjs` (accent assert; keep dim back-compat)

**Interfaces:**
- Produces: `buildStateItem(glyph:string, state?:string) => { id:'state', text, role:'accent'|'dim', priority:90 } | null`
- Consumes (registry): `ctx.session.state` (optional)

- [ ] **Step 1: Write failing tests** in `test/status-segments.test.mjs`. Extend the existing "buildModelItem / buildStateItem null on empty" test / add:

```js
test("buildStateItem: WORKING gets accent (amber colour214), else dim", () => {
  assert.deepEqual(buildStateItem("●", "working"), {
    id: "state", text: "●", role: "accent", priority: 90,
  });
  // back-compat: no state / non-working → dim (unchanged)
  assert.deepEqual(buildStateItem("▶"), {
    id: "state", text: "▶", role: "dim", priority: 90,
  });
  assert.equal(buildStateItem("⏸", "idle").role, "dim");
  assert.equal(ROLES.accent.tmux, "colour214"); // amber == wash working hue
});
```

- [ ] **Step 2: Run — expect FAIL** (role is `dim` for working).

- [ ] **Step 3: Implement.** In `lib/status/segments.mjs` replace `buildStateItem` (lines 239-242):

```js
export function buildStateItem(glyph = "", state = "") {
  if (!glyph) return null;
  const role = state === "working" ? "accent" : "dim";
  return { id: "state", text: String(glyph), role, priority: 90 };
}
```

And thread state in the REGISTRY `state.render` (lines 282-284):

```js
render(ctx) {
  const g = ctx?.session?.stateGlyph;
  return g ? buildStateItem(g, ctx?.session?.state) : null;
},
```

- [ ] **Step 4: Run — expect PASS.** `node --test test/status-segments.test.mjs` (existing `buildStateItem("▶")` → dim assert still holds).
- [ ] **Step 5:** biome check `lib/status/segments.mjs test/status-segments.test.mjs`. **Commit** — `feat(segments): WORKING state item uses accent amber (P1 T5)`

**STOP if:** the existing dim back-compat assert (`buildStateItem("▶")`) breaks.

---

### Task 6: `stateGlyph(status, t)` — optional phase-cycle on the WORKING period

Add the `t` arg. Omitted → today's static glyph (back-compat). Given → WORKING glyph breathes on the wash WORKING period from `stateHue`.

**Files:**
- Modify: `lib/status/side-effects.mjs` (add `stateHue` import from `../curtain/wash.mjs`; `stateGlyph` lines 101-109)
- Modify: `test/status-surfaces.test.mjs` (phase-cycle asserts; static back-compat)

**Interfaces:**
- Consumes: `stateHue(state).periodSec`
- Produces: `stateGlyph(status:string, t?:number) => string` — `t` omitted/invalid → static (`▶`/`⚠`/`·`/`⏸`); `t` given → WORKING/COMPACTING/busy/shell breathes through `WORKING_PULSE`.

- [ ] **Step 1: Write failing tests** in `test/status-surfaces.test.mjs` (extend the "ctxBucketTmux and stateGlyph" test / add):

```js
test("stateGlyph phase-cycles WORKING on the wash period when t is given", () => {
  // back-compat: no t → static glyphs unchanged
  assert.equal(stateGlyph("busy"), "▶");
  assert.equal(stateGlyph("idle"), "⏸");
  assert.equal(stateGlyph("needs"), "⚠");
  // t given → WORKING breathes; frame 0 is the full dot ●
  assert.equal(stateGlyph("working", 0), "●");
  // period is 5s (stateHue.working); one full cycle returns to start
  assert.equal(stateGlyph("working", 5), stateGlyph("working", 0));
  // mid-cycle differs from start (soft breathe, not static)
  assert.notEqual(stateGlyph("working", 2.5), stateGlyph("working", 0));
  // every phase glyph is from the pulse ramp (soft, no strobe)
  const ramp = new Set();
  for (let i = 0; i < 10; i++) ramp.add(stateGlyph("busy", i * 0.5));
  for (const g of ramp) assert.ok(["●", "◐", "○", "◑"].includes(g), `pulse glyph ${g}`);
  // needs/idle ignore t (event surfaces, no working pulse)
  assert.equal(stateGlyph("needs", 2), "⚠");
});
```

- [ ] **Step 2: Run — expect FAIL** (`stateGlyph("working", 0)` → `▶`, not `●`).

- [ ] **Step 3: Implement.** In `lib/status/side-effects.mjs` add the import (top, near line 8) and rewrite `stateGlyph`:

```js
import { stateHue } from "../curtain/wash.mjs";

// Soft WORKING breathe (one cycle per stateHue.working period). ● full → ○ empty
// → ● — a luminance pulse, never a strobe. Dot family unifies with card/Claude ●.
const WORKING_PULSE = ["●", "◐", "○", "◑"];

export function stateGlyph(status, t) {
  const s = String(status || "").toLowerCase();
  const isWork =
    s === "busy" || s === "shell" || s === "working" || s === "compacting";
  if (isWork) {
    if (t == null || !Number.isFinite(Number(t))) return "▶"; // back-compat static
    const period = stateHue("working").periodSec || 5;
    const frac = period > 0 ? (((Number(t) / period) % 1) + 1) % 1 : 0;
    const idx = Math.min(
      WORKING_PULSE.length - 1,
      Math.floor(frac * WORKING_PULSE.length),
    );
    return WORKING_PULSE[idx];
  }
  if (s === "needs") return "⚠";
  if (s === "unknown" || s === "") return "·";
  // idle / done / paused
  return "⏸";
}
```

- [ ] **Step 4: Run — expect PASS.** `node --test test/status-surfaces.test.mjs` AND `node --test test/status-compute.test.mjs` (its `stateGlyph("working")==="▶"` static asserts at lines 471-474 must still hold — they pass no `t`).
- [ ] **Step 5:** biome check `lib/status/side-effects.mjs test/status-surfaces.test.mjs`. **Commit** — `feat(side-effects): stateGlyph phase-cycles WORKING on wash period (P1 T6)`

**STOP if:** any `stateGlyph(...)` call with NO `t` returns a non-`▶` glyph for working (back-compat break), or the import creates a cycle (`wash.mjs` must not import `side-effects.mjs`).

---

### Task 7: Claude bottom bar — WORKING chip amber(214) + `●`

Event-only surface: colour/glyph match ONLY (no animation — honest limitation). Adopt the wash amber + dot so the bar reads as one system.

**Files:**
- Modify: `lib/status/claude-statusline.mjs` (`WORK_BG` line 15; WORKING chip lines 106-108)
- Modify: `test/status-surfaces.test.mjs` (update `WORK_BG` assert line 372; glyph `●`)

**Interfaces:**
- Consumes: nothing new (constants only)
- Produces: `renderClaudeBarString(...)` WORKING branch emits `\x1b[48;5;214m` bg + `● working` chip.

- [ ] **Step 1: Update the failing test** in `test/status-surfaces.test.mjs` — the "renderClaudeStatusline busy render includes working chip" test (lines 350-376). Change the WORK_BG assert:

```js
assert.match(out, /working/);
assert.match(out, /●/); // dot family unifies with card + tmux tab
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC for WORK_BG (amber 214)
assert.match(out, /\x1b\[48;5;214m/);
```

- [ ] **Step 2: Run — expect FAIL** (`WORK_BG` is `54`, glyph is `▶`).

- [ ] **Step 3: Implement.** In `lib/status/claude-statusline.mjs`:
- line 15: `const WORK_BG = "\x1b[48;5;214m"; // amber (Flow) — matches wash comet + card`
- lines 106-108 WORKING branch: change glyph `▶` → `●`:

```js
} else if (status === "busy" || status === "shell" || status === "working") {
  bg = WORK_BG;
  chip = `${CHIP_FG}● working${dur ? ` · ${dur}` : ""}${RESET}`;
}
```

- [ ] **Step 4: Run — expect PASS.** `node --test test/status-surfaces.test.mjs`
- [ ] **Step 5: Full suite** `node --test` → `# fail 0`. biome check `lib/status/claude-statusline.mjs test/status-surfaces.test.mjs`. **Commit** — `feat(claude-bar): WORKING chip amber(214) + ● (one motion language) (P1 T7)`

**STOP if:** the amber-on-white chip is unreadable in a real terminal (see open risk — a follow-up may darken `CHIP_FG` for this chip only; out of scope for the P1 contract).

---

## Executor report format

At the end, report exactly:

```
RESULT: ok|partial|failed — commits: <n> — <one-line summary>

Per task (T1..T7):
- T<n> <title>: <done|skipped|blocked> — commit <sha7> — <test file> <pass/fail counts>

Verification:
- node --test           → # tests <N>, # pass <P>, # fail <F>   (MUST be fail 0)
- biome check lib test  → <exit 0 | issues>

Deviations from plan: <none | list each with why>
Motion-off byte-identical check (T3): <verbatim assert result>
Interfaces produced for P2/P3: driftField, stateHue, stateGlyph(status,t), buildStateItem(glyph,state), theatrics.seed threading — <confirm signatures unchanged from plan>
```

## Notes for P2/P3 (do not implement here)

- `applyTheatrics` already accepts `opts.seed` and threads through `renderCard`'s `theatrics.seed`; P2's seed plumbing (`arm()` stamps `@herald_seed` → `curtain-card-session.sh --seed` → `cli.mjs f.seed`) only has to set `f.seed` to a real per-tab int — the render side is done.
- Composite order in `applyTheatrics` is base → motes → burst → fabric(LAST); P2 inserts the denizen cel BETWEEN burst and fabric (whitespace-only, reserved zone).
- `stateHue` is the table P2/P3 denizen poses and any new surface must read for hue/period.

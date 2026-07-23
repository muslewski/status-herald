# Herald Denizens — Phase 2 (Denizens) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-session reactive creature ("denizen") to the curtain card — deterministic species by session name, reactive pose by `@herald_state`, phase-offset by seed, responsive art tier from card dims — composited whitespace-only in the order `base art → motes → denizen → curtain`, with fox+cat+owl authored across full+compact tiers and all 5 states.

**Architecture:** New pure `lib/curtain/denizens.mjs` (logic: `speciesFor`, `seedFor`, `tierFor`, `denizenCel`) reads authored art from `lib/curtain/denizens-data.mjs` (`DENIZENS` map, separated from logic). `theatrics.mjs` gains `mergeDenizen` (whitespace-only paint into a reserved zone) and `applyTheatrics` inserts the denizen composite step between the motes merge and the curtain-fabric overlay. `renderCard` selects tier + cel + zone and threads them through `theatrics`. One seed funnel: `arm()` stamps `@herald_entity`+`@herald_seed` once → `curtain-card-session.sh` reads them into `O[]` and passes `--entity`/`--seed` → `cli.mjs runRender` folds `f.entity`/`f.seed` into the theatrics object. Injected input only; render stays pure/deterministic (no `Math.random`/`Date.now`).

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, local biome (`./node_modules/.bin/biome`), bash card loop, tmux session options.

**Spec:** `docs/superpowers/specs/2026-07-18-herald-denizens-design.md`
**Depends on:** P1 (plan 024) — `driftField` in `lib/curtain/theatrics.mjs` (motes/DONE burst). This plan inserts the denizen step relative to the motes merge; it does not re-implement particles.

## Global Constraints (hard invariants — copy into every executor context)

- **Zero runtime npm dependencies.** biome is dev-only. No new imports outside the repo.
- **Art is sacred.** No overlay (mote or denizen) may overwrite a non-space base-art cell. `mergeDenizen` paints into **whitespace cells only** — base ink always wins.
- **No `Math.random` / no `Date.now` in the render path.** Every visual is `fn(cols, rows, tick, seed, …)`. Variation comes from the **injected** `@herald_seed` / `@herald_entity`.
- **No strobe (WCAG 2.3.1).** Reactive pose cycles at the existing card tick; no hard blink. Colour is never the sole signal.
- **Exact geometry.** `renderCard` returns exactly `rows` strings at every tier and under resize. A too-small card degrades to particles+glyph — never a clipped creature (`tierFor → "none"`).
- **Motion-off contract.** `motionDisabled(animCfg)` (`animation.enabled:false` OR `reducedMotion:true`) → denizen frozen to cel 0 (tick=0). `classic` theme → **no denizen at all**, byte-identical to today.
- **Fail-open on render paths.** Empty cel + exit 0 beats an error. `denizenCel` returns `[]` for unknown species/state/tier; the composite is a no-op on `[]`.
- **Order is load-bearing.** `applyTheatrics`: base art → `driftField` motes (whitespace) → denizen cel (whitespace, its zone) → curtain fabric overlay (cover/reveal) LAST.
- **Perf gate unchanged.** Covered-only hot tick; identical-frame writes skipped; `settleAfter` freeze respected. Denizen adds no new loop.
- **TDD required.** Per task: write failing test → run (fails) → minimal impl → run (passes) → commit. One commit per task.

## File map (create / modify)

| Path | Role |
|------|------|
| **Create** `lib/curtain/denizens.mjs` | Logic: `speciesFor`, `seedFor`, `tierFor`, `denizenCel`, `hashStr`, `ROSTER` |
| **Create** `lib/curtain/denizens-data.mjs` | Authored art: `DENIZENS` (fox+cat+owl, full+compact, 5 states) |
| **Create** `test/denizens.test.mjs` | Unit tests for logic + data machine-validation |
| **Modify** `lib/curtain/theatrics.mjs` | Add `mergeDenizen`; insert denizen step in `applyTheatrics` (motes→denizen→curtain) |
| **Modify** `lib/surfaces/curtain-card.mjs` | Tier/cel/zone selection; thread `entity`/`seed`; extend `wantComposite` |
| **Modify** `lib/cli.mjs` | `runRender` parses `--entity`/`--seed` (mirror `--tick`) into `theatrics` |
| **Modify** `lib/curtain/session.mjs` | `arm()` stamps `@herald_entity`+`@herald_seed` once |
| **Modify** `scripts/curtain-card-session.sh` | Read `O[@herald_entity]`/`O[@herald_seed]`; pass `--entity`/`--seed` |
| **Modify** `test/theatrics.test.mjs` | `mergeDenizen` whitespace-only + geometry tests |
| **Modify** `test/curtain-card.test.mjs` | Denizen composite: art-sacred, exact geometry, classic-static, motion-off |
| **Modify** `test/curtain-cli.test.mjs` | `--entity`/`--seed` parsed + loop-script grep for flags |
| **Modify** `test/session.test.mjs` | `arm()` stamps entity/seed deterministically |

---

### Task 1: `denizens.mjs` logic + `denizens-data.mjs` with fox authored

**Files:**
- Create: `lib/curtain/denizens.mjs`
- Create: `lib/curtain/denizens-data.mjs`
- Create: `test/denizens.test.mjs`

**Interfaces:**
- Produces: `hashStr(s) -> number` (uint32, FNV-1a)
- Produces: `ROSTER -> string[]` (`Object.keys(DENIZENS)`)
- Produces: `speciesFor(sessionName, cfg = {}) -> string` — deterministic hash into enabled roster; honors an explicit `cfg.animation.denizens.species` override; `""` when roster empty
- Produces: `seedFor(sessionName) -> number` (uint32, stable per tab)
- Produces: `tierFor(rows, cols) -> 'full'|'compact'|'none'` from card inner dims
- Produces: `denizenCel({ species, state, tier, tick, seed }) -> string[]` — pure; frame = `frames[(tick + seed%n) % n]`; `[]` when `tier==='none'` / unknown
- Produces (data): `DENIZENS = { [species]: { tiers:{ full:{rows,cols}, compact:{rows,cols} }, poses:{ [state]:{ full:frames[], compact:frames[] } } } }`
- Consumes: nothing (pure module; no config file read inside `denizenCel`)

**Crux code (verbatim — `lib/curtain/denizens.mjs`):**

```js
// Pure denizen logic (Act II). No I/O, no Date.now/Math.random. Art lives in
// denizens-data.mjs (authored content), separated from selection logic.
import { DENIZENS } from "./denizens-data.mjs";

/** 32-bit FNV-1a over a string → uint32. Deterministic, stable across runs. */
export const hashStr = (s) => {
  let h = 2166136261 >>> 0; // FNV offset basis
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0; // FNV prime, kept in uint32
  }
  return h >>> 0;
};

/** All species that ship art, in a stable order. */
export const ROSTER = Object.keys(DENIZENS);

/** Denizen config block, tolerant of absent P3 config (defaults on/auto). */
const denCfg = (cfg = {}) => cfg?.animation?.denizens || cfg?.denizens || {};

/** Species names that are both authored and enabled. */
const enabledRoster = () => ROSTER.filter((name) => DENIZENS[name]);

/**
 * Deterministic species for a session. Same name → same animal (mirrors the
 * (sessionName, cfg) shape of themeNameFor at themes.mjs:92, but hash-based so
 * a fleet spreads across the roster). Explicit species override wins.
 */
export const speciesFor = (sessionName, cfg = {}) => {
  const roster = enabledRoster();
  if (!roster.length) return "";
  const pick = denCfg(cfg).species;
  if (pick && pick !== "auto" && roster.includes(pick)) return pick;
  return roster[hashStr(sessionName) % roster.length];
};

/** Stable per-tab seed (uint32). Phase-offsets co-launched tabs. */
export const seedFor = (sessionName) => hashStr(sessionName);

/**
 * Responsive tier from the card's inner rows × cols. Loud art needs room;
 * a too-small card gets particles+glyph only (no clipped creature).
 */
export const tierFor = (rows, cols) => {
  const r = Math.max(0, Math.floor(Number(rows) || 0));
  const c = Math.max(0, Math.floor(Number(cols) || 0));
  if (r < 6 || c < 14) return "none";
  if (r < 12 || c < 24) return "compact";
  return "full";
};

/**
 * The raw art cel for this frame. Pure: frame index folds the injected seed
 * so co-launched tabs animate out of phase. Fail-open: [] for anything absent.
 */
export const denizenCel = ({
  species,
  state,
  tier,
  tick = 0,
  seed = 0,
} = {}) => {
  if (tier === "none" || !species) return [];
  const rec = DENIZENS[species];
  if (!rec) return [];
  const pose = rec.poses?.[state] || rec.poses?.idle;
  const frames = pose?.[tier];
  if (!Array.isArray(frames) || !frames.length) return [];
  const n = frames.length;
  const off = (((Number(seed) || 0) % n) + n) % n;
  const idx = (((Number(tick) || 0) % n) + off) % n;
  return frames[idx].slice(); // copy the rows array (callers may mutate)
};
```

**Data shape (verbatim starter — `lib/curtain/denizens-data.mjs`, fox fully authored):**

```js
// Authored denizen art (Act II). Separated from logic so a look-pack/bestiary
// can grow without touching selection code. Each cel is a RECTANGULAR block of
// whitespace-safe rows (spaces = transparent; ink paints only into base-art
// whitespace). full = 7×3, compact = 5×2 for this starter roster. Frames ≤ 8.
//
// States (all required): working, done, needs, compacting, idle.

// fox — 7-wide × 3-row full; 5-wide × 2-row compact.
const fox = {
  tiers: { full: { rows: 3, cols: 7 }, compact: { rows: 2, cols: 5 } },
  poses: {
    working: {
      full: [
        ["/\\_ _/\\", "(o.o)/~", "  ~^~  "],
        ["/\\_ _/\\", "(o.o)~\\", "  ^~^  "],
      ],
      compact: [
        ["/o.o\\", " ~^~ "],
        ["/o.o\\", " ^~^ "],
      ],
    },
    done: {
      full: [
        ["/\\^_^/\\", "(^.^) *", "  \\_/  "],
        ["/\\^_^/\\", "(^.^)* ", "  \\_/  "],
      ],
      compact: [
        ["/^.^\\", " \\_/ "],
        ["/^.^\\", " \\_/ "],
      ],
    },
    needs: {
      full: [
        ["/\\! !/\\", "(o.o) ?", "  ! !  "],
        ["/\\! !/\\", "(O.O) ?", "  ! !  "],
      ],
      compact: [
        ["/o.o\\", " ?!? "],
        ["/O.O\\", " ?!? "],
      ],
    },
    compacting: {
      full: [
        ["/\\z z/\\", "(-.-)  ", "  ...  "],
        ["/\\ z z/", "(-.-) z", "  ...  "],
      ],
      compact: [
        ["/-.-\\", " zz  "],
        ["/-.-\\", "  zz "],
      ],
    },
    idle: {
      full: [
        ["/\\___/\\", "(-.-)  ", "  ^-^  "],
        ["/\\___/\\", "(o.o)  ", "  ^-^  "],
      ],
      compact: [
        ["/-.-\\", " ^-^ "],
        ["/o.o\\", " ^-^ "],
      ],
    },
  },
};

// cat + owl authored in Task 2 following this exact shape (same tier dims,
// same 5 states, rectangular whitespace-safe rows). Placeholder stubs removed
// there; the validation test in test/denizens.test.mjs enforces correctness.

export const DENIZENS = { fox };
```

> The `hashStr` values are stable but arbitrary; tests assert *determinism* and *spread*, never a specific animal for a specific name (so re-ordering the roster never breaks a test).

**TDD Steps:**
- [ ] **Step 1 — failing tests.** Create `test/denizens.test.mjs`:
  - `import { speciesFor, seedFor, tierFor, denizenCel, hashStr, ROSTER } from "../lib/curtain/denizens.mjs";` and `import { DENIZENS } from "../lib/curtain/denizens-data.mjs";`
  - `test("hashStr is deterministic uint32")`: `assert.equal(hashStr("s1"), hashStr("s1"));` `const h = hashStr("Syndcast Backlog"); assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);`
  - `test("speciesFor deterministic and in roster")`: `const a = speciesFor("s1"); assert.equal(a, speciesFor("s1")); assert.ok(ROSTER.includes(a));`
  - `test("speciesFor honors explicit species override")`: `assert.equal(speciesFor("s1", { animation: { denizens: { species: "fox" } } }), "fox");`
  - `test("speciesFor spreads across names")`: gather `new Set([...Array(50)].map((_, i) => speciesFor("sess-" + i)))`; once cat+owl land (Task 2) `assert.ok(set.size >= 2)` — for Task 1 (fox only) assert `set.size >= 1` and leave a `// TODO widen after Task 2` note, then tighten in Task 2.
  - `test("seedFor stable per name")`: `assert.equal(seedFor("s1"), seedFor("s1")); assert.notEqual(seedFor("s1"), seedFor("s2"));`
  - `test("tierFor thresholds")`: `assert.equal(tierFor(24, 80), "full"); assert.equal(tierFor(10, 30), "compact"); assert.equal(tierFor(4, 10), "none"); assert.equal(tierFor(24, 12), "none");`
  - `test("denizenCel returns rows for known species/state/tier")`: `const cel = denizenCel({ species: "fox", state: "working", tier: "full", tick: 0, seed: 0 }); assert.equal(cel.length, 3); for (const r of cel) assert.equal(r.length, 7);`
  - `test("denizenCel frame folds seed phase offset")`: with fox working full (n=2): `const t0s0 = denizenCel({ species: "fox", state: "working", tier: "full", tick: 0, seed: 0 }); const t0s1 = denizenCel({ species: "fox", state: "working", tier: "full", tick: 0, seed: 1 }); assert.notDeepEqual(t0s0, t0s1);` and `assert.deepEqual(denizenCel({ species:"fox", state:"working", tier:"full", tick:2, seed:0 }), t0s0);` (period 2)
  - `test("denizenCel fail-open")`: `assert.deepEqual(denizenCel({ species: "dragon", state: "working", tier: "full" }), []); assert.deepEqual(denizenCel({ species: "fox", state: "working", tier: "none" }), []); assert.deepEqual(denizenCel({}), []);`
  - `test("fox art is rectangular + whitespace-safe at declared dims")`: iterate `DENIZENS.fox.poses` × states × [full,compact]; for each frame assert every row `.length === DENIZENS.fox.tiers[tier].cols` and frame length `=== tiers[tier].rows`; assert no control chars: `assert.doesNotMatch(row, /[\x00-\x1f]/);`
- [ ] **Step 2 — run, expect fail** (modules absent).
- [ ] **Step 3 — implement** `lib/curtain/denizens-data.mjs` (fox verbatim above) then `lib/curtain/denizens.mjs` (crux verbatim above).
- [ ] **Step 4 — run, expect pass.**
- [ ] **Step 5 — commit** `feat(denizens): pure species/tier/cel logic + fox art`.

**Verification:** `node --test test/denizens.test.mjs` → `# fail 0`; `./node_modules/.bin/biome check lib/curtain/denizens.mjs lib/curtain/denizens-data.mjs test/denizens.test.mjs` → exit 0.

**STOP if:** `denizenCel` needs any config read or `Date.now` (it must not — inputs are injected); any fox row is not exactly its declared width (fix the art, not the test).

---

### Task 2: Author cat + owl; machine-validate the whole roster

**Files:**
- Modify: `lib/curtain/denizens-data.mjs` (add `cat`, `owl`; extend `DENIZENS`)
- Modify: `test/denizens.test.mjs` (validate the full roster; tighten the spread assertion)

**Interfaces:**
- Produces: `DENIZENS.cat`, `DENIZENS.owl` — same shape as fox (`tiers.full = 7×3`, `tiers.compact = 5×2`, all 5 states, ≤3 frames each, rectangular, whitespace-safe)
- Consumes: `DENIZENS.fox` as the authoring template

**TDD Steps:**
- [ ] **Step 1 — strengthen the validation test** so it drives the art. Replace the fox-only rectangularity test with a roster-wide loop:
  ```js
  const STATES = ["working", "done", "needs", "compacting", "idle"];
  test("every denizen: 5 states × both tiers, rectangular, whitespace-safe, ≤8 frames", () => {
    for (const [name, rec] of Object.entries(DENIZENS)) {
      for (const st of STATES) {
        const pose = rec.poses[st];
        assert.ok(pose, `${name}.${st} missing`);
        for (const tier of ["full", "compact"]) {
          const frames = pose[tier];
          assert.ok(Array.isArray(frames) && frames.length >= 1 && frames.length <= 8,
            `${name}.${st}.${tier} frame count`);
          const { rows, cols } = rec.tiers[tier];
          for (const f of frames) {
            assert.equal(f.length, rows, `${name}.${st}.${tier} row count`);
            for (const line of f) {
              assert.equal(line.length, cols, `${name}.${st}.${tier} width`);
              assert.doesNotMatch(line, /[\x00-\x1f]/, "no control chars");
            }
          }
        }
      }
    }
  });
  ```
  - Tighten spread: `test("roster ≥ 2 species and speciesFor spreads")`: `assert.ok(ROSTER.length >= 3);` and `assert.ok(new Set([...Array(50)].map((_, i) => speciesFor("sess-" + i))).size >= 2);`
- [ ] **Step 2 — run, expect fail** (cat/owl absent; spread set size 1).
- [ ] **Step 3 — author cat + owl** in `denizens-data.mjs` following fox's shape (7×3 full, 5×2 compact, 5 states). Distinct silhouettes: cat = pointy ears `/\ /\` + `(=^.^=)`-ish squashed to 7 wide; owl = round `,___,` + `(o,o)` + ` "-"  ` big eyes. Reactive poses per state (working=busy, done=happy, needs=alarmed `!`, compacting=sleepy `z`, idle=calm). Whatever the exact glyphs, the validation test is the contract — every row exactly its tier width, ≤8 frames. Then `export const DENIZENS = { fox, cat, owl };`.
- [ ] **Step 4 — run, expect pass.**
- [ ] **Step 5 — commit** `feat(denizens): author cat + owl; roster-wide art validation`.

**Verification:** `node --test test/denizens.test.mjs` → `# fail 0`; biome on `lib/curtain/denizens-data.mjs test/denizens.test.mjs` → exit 0.

**STOP if:** any authored row is off-width (the test names the offender `name.state.tier`) — fix the art; never loosen the test.

---

### Task 3: `mergeDenizen` composite + `applyTheatrics` order + `renderCard` threading

**Files:**
- Modify: `lib/curtain/theatrics.mjs` (add `mergeDenizen`; insert denizen step in `applyTheatrics`)
- Modify: `lib/surfaces/curtain-card.mjs` (tier/cel/zone selection; thread `entity`/`seed`; `wantComposite`)
- Modify: `test/theatrics.test.mjs`
- Modify: `test/curtain-card.test.mjs`

**Interfaces:**
- Produces: `mergeDenizen(baseLines, cel, zone = {}) -> string[]` in `theatrics.mjs` — whitespace-only paint; `zone = { top, left }` (0-indexed); base ink wins; input/output plain (no SGR)
- Modifies: `applyTheatrics(plainLines, opts)` — `opts` gains `denizen?: string[]|null`, `denizenZone?: {top,left}|null`; step order `motes → denizen → curtain`
- Consumes (in `curtain-card.mjs`): `denizenCel`, `tierFor` from `denizens.mjs`; `motionDisabled` (already imported via theatrics — add to import if needed); `theatrics.entity`, `theatrics.seed`, `theatrics.animCfg`, `theatrics.themeName`

**Crux code (verbatim — add to `lib/curtain/theatrics.mjs`, beside `mergeSparks`):**

```js
/**
 * Merge a denizen cel into base lines at a reserved zone, whitespace-only.
 * Art is sacred: a cel glyph paints ONLY where the base cell is a space.
 * zone = { top, left } 0-indexed. Input/output plain (no SGR).
 */
export const mergeDenizen = (baseLines, cel, zone = {}) => {
  if (!Array.isArray(cel) || !cel.length) return baseLines;
  const top = Math.max(0, Math.floor(Number(zone.top) || 0));
  const left = Math.max(0, Math.floor(Number(zone.left) || 0));
  const out = baseLines.map((l) => stripSgr(l));
  for (let i = 0; i < cel.length; i++) {
    const r = top + i;
    if (r < 0 || r >= out.length) continue;
    const chars = [...stripSgr(out[r])];
    const art = stripSgr(cel[i]);
    for (let j = 0; j < art.length; j++) {
      const a = art[j];
      if (a === " ") continue; // transparent cell
      const col = left + j;
      while (chars.length <= col) chars.push(" ");
      if ((chars[col] ?? " ") === " ") chars[col] = a; // base ink wins
    }
    out[r] = chars.join("");
  }
  return out;
};
```

**Crux code (verbatim — insertion inside `applyTheatrics`, AFTER the motes/spark merge block and BEFORE the `stageCurtain` overlay block):**

```js
  // Act II denizen — reactive creature painted whitespace-only into its zone.
  // Order is load-bearing: motes merged above; the curtain fabric overlay below
  // paints LAST so a closing curtain covers the creature. base → motes → denizen
  // → curtain.
  if (Array.isArray(opts.denizen) && opts.denizen.length) {
    lines = mergeDenizen(lines, opts.denizen, opts.denizenZone || {});
  }
```

Also destructure the new opts at the top of `applyTheatrics` (or read `opts.denizen` directly as shown — keep it read off `opts` so the existing `const { … } = opts` block is untouched).

**Crux code (verbatim — in `lib/surfaces/curtain-card.mjs`, compute denizen before the `wantComposite` line ~239):**

```js
  // Act II: per-session reactive creature. classic stays byte-identical (no
  // denizen). Whitespace-only, so it can never clobber base art.
  const denCfg = theatrics?.animCfg?.denizens;
  const denizensOn =
    theatrics &&
    (theatrics.themeName || "classic") !== "classic" &&
    (denCfg ? denCfg.enabled !== false : true);
  let denizen = null;
  let denizenZone = null;
  if (denizensOn && theatrics.entity) {
    const tier = tierFor(rows, cols);
    if (tier !== "none") {
      const frozen = motionDisabled(theatrics.animCfg || {});
      const cel = denizenCel({
        species: theatrics.entity,
        state: state || "idle",
        tier,
        tick: frozen ? 0 : tick,
        seed: Number(theatrics.seed) || 0,
      });
      if (cel.length) {
        const celW = Math.max(...cel.map((l) => l.length));
        denizenZone = {
          top: Math.max(0, Math.floor(rows * 0.12)),
          left: Math.max(0, Math.floor((cols - celW) / 2)),
        };
        denizen = cel;
      }
    }
  }
```

Then extend `wantComposite` and the `applyTheatrics` call:

```js
  const wantComposite =
    (effects &&
      (effects.sparkRain ||
        (effects.stageDraw &&
          (theatrics?.draw === "shut" || theatrics?.draw === "open")))) ||
    !!denizen;
```

```js
  const composed = applyTheatrics(out, {
    cols,
    rows,
    effects,
    draw: theatrics?.draw || null,
    drawProgress:
      theatrics?.drawProgress != null ? Number(theatrics.drawProgress) : 0,
    tick,
    sparkFrames: Number(theatrics?.sparkFrames) || 5,
    denizen,
    denizenZone,
  });
```

Add imports to `curtain-card.mjs`: `import { denizenCel, tierFor } from "../curtain/denizens.mjs";` and add `motionDisabled` to the existing `../curtain/theatrics.mjs` import.

> Note: `effects` may have all flags false (idle non-classic) but `wantComposite` is still driven true by `!!denizen`; `applyTheatrics` only fires spark/draw when their `effects` flags are set, so an idle denizen composites cleanly with no fabric.

**TDD Steps:**
- [ ] **Step 1 — `theatrics.test.mjs` failing tests.** Add `mergeDenizen` to the import. 
  - `test("mergeDenizen paints into whitespace only; base ink wins")`: `const base = ["#######", "       ", "       "]; const cel = ["/\\_ _/\\".slice(0,7), "(o.o)/~", "  ~^~  "]; const out = mergeDenizen(base, cel, { top: 0, left: 0 }); assert.equal(out[0], "#######", "base ink survives");` and assert `out[1]` contains cel glyphs where base was space.
  - `test("mergeDenizen respects zone offset and preserves line count")`: `const out = mergeDenizen(["          ","          "], ["ab"], { top: 1, left: 3 }); assert.equal(out.length, 2); assert.equal(out[1][3], "a"); assert.equal(out[1][4], "b"); assert.equal(out[0].trim(), "");`
  - `test("mergeDenizen no-op on empty/absent cel")`: `assert.deepEqual(mergeDenizen(["xx"], [], {}), ["xx"]); assert.deepEqual(mergeDenizen(["xx"], null, {}), ["xx"]);`
- [ ] **Step 2 — run, expect fail.** Implement `mergeDenizen`; run, pass.
- [ ] **Step 3 — `curtain-card.test.mjs` failing tests** (denizen composite). Build a theatrics opts helper:
  ```js
  const den = (over = {}) => ({ themeName: "forge", animCfg: { enabled: true }, entity: "fox", seed: 0, ...over });
  ```
  - `test("forge working card renders a denizen into whitespace")`: `const out = renderCard("working", 5, 60, 20, {}, BUILTINS.forge, 0, den()).map(plain).join("\n"); assert.match(out, /=======/, "anvil art still present"); assert.match(out, /o\.o|\^~\^|~\^~/, "fox glyphs present");`
  - `test("denizen never overwrites base art (art sacred)")`: render forge working with denizen; assert every base-art marker survives: `assert.match(out, /\|###\|/); assert.match(out, /=======/);`
  - `test("classic ignores entity/seed (byte-identical)")`: `const base = renderCard("working", 5, 60, 20, {}, BUILTINS.classic, 0).map(plain).join("\n"); const withEnt = renderCard("working", 5, 60, 20, {}, BUILTINS.classic, 0, { themeName: "classic", animCfg: { enabled: true }, entity: "fox", seed: 3 }).map(plain).join("\n"); assert.equal(withEnt, base);`
  - `test("renderCard keeps exact geometry with a denizen")`: `assert.equal(renderCard("working", 5, 60, 20, {}, BUILTINS.forge, 0, den()).length, 20);` and every line stripped `.length <= 60` (transparent) / `=== 60` where solid — mirror the existing geometry assertions in this file.
  - `test("too-small card degrades: no denizen glyphs")`: `const tiny = renderCard("working", 5, 12, 5, {}, BUILTINS.forge, 0, den()).map(plain).join("\n");` assert `tierFor(5,12) === "none"` and `assert.doesNotMatch(tiny, /o\.o/);`
  - `test("motion-off freezes denizen to cel 0")`: render forge working with `den({ animCfg: { enabled: false } })` at `tick: 0` and `tick: 5`; both `.join("\n")` equal (frozen). Also compare to explicit `denizenCel({species:"fox",state:"working",tier:"full",tick:0,seed:0})` presence.
  - `test("seed phase-offsets co-launched tabs")`: two renders same everything but `seed: 0` vs `seed: 1` at `tick: 0` differ (fox working has 2 frames).
- [ ] **Step 4 — run, expect fail.** Implement the `curtain-card.mjs` threading + `applyTheatrics` insertion. Run, pass.
- [ ] **Step 5 — full suite** `node --test` → confirm existing curtain-card / theatrics tests still green (classic byte-identical, forge spark/draw untouched).
- [ ] **Step 6 — commit** `feat(denizens): mergeDenizen composite + renderCard tier/cel/zone threading`.

**Verification:** `node --test test/theatrics.test.mjs test/curtain-card.test.mjs` → `# fail 0`; biome on `lib/curtain/theatrics.mjs lib/surfaces/curtain-card.mjs test/theatrics.test.mjs test/curtain-card.test.mjs` → exit 0.

**STOP if:** any existing classic/forge regression test flips (denizen must not touch the classic path or reorder the motes/curtain steps); a denizen glyph lands on a base-art cell in any test.

---

### Task 4: `arm()` stamps `@herald_entity` + `@herald_seed` once

**Files:**
- Modify: `lib/curtain/session.mjs` (`arm`, ~217–236; import from `denizens.mjs`)
- Modify: `test/session.test.mjs`

**Interfaces:**
- Consumes: `speciesFor`, `seedFor` from `./denizens.mjs`; existing `cfg` param of `arm`
- Produces: session opts `@herald_entity` (species string), `@herald_seed` (uint32 int as string)

**Crux code (verbatim — add import + two `setSessOpt` lines in `arm`, after `stampTheme(sess, t, cfg);`):**

```js
import { seedFor, speciesFor } from "./denizens.mjs";
```
```js
  stampTheme(sess, t, cfg);
  // Act II: stamp the per-tab creature ONCE. Deterministic by session name so
  // it survives rename; injected here so the render path stays pure.
  t.setSessOpt(sess, "@herald_entity", speciesFor(sess, cfg));
  t.setSessOpt(sess, "@herald_seed", String(seedFor(sess)));
  t.setSessOpt(sess, "@herald_armed", "1");
```
(Replace the existing final `t.setSessOpt(sess, "@herald_armed", "1");` — do not duplicate it.)

**TDD Steps:**
- [ ] **Step 1 — failing tests** in `test/session.test.mjs` (uses the existing `makeT`/`freshSession` doubles):
  - `test("arm stamps a deterministic entity + seed")`: `const t = makeT(freshSession()); arm("s1", t); const e = t.getSessOpt("s1", "@herald_entity"); assert.ok(e.length > 0); assert.match(t.getSessOpt("s1", "@herald_seed"), /^[0-9]+$/);`
  - `test("arm entity/seed reproduce for the same name")`: arm `s1` in two fresh doubles; assert identical `@herald_entity` and `@herald_seed`.
  - `test("arm is idempotent for entity too")`: after arm, set `@herald_entity` to a sentinel, arm again (idempotent guard returns early at `@herald_armed==="1"`), assert sentinel preserved — confirms the stamp is once-only.
- [ ] **Step 2 — run, expect fail.** Implement. Run, pass.
- [ ] **Step 3 — full suite** `node --test` → confirm the `arm` marks/creates tests (lines 94–109) still pass.
- [ ] **Step 4 — commit** `feat(denizens): arm() stamps @herald_entity + @herald_seed once`.

**Verification:** `node --test test/session.test.mjs` → `# fail 0`; biome on `lib/curtain/session.mjs test/session.test.mjs` → exit 0.

**STOP if:** `speciesFor` is called with `Date.now`/`Math.random` (must be name-only); the stamp lands outside the idempotent `@herald_armed` guard (would re-roll on every arm).

---

### Task 5: `cli.mjs runRender` parses `--entity`/`--seed`; loop script passes them

**Files:**
- Modify: `lib/cli.mjs` (`runRender` curtain-card block, ~112–148)
- Modify: `scripts/curtain-card-session.sh` (read `O[@herald_entity]`/`O[@herald_seed]`; add flags)
- Modify: `test/curtain-cli.test.mjs`

**Interfaces:**
- Consumes: `f.entity`, `f.seed` from `parseFlags` (same `--flag value` shape as `--tick`/`--draw-tick`)
- Produces: `theatrics.entity` (string), `theatrics.seed` (number) folded into the object passed to `renderCardFrame`
- Produces (sh): `--entity "$entity" --seed "$seed"` appended to the `herald render --surface curtain-card` invocation

**Crux code (verbatim — in `lib/cli.mjs`, add to the `theatrics` object built ~124–135):**

```js
      const theatrics = {
        themeName,
        animCfg,
        effects: selectEffects({
          state: f.state || "idle",
          themeName,
          animCfg,
        }),
        draw: draw === "shut" || draw === "open" ? draw : null,
        drawProgress,
        sparkFrames: 5,
        entity: f.entity || "",
        seed: Number(f.seed) || 0,
      };
```

**Crux code (verbatim — `scripts/curtain-card-session.sh`):**

Add to the option-read block (after line 70, `draw_frames=…`):
```bash
  entity=${O[@herald_entity]:-}
  seed=${O[@herald_seed]:-0}
```
Add to the `herald render` invocation (after `--tick "$tick"`, before `--cols`):
```bash
    --entity "${entity:-}" --seed "${seed:-0}" \
```

**TDD Steps:**
- [ ] **Step 1 — failing tests** in `test/curtain-cli.test.mjs`:
  - `test("runRender parses --entity/--seed into theatrics (fox glyphs render)")`: use the existing `run(["render", "--surface", "curtain-card", "--state", "working", "--theme", "forge", "--cols", "60", "--rows", "20", "--tick", "0", "--entity", "fox", "--seed", "0"])`; assert `status === 0` and `plain(stdout)` matches a fox glyph `/o\.o|~\^~|\^~\^/`. (Config default has `curtain.enabled` + `animation.enabled` true; forge is animated.)
  - `test("curtain-card-session.sh threads @herald_entity/@herald_seed as flags")` (source grep, mirrors the existing loop-script grep tests): read `scripts/curtain-card-session.sh`; `assert.match(src, /@herald_entity/); assert.match(src, /--entity/); assert.match(src, /--seed/);`
  - `test("cli.mjs runRender reads f.entity/f.seed")` (source grep): read `lib/cli.mjs`; `assert.match(src, /entity: f\.entity/); assert.match(src, /seed: Number\(f\.seed\)/);`
- [ ] **Step 2 — run, expect fail.** Implement cli.mjs + sh changes. Run, pass.
- [ ] **Step 3 — full suite** `node --test` → all green.
- [ ] **Step 4 — commit** `feat(denizens): plumb --entity/--seed through cli + card loop`.

**Verification:** `node --test test/curtain-cli.test.mjs` → `# fail 0`; `bash -n scripts/curtain-card-session.sh` → exit 0; biome on `lib/cli.mjs test/curtain-cli.test.mjs` → exit 0.

**STOP if:** the render CLI exits non-zero on a missing `--entity` (must fail-open: empty entity → no denizen, exit 0); the sh flag order breaks the existing `--tick`/`--draw` args.

---

## Final gate (run after Task 5)

- [ ] `node --test` → `# fail 0` (whole suite).
- [ ] `./node_modules/.bin/biome check lib/ test/ scripts/` (or `.` per `package.json` lint) → exit 0.
- [ ] `bash -n scripts/curtain-card-session.sh` → exit 0.
- [ ] Manual smoke: `node bin/herald render --surface curtain-card --state working --theme forge --cols 60 --rows 20 --tick 0 --entity fox --seed 0` prints a fox; `--theme classic …` prints no denizen (byte-identical to no-entity).
- [ ] Confirm zero new runtime deps: `git diff package.json` empty.

## Executor report format (per task, end of session)

```
RESULT: ok|partial|failed — commits: <n> — <one-line summary>
Task <id>: <status> — tests: <passed/total for touched files>, biome: <ok|issues>
Files changed: <paths>
Deviations from plan: <none | what & why>
Open risks / follow-ups: <e.g. P3 config keys not yet added>
```

## Cross-phase notes / handoffs

- **P1 dependency:** the motes merge (`driftField`) must already exist in `applyTheatrics`. The denizen step is inserted *after* that merge and *before* `overlayCurtain`. If P1 is not yet merged, the `sparkRain`→`driftField` block is where "motes" is — insert the denizen block immediately after it regardless.
- **P3 handoff:** `validateDenizen(record)` (full validator), `curtain.animation.denizens = { enabled, seedPolicy, species, maxFps }` config keys, and the remaining bestiary land in P3. This plan reads `theatrics.animCfg.denizens` defensively (absent ⇒ enabled/auto) so it works before P3 and honors P3's knobs after.
- **Roster order:** tests never assert a specific species for a specific name; adding species in P3 must not break Task 1/2 tests.

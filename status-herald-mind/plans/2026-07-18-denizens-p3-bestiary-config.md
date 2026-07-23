# Denizens P3 — Bestiary + Config + Validation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — implement this plan task-by-task in this session (write failing test → run → minimal impl → run → commit). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the denizens config surface (`curtain.animation.denizens`), a machine-verifier `validateDenizen(record)` that enforces per-tier geometry/whitespace/frame caps, a `cli.mjs` gate that honors `enabled` + `reducedMotion` (freeze to no-creature, byte-identical to the pre-denizen baseline), and the remaining bestiary (crab, frog, snail, bird, bug) — each authored, then machine-verified by a property test that ALL species pass `validateDenizen` and keep exact geometry.

**Architecture:** Pure data + pure validators, no new modules. Extend three existing files that P2 (plan 025) creates/owns — `lib/curtain/denizens.mjs` (logic), `lib/curtain/denizens-data.mjs` (authored art) — plus the two long-lived files `lib/config.mjs` (DEFAULTS) and `lib/cli.mjs` (`runRender` curtain-card branch). No render-loop changes: the denizen composite/tier math lives in P2's `renderCard`/`applyTheatrics`; P3 only feeds it a config-derived `enabled` flag and the authored roster. Validation is a pure `fn(record) -> issues[]` (no throw on the render path).

**Tech Stack:** Node ≥20 ESM, ZERO runtime deps (hard invariant). Tests: `node --test`. Lint: `./node_modules/.bin/biome check <paths>` (a.k.a. `npm run lint`). Baseline before this plan: `node --test` → `# pass 450 # fail 0`.

## Dependency & contract notes (read before task 1)

- **Depends on P2 (plan 025).** P2 creates `lib/curtain/denizens.mjs`, `lib/curtain/denizens-data.mjs`, `test/denizens.test.mjs`, the `DENIZENS` data shape, `speciesFor`/`tierFor`/`denizenCel`, the `--entity`/`--seed` seed funnel, and the `mergeDenizen` composite. **Treat the CROSS-PHASE INTERFACE CONTRACT below as authoritative** for those names/shapes; if P2's landed code diverges, reconcile to the contract before proceeding and STOP if the `DENIZENS` record shape differs from what task 2/3 assume.
- **`validateTheme` does not exist** in `lib/curtain/themes.mjs` (verified). The "mirror validateTheme" guidance means: mirror the *geometry-assertion style* already proven in `test/themes.test.mjs` (rectangular multi-row art, per-frame width checks — see the `forge` done-art test at `test/themes.test.mjs:76`). Design `validateDenizen` fresh; do not import a nonexistent helper.
- **`motionDisabled(anim)` already exists** at `lib/curtain/theatrics.mjs:9` — `anim.enabled === false || anim.reducedMotion === true`. Reuse it for the a11y gate; do not re-derive.

### Contract shapes this plan consumes (from P2)

```
DENIZENS (denizens-data.mjs): {
  [species]: {
    tiers: { full: {rows,cols}, compact: {rows,cols} },
    poses: { [state]: { full: frames[], compact: frames[] } }   // frames[] = array of cels; each cel = string[]
  }
}
STATES (required poses): working, done, needs, compacting, idle
```

### Standard tier geometry (P3 convention — ALL species incl. P2's fox/cat/owl must conform)

- `full`  = `{ rows: 3, cols: 12 }`
- `compact` = `{ rows: 2, cols: 8 }`

Authored cels are padded to the FULL tier rectangle (exact `rows`×`cols`, space-filled) so P2's `mergeDenizen` zone math is trivial and geometry stays exact. `validateDenizen` enforces `<=` caps (defensive); the geometry property test (task 3) additionally asserts `===` exact fit for every authored cel. If P2's fox/cat/owl were authored to different dims, the task-3 property test will fail on them — coordinate dims with P2 or widen the standard here and STOP to flag it.

## Global Constraints (hard invariants — copy, do not relitigate)

- **Zero runtime deps.** Node ≥20 ESM only. No new dependencies.
- **TDD required.** Bite-sized: write failing test → run it, see it fail → minimal impl → run, see it pass → commit. One commit per task.
- **Art is sacred.** No overlay ever overwrites a non-space base cell; all compositing paints into whitespace only (P2's `mergeDenizen`). `validateDenizen` guarantees cels are rectangular + control-char-free so the whitespace-only paint keeps exact geometry.
- **No `Math.random` / no `Date.now` in the render path.** Variation comes only from the injected `seed`/`entity`. `validateDenizen` and the config read are pure.
- **No strobe (WCAG 2.3.1).** Not exercised directly here, but denizen frame caps (`≤8`) and the `maxFps` knob keep cadence soft; do not add a hard blink.
- **Exact geometry.** `renderCard` returns exactly `rows` strings at every tier; authored cels are exact rectangles.
- **Motion-off / reducedMotion / classic contract.** With `curtain.animation.enabled:false` OR `reducedMotion:true`, OR theme `classic`, the denizen composite is skipped entirely → output byte-identical to the pre-denizen baseline. This is the acceptance gate for task 4.
- **Fail-open on render paths.** `runRender` and the cli gate never throw; empty + exit 0 beats an error. `validateDenizen` returns an issues array (never throws) so callers choose.
- **Full suite green after every task:** `node --test` → `# fail 0` and `./node_modules/.bin/biome check <touched paths>` → exit 0.
- **No live side effects in tests.** No `herald curtain install`, no mutating a live tmux server. cli e2e tests point `HERALD_CONFIG` at a temp file and unset `TMUX`/`TMUX_PANE` (mirror `test/curtain-cli.test.mjs:72` `cliEnv`).

---

## Task 1 — Config: `curtain.animation.denizens` defaults

**Files**
- Modify `lib/config.mjs` — `DEFAULTS.curtain.animation` object (currently lines 25–31; the `animation` block closes at line 31 before `tmuxBar`).
- Modify `test/config.test.mjs` — add tests near the existing `animation defaults …` test (lines 77–98).

**Interfaces**
- Consumes: `merge` / `loadConfig` (already exported, `lib/config.mjs:90,110`).
- Produces: `DEFAULTS.curtain.animation.denizens = { enabled: true, seedPolicy: "deterministic", species: "auto", maxFps: 8 }`. Deep-merge semantics inherited from `merge` (`config.mjs:90`) — partial overrides preserve siblings.

**TDD Steps**
- [ ] In `test/config.test.mjs`, add `test("curtain.animation.denizens defaults are enabled+deterministic+auto+maxFps8", …)`. Assert against `loadConfig(join(tmpdir(),"nope-herald-deniz.json")).curtain.animation.denizens`:
  - `d.enabled === true`
  - `d.seedPolicy === "deterministic"`
  - `d.species === "auto"`
  - `d.maxFps === 8`
- [ ] Add `test("denizens can be disabled via merge without dropping animation siblings", …)`:
  - `const off = merge(DEFAULTS, { curtain: { animation: { denizens: { enabled: false } } } });`
  - `assert.equal(off.curtain.animation.denizens.enabled, false);`
  - `assert.equal(off.curtain.animation.denizens.maxFps, 8, "unset denizen keys keep defaults");`
  - `assert.equal(off.curtain.animation.fps, 2, "sibling animation knobs preserved");`
  - `assert.equal(off.curtain.animation.drawFrames, 8);`
- [ ] Add `test("denizens species can be pinned to a named creature via merge", …)`:
  - `const pin = merge(DEFAULTS, { curtain: { animation: { denizens: { species: "owl" } } } });`
  - `assert.equal(pin.curtain.animation.denizens.species, "owl");`
  - `assert.equal(pin.curtain.animation.denizens.enabled, true);`
- [ ] Run `node --test test/config.test.mjs` → new tests FAIL (`denizens` undefined).
- [ ] Minimal impl in `lib/config.mjs` — extend the `animation` block (insert after `drawMs: 600,` at line 30, before the closing `},` at line 31):

```js
    animation: {
      enabled: true,
      fps: 2,
      reducedMotion: false,
      drawFrames: 8, // 6–10 stage-curtain shut/open frames
      drawMs: 600, // full draw budget (≤ ~600ms)
      // Act II denizens: deterministic per-tab reactive creature. Gated by the
      // shared enabled/reducedMotion knobs above (see lib/curtain/theatrics.mjs
      // motionDisabled) and skipped on `classic` for byte-identical baseline.
      // species: "auto" => hash the session name (speciesFor); or pin a name.
      denizens: {
        enabled: true,
        seedPolicy: "deterministic",
        species: "auto",
        maxFps: 8,
      },
    },
```

- [ ] Run `node --test test/config.test.mjs` → PASS.
- [ ] Run full suite `node --test` → `# fail 0`.
- [ ] `./node_modules/.bin/biome check lib/config.mjs test/config.test.mjs` → exit 0.

**Verification**
```
node --test test/config.test.mjs
node --test
./node_modules/.bin/biome check lib/config.mjs test/config.test.mjs
```

**STOP if:** the `animation` block shape has changed since this plan (e.g. P1 already added a `denizens` or `motes` key) — reconcile rather than duplicate; do not add a second `denizens` key.

---

## Task 2 — `validateDenizen(record)` geometry/whitespace/frame-cap verifier

**Files**
- Modify `lib/curtain/denizens.mjs` (P2-created logic module) — add `validateDenizen` + the exported constants. Place near the top-level exports, alongside `speciesFor`/`tierFor`/`denizenCel`.
- Modify `test/denizens.test.mjs` (P2-created) — add a `validateDenizen` describe/tests block.

**Interfaces**
- Consumes: the `DENIZENS` record shape (contract above). `validateDenizen` takes ONE species record `{ tiers, poses }`, not the whole `DENIZENS` map.
- Produces (exact signatures — other phases/tests import these verbatim):
  - `export const DENIZEN_MAX_FRAMES = 8;`
  - `export const REQUIRED_POSES = ["working", "done", "needs", "compacting", "idle"];`
  - `export const DENIZEN_TIERS = ["full", "compact"];`
  - `export const validateDenizen = (record, name = "?") => string[]` — returns an array of human-readable issue strings; empty array ⇔ valid. NEVER throws (fail-open).

**TDD Steps**
- [ ] In `test/denizens.test.mjs`, add `test("validateDenizen returns [] for a well-formed exact-fit record", …)`. Build a minimal valid record with the standard dims and assert `assert.deepEqual(validateDenizen(rec, "unit"), [])`:

```js
const cel = (rows, cols) => Array.from({ length: rows }, () => " ".repeat(cols));
const validRec = {
  tiers: { full: { rows: 3, cols: 12 }, compact: { rows: 2, cols: 8 } },
  poses: Object.fromEntries(
    ["working", "done", "needs", "compacting", "idle"].map((s) => [
      s,
      { full: [cel(3, 12), cel(3, 12)], compact: [cel(2, 8), cel(2, 8)] },
    ]),
  ),
};
```

- [ ] Add `test("validateDenizen flags a cel wider than its tier cols", …)`:
  - clone `validRec`, set `bad.poses.working.full = [["x".repeat(13), " ".repeat(12), " ".repeat(12)]]` (width 13 > 12).
  - `const issues = validateDenizen(bad, "wide");`
  - `assert.ok(issues.some((i) => /working\.full/.test(i) && /width/.test(i)), issues.join("|"));`
- [ ] Add `test("validateDenizen flags a cel taller than its tier rows", …)`:
  - `bad.poses.idle.compact = [cel(3, 8)]` (3 rows > 2).
  - `assert.ok(validateDenizen(bad).some((i) => /idle\.compact/.test(i) && /height/.test(i)));`
- [ ] Add `test("validateDenizen flags a non-rectangular cel (ragged rows)", …)`:
  - `bad.poses.done.full = [["aaaa", "aaaaaa", "aa"]]` (unequal widths).
  - `assert.ok(validateDenizen(bad).some((i) => /rectangular/.test(i)));`
- [ ] Add `test("validateDenizen flags control whitespace (tab/newline) in art", …)`:
  - `bad.poses.needs.full = [["a\tb", "cc ", "dd "]]`.
  - `assert.ok(validateDenizen(bad).some((i) => /control|whitespace/.test(i)));`
- [ ] Add `test("validateDenizen flags a pose with more than 8 frames", …)`:
  - `bad.poses.working.compact = Array.from({length: 9}, () => cel(2, 8));`
  - `assert.ok(validateDenizen(bad).some((i) => /frames/.test(i) && /8/.test(i)));`
- [ ] Add `test("validateDenizen flags a missing required pose", …)`:
  - `delete bad.poses.compacting;`
  - `assert.ok(validateDenizen(bad).some((i) => /compacting/.test(i) && /missing/.test(i)));`
- [ ] Add `test("validateDenizen never throws on garbage input", …)`:
  - `assert.deepEqual(Array.isArray(validateDenizen(null)), true);`
  - `assert.ok(validateDenizen(undefined).length > 0);`
  - `assert.ok(validateDenizen(42).length > 0);`
- [ ] Run `node --test test/denizens.test.mjs` → new tests FAIL (`validateDenizen` undefined).
- [ ] Minimal impl — add to `lib/curtain/denizens.mjs` (CRUX, verbatim):

```js
export const DENIZEN_MAX_FRAMES = 8;
export const REQUIRED_POSES = ["working", "done", "needs", "compacting", "idle"];
export const DENIZEN_TIERS = ["full", "compact"];

// Pure verifier for ONE species record { tiers, poses }. Returns an array of
// issue strings; [] means valid. NEVER throws (fail-open — callers decide
// whether to throw). Enforces, per tier: width <= cols, height <= rows, every
// cel rectangular (all rows equal width), no control whitespace (\t \r \n) that
// would break exact geometry, and frames <= DENIZEN_MAX_FRAMES.
export const validateDenizen = (record, name = "?") => {
  const issues = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    issues.push(`${name}: not a denizen record object`);
    return issues;
  }
  const tiers = record.tiers || {};
  const dims = {};
  for (const tier of DENIZEN_TIERS) {
    const d = tiers[tier];
    if (
      !d ||
      !Number.isInteger(d.rows) ||
      !Number.isInteger(d.cols) ||
      d.rows <= 0 ||
      d.cols <= 0
    ) {
      issues.push(`${name}.tiers.${tier}: missing/invalid {rows,cols}`);
    } else {
      dims[tier] = d;
    }
  }
  const poses = record.poses || {};
  for (const pose of REQUIRED_POSES) {
    const p = poses[pose];
    if (!p || typeof p !== "object") {
      issues.push(`${name}.poses.${pose}: missing`);
      continue;
    }
    for (const tier of DENIZEN_TIERS) {
      const dim = dims[tier];
      const frames = p[tier];
      if (!Array.isArray(frames) || frames.length === 0) {
        issues.push(`${name}.poses.${pose}.${tier}: no frames`);
        continue;
      }
      if (frames.length > DENIZEN_MAX_FRAMES) {
        issues.push(
          `${name}.poses.${pose}.${tier}: ${frames.length} frames > ${DENIZEN_MAX_FRAMES}`,
        );
      }
      frames.forEach((cel, fi) => {
        const loc = `${name}.poses.${pose}.${tier}[${fi}]`;
        if (!Array.isArray(cel)) {
          issues.push(`${loc}: cel is not an array of rows`);
          return;
        }
        if (dim && cel.length > dim.rows) {
          issues.push(`${loc}: height ${cel.length} > ${dim.rows}`);
        }
        // Width via spread => code-point count (== display cols for the
        // single-width BMP glyphs denizen art uses).
        let w0 = null;
        for (let ri = 0; ri < cel.length; ri++) {
          const row = cel[ri];
          if (typeof row !== "string") {
            issues.push(`${loc} row ${ri}: not a string`);
            continue;
          }
          if (/[\t\r\n]/.test(row)) {
            issues.push(`${loc} row ${ri}: control whitespace not allowed`);
          }
          const w = [...row].length;
          if (w0 === null) w0 = w;
          else if (w !== w0) {
            issues.push(`${loc}: not rectangular (row ${ri} width ${w} != ${w0})`);
          }
          if (dim && w > dim.cols) {
            issues.push(`${loc} row ${ri}: width ${w} > cols ${dim.cols}`);
          }
        }
      });
    }
  }
  return issues;
};
```

- [ ] Run `node --test test/denizens.test.mjs` → PASS.
- [ ] Run full suite `node --test` → `# fail 0`.
- [ ] `./node_modules/.bin/biome check lib/curtain/denizens.mjs test/denizens.test.mjs` → exit 0.

**Verification**
```
node --test test/denizens.test.mjs
node --test
./node_modules/.bin/biome check lib/curtain/denizens.mjs test/denizens.test.mjs
```

**STOP if:** P2 already exports a `validateDenizen` (or a differently-named validator) — do not create a second one; extend/rename to this contract signature and update P2's callers, then continue.

---

## Task 3 — Bestiary: author crab, frog, snail, bird, bug + all-species property test

**Files**
- Modify `lib/curtain/denizens-data.mjs` (P2-created) — add 5 species keys to the `DENIZENS` map: `crab`, `frog`, `snail`, `bird`, `bug`. (P2 supplies `fox`, `cat`, `owl`.)
- Modify `test/denizens.test.mjs` — add the cross-species property + exact-geometry tests.

**Interfaces**
- Consumes: `validateDenizen`, `REQUIRED_POSES`, `DENIZEN_TIERS` (task 2); `DENIZENS` (P2).
- Produces: `DENIZENS.crab`, `.frog`, `.snail`, `.bird`, `.bug`, each shaped `{ tiers: { full:{rows:3,cols:12}, compact:{rows:2,cols:8} }, poses: { working|done|needs|compacting|idle: { full: cel[], compact: cel[] } } }`.

**Art matrix (authored during execution — dimensions & counts are fixed here):**

| axis | values | count |
|------|--------|-------|
| species | crab, frog, snail, bird, bug | 5 |
| tier | full (3×12), compact (2×8) | 2 |
| pose (state) | working, done, needs, compacting, idle | 5 |
| cels per pose | 2–3 (idle MAY be 1; done ≥2 with `settleAfter` semantics owned by P2) | 2–3 |

Every cel is authored as an EXACT rectangle: `full` = 3 rows × 12 cols, `compact` = 2 rows × 8 cols, space-padded. Plain ASCII + single-width box glyphs only (no `\t`/`\r`/`\n`, no zero/double-width glyphs). Pose intent mirrors the spec's reactive personality: `working` = busy/moving, `done` = celebrating, `needs` = worried, `compacting` = sleeping/settling, `idle` = calm. The **machine verifier is the gate** — art correctness is proven by `validateDenizen` + the exact-geometry test below, not by eyeballing.

Suggested per-species silhouette hints (executor may refine, must keep exact dims): crab `(v)` claws with side-scuttle offset between cels; frog `oo` eyes + hop baseline shift; snail spiral shell `@` with a slow trail dot; bird `v`/`^` wing-flap alternation; bug `,,` legs + antenna twitch. Compact tier keeps only the head/signature row.

**TDD Steps**
- [ ] In `test/denizens.test.mjs`, add `test("every species in DENIZENS passes validateDenizen with zero issues", …)`:

```js
for (const [name, rec] of Object.entries(DENIZENS)) {
  const issues = validateDenizen(rec, name);
  assert.deepEqual(issues, [], `${name}: ${issues.join(" | ")}`);
}
```

- [ ] Add `test("the P3 roster species are present", …)`:
  - `for (const s of ["crab","frog","snail","bird","bug"]) assert.ok(DENIZENS[s], `missing ${s}`);`
- [ ] Add `test("every species cel is an EXACT rectangle at its tier dims", …)` (stronger than validateDenizen's `<=`):

```js
for (const [name, rec] of Object.entries(DENIZENS)) {
  for (const tier of ["full", "compact"]) {
    const { rows, cols } = rec.tiers[tier];
    for (const pose of ["working", "done", "needs", "compacting", "idle"]) {
      for (const [fi, cel] of rec.poses[pose][tier].entries()) {
        assert.equal(cel.length, rows, `${name}.${pose}.${tier}[${fi}] rows`);
        for (const [ri, row] of cel.entries())
          assert.equal([...row].length, cols,
            `${name}.${pose}.${tier}[${fi}] row ${ri} cols`);
      }
    }
  }
}
```

- [ ] Add `test("every species uses the standard tier geometry (3x12 / 2x8)", …)`:
  - `for (const rec of Object.values(DENIZENS)) { assert.deepEqual(rec.tiers.full, {rows:3,cols:12}); assert.deepEqual(rec.tiers.compact, {rows:2,cols:8}); }`
- [ ] Add `test("each pose has 2–3 cels per tier (idle may be 1)", …)`:
  - iterate; assert `cel-count >= 1 && <= 3`, and for poses other than `idle` assert `>= 2`.
- [ ] Run `node --test test/denizens.test.mjs` → property tests FAIL (species absent / not yet exact).
- [ ] Author the 5 species in `lib/curtain/denizens-data.mjs` to satisfy every assertion (exact rectangles, 2–3 cels, all 5 poses × 2 tiers). Iterate: run the test, read the failing `assert` message (it names `species.pose.tier[frame] row`), fix that cel, repeat until green. (This is the intended authoring loop — the message pinpoints the offending row.)
- [ ] Run `node --test test/denizens.test.mjs` → PASS.
- [ ] Run full suite `node --test` → `# fail 0` (confirms P2's fox/cat/owl also conform to the standard dims; if they fail, STOP and reconcile dims per the contract note).
- [ ] `./node_modules/.bin/biome check lib/curtain/denizens-data.mjs test/denizens.test.mjs` → exit 0.

**Verification**
```
node --test test/denizens.test.mjs
node --test
./node_modules/.bin/biome check lib/curtain/denizens-data.mjs test/denizens.test.mjs
```

**STOP if:** P2's existing fox/cat/owl were authored to different tier dims than 3×12 / 2×8 — the "exact rectangle" and "standard tier geometry" tests will fail on them. Either re-author P2's art to the standard (preferred, keeps one geometry) or update the standard dims in tasks 2/3 consistently; flag the choice in the executor report.

---

## Task 4 — cli gate: honor `denizens.enabled` + `reducedMotion`, byte-identical when off

**Files**
- Modify `lib/cli.mjs` — `runRender` curtain-card branch (the inner block at lines 112–148; `animCfg` is read at line 115) and the theatrics-import line (line 33 imports from `./curtain/theatrics.mjs`).
- Modify `test/curtain-cli.test.mjs` — add a source-assertion test + an end-to-end render test (mirror the `runCli`/`cliEnv` harness at `test/curtain-cli.test.mjs:72-84`).

**Interfaces**
- Consumes: `loadConfig()` (`config.mjs`), `motionDisabled` (`lib/curtain/theatrics.mjs:9`), `cfg.curtain.animation.denizens` (task 1), `f.entity` / `f.seed` / `f.theme` / `f.tick` (P2's `--entity`/`--seed` flags parsed by `parseFlags`).
- Produces: on the `theatrics` object passed to `renderCardFrame`, a `denizens` sub-object:

```js
denizens: {
  enabled: <boolean>,   // config denizens.enabled && theme!=='classic' && !motionDisabled(animCfg)
  species: <string>,    // f.entity || "" (P2 seed funnel supplies it)
  seed: <number>,       // Number(f.seed) || 0
  maxFps: <number>,     // Number(denizCfg.maxFps) || 8
}
```

P2's `renderCard`/composite reads `theatrics.denizens.enabled`; when `false` it skips `mergeDenizen` entirely → no creature painted → byte-identical to the pre-denizen baseline. P3 owns only the gate value; P2 owns the paint.

**TDD Steps**
- [ ] In `test/curtain-cli.test.mjs`, add `test("runRender reads animation.denizens and gates it on motionDisabled + theme", …)` (source-grep style, mirrors the `case "status"` test at line 132):

```js
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "lib/cli.mjs"), "utf8");
assert.match(src, /animCfg\.denizens/, "reads the denizens config block");
assert.match(src, /motionDisabled/, "imports/uses the a11y gate");
// gate must fold in the classic exclusion (byte-identical baseline)
assert.match(src, /themeName !== "classic"/);
```

- [ ] Add `test("curtain-card render with denizens disabled is byte-identical to no-denizen baseline", …)` — e2e via the `runCli`/`cliEnv` harness:
  - Write temp config A: `{ curtain: { animation: { denizens: { enabled: false } } } }`.
  - Write temp config B: `{ curtain: { animation: { enabled: false } } }` (whole-animation off).
  - `const args = ["render","--surface","curtain-card","--theme","forge","--state","working","--cols","40","--rows","10","--tick","3","--entity","crab","--seed","7"];`
  - `const off = runCli(args, { HERALD_CONFIG: pA });`
  - `const reduced = runCli([...args], { HERALD_CONFIG: pReduced });` where pReduced = `{ curtain: { animation: { reducedMotion: true } } }`.
  - Assert `off` and `reduced` render frames contain NO denizen-only glyphs from the crab cels (choose a signature glyph the crab art uses, e.g. `(` claws) beyond what the base card already contains — simplest robust assertion: strip SGR and assert the frame equals the same render run with `denizens.enabled:false` produced by config B for the geometry rows. Concretely assert **stable geometry**: `stripSgr(off).split("\n").length === 10` (exact `rows`) and that `off` is deterministic (`runCli(args,{HERALD_CONFIG:pA})` twice ⇒ identical strings).
  - Assert determinism regardless: `assert.equal(runCli(args,{HERALD_CONFIG:pA}), runCli(args,{HERALD_CONFIG:pA}));`
- [ ] Add `test("curtain-card render with denizens enabled stays exact geometry (rows lines)", …)`:
  - config C: `{}` (defaults ⇒ denizens on). Render with `forge` theme (non-classic) and assert `stripSgr(out).split("\n")` has exactly `rows` (10) entries, each `visibleWidth === cols` is NOT required here (SGR/newline handling owned by renderCard) — assert line count only, proving exact geometry survives the enabled path.
- [ ] Run `node --test test/curtain-cli.test.mjs` → new tests FAIL (`animCfg.denizens` not referenced; gate absent).
- [ ] Minimal impl in `lib/cli.mjs`:
  - Extend the theatrics import (line 33) to include `motionDisabled`:
    ```js
    import { motionDisabled, selectEffects } from "./curtain/theatrics.mjs";
    ```
  - Inside the curtain-card block, after `const animCfg = cfg.curtain?.animation || {};` (line 115), compute the gate:
    ```js
    const denizCfg = animCfg.denizens || {};
    // Denizens are skipped on classic (byte-identical baseline) and whenever
    // motion is off / reducedMotion is set. Species is injected via the P2 seed
    // funnel (--entity); config only gates + caps cadence.
    const denizensOn =
      denizCfg.enabled !== false &&
      themeName !== "classic" &&
      !motionDisabled(animCfg);
    ```
    Note `themeName` is declared at line 113 (`const themeName = f.theme || "classic";`) — the new block sits just below it and `animCfg`.
  - Add the `denizens` sub-object to the `theatrics` object literal (currently lines 124–135), e.g. after `sparkFrames: 5,`:
    ```js
        sparkFrames: 5,
        denizens: {
          enabled: denizensOn,
          species: f.entity || "",
          seed: Number(f.seed) || 0,
          maxFps: Number(denizCfg.maxFps) || 8,
        },
    ```
- [ ] Run `node --test test/curtain-cli.test.mjs` → PASS.
- [ ] Run full suite `node --test` → `# fail 0`.
- [ ] `./node_modules/.bin/biome check lib/cli.mjs test/curtain-cli.test.mjs` → exit 0.

**Verification**
```
node --test test/curtain-cli.test.mjs
node --test
./node_modules/.bin/biome check lib/cli.mjs test/curtain-cli.test.mjs
```

**STOP if:** P2 already added a `denizens` sub-object to the theatrics literal (its seed funnel may thread `entity`/`seed` there). If so, do NOT duplicate — add only the `enabled` gate (`denizensOn`) and the `themeName !== "classic"` + `motionDisabled` conditions to the existing object, leaving P2's `species`/`seed` wiring intact.

---

## Executor report format (end of run)

Report exactly:

```
RESULT: ok|partial|failed — commits: <n> — <one-line summary>

Per task:
- T1 config denizens defaults: <done|skipped> — commit <sha>
- T2 validateDenizen: <done|skipped> — commit <sha>
- T3 bestiary crab/frog/snail/bird/bug + property test: <done|skipped> — commit <sha>
- T4 cli denizen gate (byte-identical when off): <done|skipped> — commit <sha>

Verification:
- node --test => # pass <N> # fail <M>   (baseline was 450 pass)
- biome check <touched paths> => exit <code>

Contract reconciliations (if any):
- <e.g. "P2 authored fox at 3x10; re-authored to standard 3x12" | "none">

Open risks / follow-ups:
- <e.g. "P2 not yet merged — denizens.mjs/denizens-data.mjs stubbed; needs rebase" | "none">
```

One commit per task (`feat(denizens): …` / `test(denizens): …`). Never push, never merge to `main`. If P2 is not present in the working tree, STOP after task 1 and report `partial` — tasks 2–4 require P2's `denizens.mjs`/`denizens-data.mjs`.

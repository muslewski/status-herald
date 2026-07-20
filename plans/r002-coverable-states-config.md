# Plan r002: drive COVERABLE from config (include compacting)

> **For the executor:** REQUIRED — TDD. Touch only in-scope files. If any STOP
> fires, halt and report. Do not edit `plans/revision-README.md`.
> Parent: 013 / config. Cluster: C1. Phase: 1.

**Goal:** Honor `curtain.coverableStates` for per-tab cover/focus; default must include `compacting`; grid orchestrator COVERABLE includes compacting; tests lock the contracts.

**Architecture:** Export a small helper `coverableSet(cfg)` from `session.mjs` (or inline from `cfg.coverableStates` with safe fallback). Default in `config.mjs` becomes `["working","done","needs","compacting"]`. `cover` / `focus` use the set from cfg. Grid `orchestrator.mjs` adds `STATES.COMPACTING` to its COVERABLE set (grid has no config injection today — match Plan 013 compacting-is-coverable).

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, `./node_modules/.bin/biome`.

## Status

- **Severity:** P1 (config drift) + P2 (grid/tests)
- **Effort:** M
- **Parent plan(s):** 013, README config reference
- **Cluster:** C1
- **Planned at:** `16f4a3f`
- **Depends on:** none (file-disjoint from r001/r003)

## Why this matters

Config documents `coverableStates` but cover/focus ignore it. Default omits `compacting` while code hardcodes compacting coverable — operators cannot tune coverability, and docs lie.

## Evidence

- `lib/config.mjs:8` — default `["working","done","needs"]` only
- `lib/curtain/session.mjs:38–43,102` — hardcoded `COVERABLE` including COMPACTING; ignores cfg
- `lib/curtain/orchestrator.mjs:5` — grid omits COMPACTING
- Tests never assert compacting cover or config override

## Files

- In scope: `lib/config.mjs`, `lib/curtain/session.mjs`, `lib/curtain/orchestrator.mjs`, `test/config.test.mjs`, `test/session.test.mjs`, `test/orchestrator.test.mjs`
- Out of scope: 020 paths, `lib/cli.mjs`, install/grid hook absolute path (r003), live tmux

## Steps

- [ ] **Step 1: Failing tests**

1. `test/config.test.mjs` — default `coverableStates` includes `"compacting"` (update existing assertion that expects only three).

2. `test/session.test.mjs` — after existing coverable test, add:

```js
test("cover covers compacting state", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "compacting");
  cover("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
});

test("coverableStates config can exclude done", () => {
  const t = makeT(freshSession());
  arm("s1", t, { coverableStates: ["working", "needs", "compacting"] });
  t.setSessOpt("s1", "@herald_state", "done");
  cover("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "0", "done not coverable");
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
});
```

(Adjust `arm` third-arg shape if `arm` expects full curtain cfg — use the same pattern as theme tests: pass `{ coverableStates: [...], theme: "classic", animation: { fps: 2 } }` or whatever arm already accepts via `cfg = loadConfig().curtain`.)

3. Grok Stop synthesis (C1a-F4):

```js
test("id-set: Grok Stop without tasks keeps WORKING while subagent ids remain", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const start = (id) => ({
    event: "SubagentStart",
    agentId: id,
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
  });
  stampFromHook("%9", start("g1"), 1000, t);
  stampFromHook(
    "%9",
    { event: "Stop", hasTasks: false, subagents: 0, shells: 0, subagentIds: [] },
    2000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "1");
});
```

4. `test/orchestrator.test.mjs` — focus-out covers compacting:

```js
test("onFocusOut covers compacting live pane", () => {
  const t = fake({
    opts: {
      "%5": {
        "@herald_role": "live",
        "@herald_peer": "%9",
        "@herald_state": "compacting",
      },
      "%9": { "@herald_peer": "%5" },
    },
    win: { "%5": "grid", "%9": "_holding" },
  });
  onFocusOut("%5", t);
  assert.equal(t.calls.swaps.length, 1);
});
```

- [ ] **Step 2: Run focused tests — expect FAIL**

```bash
node --test test/config.test.mjs test/session.test.mjs test/orchestrator.test.mjs
```

- [ ] **Step 3: Implement**

1. `lib/config.mjs`: set `coverableStates: ["working", "done", "needs", "compacting"]`.

2. `lib/curtain/session.mjs`: replace module-level COVERABLE usage with:

```js
const defaultCoverable = () =>
  new Set([STATES.WORKING, STATES.COMPACTING, STATES.DONE, STATES.NEEDS]);

const coverableFrom = (cfg) => {
  const list = cfg?.coverableStates;
  if (!Array.isArray(list) || list.length === 0) return defaultCoverable();
  return new Set(list.map(String));
};
```

In `cover` and wherever focus checks coverable (`focus` path around line 141), use `coverableFrom(cfg).has(state)` instead of `COVERABLE.has(...)`.

Pass `cfg` through (already a parameter on cover/focus/arm).

3. `lib/curtain/orchestrator.mjs`:

```js
const COVERABLE = new Set([
  STATES.WORKING,
  STATES.COMPACTING,
  STATES.DONE,
  STATES.NEEDS,
]);
```

- [ ] **Step 4: Tests PASS**

```bash
node --test test/config.test.mjs test/session.test.mjs test/orchestrator.test.mjs
```

- [ ] **Step 5: Full suite + biome**

```bash
node --test
./node_modules/.bin/biome check lib/config.mjs lib/curtain/session.mjs lib/curtain/orchestrator.mjs test/config.test.mjs test/session.test.mjs test/orchestrator.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add lib/config.mjs lib/curtain/session.mjs lib/curtain/orchestrator.mjs \
  test/config.test.mjs test/session.test.mjs test/orchestrator.test.mjs
git commit -m "fix(curtain): honor coverableStates; compacting coverable by default (r002)"
```

## STOP conditions

- arm/cover signature change would break many call sites without a clear pattern — match existing `cfg` injection from theme tests
- 020 modules required
- live tmux required

## Executor report format

```
STATUS: COMPLETE | STOPPED
STEPS: ...
FILES CHANGED: ...
NOTES: ...
```

# Plan r001: status reads session-scoped @herald_state

> **For the executor:** REQUIRED — TDD. Touch only in-scope files. If any STOP
> fires, halt and report. Do not edit `plans/revision-README.md` (advisor owns it).
> Parent product plan(s): 013 / per-tab design. Cluster: C1. Campaign phase: 1.

**Goal:** Make `herald curtain status` report the same session-scoped `@herald_state` that hooks and the card use, not pane-scoped options that are never written in per-tab mode.

**Architecture:** Resolve `TMUX_PANE` → session via `sessionOf`, then `getSessOpt(sess, "@herald_state")`. Keep fail-open: missing pane → "not in tmux"; missing state → "idle".

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, `./node_modules/.bin/biome`.

## Status

- **Severity:** P1
- **Effort:** S
- **Parent plan(s):** 013, per-tab design (session-scoped @herald_*)
- **Cluster:** C1
- **Planned at:** `16f4a3f`
- **Depends on:** none

## Why this matters

Operators running `herald curtain status` from a pane always see `idle` while the card correctly shows working/done/needs, because stamps go to session options and status reads pane options.

## Evidence

**Required:** `@herald_state` is session-scoped; debug/status tools must report the options hooks write.

**Actual:**

- `lib/curtain/session.mjs` — `stampFromHook` / `arm` use `setSessOpt(sess, "@herald_state", …)`
- `lib/cli.mjs` ~146–151 — `status` uses `getOpt(pane, "@herald_state")` (`show -p`)
- `lib/cli.mjs` inspect path already uses `getSessOpt` correctly

**Gap class:** wrong

## Files

- In scope: `lib/cli.mjs`, `test/curtain-cli.test.mjs`
- Out of scope: `lib/status/tmux-status.mjs`, `lib/status/background.mjs`, `test/status-surfaces.test.mjs`, `plans/020-*`, live tmux, `~/.claude` mutation, `lib/curtain/session.mjs`

## Steps

- [ ] **Step 1: Write the failing test**

In `test/curtain-cli.test.mjs`, add a source-contract test (hermetic, no live tmux) that fails on current code:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

test("curtain status uses session-scoped @herald_state (not pane getOpt alone)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(join(root, "lib/cli.mjs"), "utf8");
  // status case must resolve session and use getSessOpt for @herald_state
  assert.match(src, /case "status"/);
  const statusBlock = src.slice(src.indexOf('case "status"'), src.indexOf('case "install"'));
  assert.match(statusBlock, /sessionOf/);
  assert.match(statusBlock, /getSessOpt/);
  assert.doesNotMatch(
    statusBlock,
    /getOpt\(\s*pane\s*,\s*["']@herald_state["']\s*\)/,
    "must not read @herald_state via pane getOpt",
  );
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test test/curtain-cli.test.mjs
```

Expected: new test FAIL (status still uses getOpt).

- [ ] **Step 3: Minimal implementation**

In `lib/cli.mjs` case `"status"`:

```js
case "status": {
  const pane = process.env.TMUX_PANE;
  if (!pane) {
    process.stdout.write("not in tmux\n");
    return 0;
  }
  const sess = sessionOf(pane);
  const state = sess
    ? getSessOpt(sess, "@herald_state") || "idle"
    : "idle";
  process.stdout.write(`${pane}: ${state}\n`);
  return 0;
}
```

(`sessionOf` and `getSessOpt` are already imported.)

- [ ] **Step 4: Run test — expect PASS**

```bash
node --test test/curtain-cli.test.mjs
```

- [ ] **Step 5: Full suite + biome**

```bash
node --test
./node_modules/.bin/biome check lib/cli.mjs test/curtain-cli.test.mjs
```

Expected: `# fail 0`; biome exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/cli.mjs test/curtain-cli.test.mjs
git commit -m "fix(curtain): status reads session-scoped @herald_state (r001)"
```

## STOP conditions

- Need to mutate live tmux or operator config
- Fix requires 020 modules
- Shared file owned by another in-flight executor

## Executor report format

```
STATUS: COMPLETE | STOPPED
STEPS: ...
FILES CHANGED: ...
NOTES: ...
```

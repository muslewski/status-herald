# Plan r004: framed/forge cards still append dynamic info lines (test)

> **For the executor:** REQUIRED — TDD. Test-first; implement only if test proves code gap.
> Parent: 014 theme shape. Cluster: C2. Phase: 1.

**Goal:** Lock the plan contract that framed themes still show dynamic lines (elapsed / subagent counts) under the art — currently composition exists but is untested on forge path.

**Architecture:** Characterization test only expected if `renderCard` already concatenates `info` under frames (`curtain-card.mjs` ~127). If the test fails, fix the minimal composition bug; do not redesign themes.

**Tech Stack:** Node ≥20 ESM, `node --test`, biome.

## Status

- **Severity:** P1 (weak-test on load-bearing contract)
- **Effort:** S
- **Parent plan(s):** 014
- **Cluster:** C2
- **Planned at:** `16f4a3f`
- **Depends on:** none (only `test/curtain-card.test.mjs` + maybe `lib/surfaces/curtain-card.mjs`)

## Why this matters

Without this assertion, a regression that drops `info` under frames (art-only card, no timer/subs) still passes the suite.

## Evidence

- Plan 014: theme owns art; herald owns dynamic lines below
- `lib/surfaces/curtain-card.mjs:127-128` — `.concat(info)` present
- forge tests only check art geometry

## Files

- In scope: `test/curtain-card.test.mjs`, `lib/surfaces/curtain-card.mjs` (only if test fails for real gap)
- Out of scope: everything else, 020

## Steps

- [ ] **Step 1: Write the test**

```js
test("forge framed working card still shows elapsed and subagent info under art", () => {
  const lines = renderCard(
    "working",
    65, // elapsed seconds
    40,
    20,
    { subagents: 2, shells: 0, worked: 0 },
    BUILTINS.forge,
    0,
  ).map(plain);
  const joined = lines.join("\n");
  // elapsed formatter is m:ss — 65s => 1:05
  assert.match(joined, /1:05/);
  assert.match(joined, /2/); // subagent count appears (glyph or number — match existing infoLines format)
});
```

Inspect `infoLines` in `curtain-card.mjs` for exact string format and assert that.

- [ ] **Step 2: Run**

```bash
node --test test/curtain-card.test.mjs
```

If PASS already: keep the test (it was the gap — characterization). If FAIL: minimal fix in `renderCard` so framed path still concat info.

- [ ] **Step 3: Full suite + biome + commit**

```bash
node --test
./node_modules/.bin/biome check test/curtain-card.test.mjs lib/surfaces/curtain-card.mjs
git add test/curtain-card.test.mjs lib/surfaces/curtain-card.mjs
git commit -m "test(curtain): framed forge card keeps dynamic info lines (r004)"
```

## STOP conditions

- infoLines format unclear and would require large redesign — STOP and report observed format

## Executor report format

```
STATUS: COMPLETE | STOPPED
STEPS: ...
FILES CHANGED: ...
NOTES: ...
```

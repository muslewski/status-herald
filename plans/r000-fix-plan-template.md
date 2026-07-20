# Plan rNNN: <slug>

> **For the executor:** REQUIRED — TDD. Touch only in-scope files. If any STOP
> fires, halt and report. Do not edit `plans/revision-README.md` (advisor owns it).
> Parent product plan(s): <e.g. 015>. Cluster: <C3>. Campaign phase: <2>.

**Goal:** <one sentence — the gap to close>

**Architecture:** Minimal fix to satisfy the parent plan contract; no drive-by refactors.

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, `./node_modules/.bin/biome`.

## Status

- **Severity:** P0 | P1 | P2
- **Effort:** S | M | L
- **Parent plan(s):** 
- **Cluster:** C1–C6
- **Planned at:** `<sha>`
- **Depends on:** other rNNN or none

## Why this matters

<gap + impact>

## Evidence

**Required (from parent plan):**

> <quote 1–5 lines>

**Actual:**

- `path:line` — <behavior>

**Gap class:** missing | wrong | weak-test | drift

## Files

- In scope: 
- Out of scope (always include): `lib/status/tmux-status.mjs`, `lib/status/background.mjs`, `test/status-surfaces.test.mjs`, `plans/020-*`, live tmux, `~/.claude` mutation

## Steps

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test — expect FAIL**
- [ ] **Step 3: Minimal implementation**
- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Full suite + biome on touched paths**
- [ ] **Step 6: Commit**

### Verification commands

```bash
node --test
./node_modules/.bin/biome check <touched paths>
```

Expected: `# fail 0`; biome exit 0.

## STOP conditions

- Need to mutate live tmux or operator config
- Fix requires 020 modules
- Contract contradicts Plan 017 / hard invariants
- Shared file owned by another in-flight executor

## Executor report format

```
STATUS: COMPLETE | STOPPED
STEPS: ...
FILES CHANGED: ...
NOTES: ...
```

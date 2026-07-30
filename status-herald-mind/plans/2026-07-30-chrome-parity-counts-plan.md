# Chrome-parity counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Curtain subagent/shell counts match Grok/Claude terminal chrome by reconciling from host inventory instead of synthetic lease inflation.

**Architecture:** New pure `lib/status/grok-inventory.mjs` reads `subagents/*/meta.json` (+ optional bg shells from updates). `applySettle` reconciles leases to that id set for Grok sessions. Spawn path uses a single provisional id. Claude task-list path unchanged.

**Tech Stack:** Node ≥20 ESM, `node --test`, zero new deps, injectable fs for hermetic tests.

## Global Constraints

- Branch: `fix/chrome-parity-counts`. Commit after each task. No push (repo `human-end-gate`).
- Full suite green after every task: `npm test` and `npm run lint`.
- Never touch live tmux opts of operator sessions in tests (fake tmux only).
- Soft-fail all inventory I/O; never throw past settle/hook.

---

### Task 1: Grok inventory reader (pure)

**Files:**
- Create: `lib/status/grok-inventory.mjs`
- Create: `test/grok-inventory.test.mjs`

**Interfaces:**
- Produces:
  - `listGrokHomes(homedir = os.homedir()) → string[]`
  - `findActiveByPid(pid, { homes?, readJson?, alive? }) → { home, sessionId, cwd, pid } | null`
  - `runningSubagentIds(sessionDir, { readdir?, readJson? }) → string[]`
  - `openBgShellIds(sessionDir, { maxBytes? }) → string[]`
  - `inventoryForPid(pid, opts?) → { subagentIds: string[], shellIds: string[], sessionDir: string, source: "grok-meta" } | null`

- [ ] **Step 1: Failing tests** in `test/grok-inventory.test.mjs` using tmp dir fixtures (active_sessions + subagents metas).
- [ ] **Step 2: Implement** reader; reuse `grokSessionDir` from `grok-adapter.mjs`.
- [ ] **Step 3: `node --test test/grok-inventory.test.mjs` green + commit**

---

### Task 2: Provisional spawn id (stop stacking)

**Files:**
- Modify: `lib/curtain/session.mjs` spawn grant block (~967–977)
- Modify: `lib/curtain/hook.mjs` only if needed for comments
- Test: `test/session.test.mjs`

- [ ] **Step 1: Failing tests** — Pre then Post spawn without toolTaskId → live subagent count 1 (not 2); second Pre same second still 1.
- [ ] **Step 2: Implement** provisional id `syn-spawn-pending`; Post with real id releases pending and grants real.
- [ ] **Step 3: Suite subset + commit**

---

### Task 3: Reconcile from host inventory in applySettle

**Files:**
- Modify: `lib/curtain/session.mjs` (`applySettle`, optional `stampFromHook` hook)
- Test: `test/session.test.mjs` or `test/chrome-parity.test.mjs`

**Interfaces:**
- Consumes: `inventoryForPid` (injectable via deps for tests)
- `applySettle(sess, nowSec, t, cfg, deps = { inventoryForPid? })`

- [ ] **Step 1: Failing test** — plant 90 syn leases; inject inventory with 25 ids; after applySettle live subagent count is 25.
- [ ] **Step 2: Implement** Grok reconcile only when inventory resolves; skip for task_list host unless inventory says otherwise.
- [ ] **Step 3: Full `npm test` + lint + commit**

---

### Task 4: Docs + doctor/inspect source hint (light)

**Files:**
- Modify: `AGENTS.md` troubleshooting bullet (Grok counts)
- Optional: inspect line `source=grok-meta`
- Atlas: update `status-engine` + `curtain-core` zone cards on finish (recollection)

- [ ] **Step 1: AGENTS.md** note that Grok counts reconcile from `subagents/*/meta.json`.
- [ ] **Step 2: recollection + commit**

---

## Spec coverage

| Spec section | Task |
|--------------|------|
| D1–D5 / host sources | 1, 3 |
| Stop syn inflation | 2 |
| applySettle reconcile | 3 |
| Soft-fail | 1, 3 |
| Docs / atlas | 4 |
| Hierarchy | deferred (spec §6) |

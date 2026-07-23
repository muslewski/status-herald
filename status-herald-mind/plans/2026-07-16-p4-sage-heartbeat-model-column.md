# P4 — agentic-sage Heartbeat + War Model Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sage announces itself via an Agent Status Provider heartbeat and optionally shows `model@effort` per session in `sage war` (and `war --json`), read from convention session records.

**Architecture:** New `lib/agent-status.mjs` implements the convention read/write primitives. The emitter hot path writes a throttled heartbeat (never-block law). War rendering joins sage's own session rows to fresh convention records by pid (then cwd) and adds a MODEL column that is silently absent when no records match.

**Tech Stack:** Node ESM (`.mjs`), zero new deps, `node --test`, biome. Storage under `~/.claude/agentic-sage/` is untouched.

**Repo:** `~/Repositories/agentic-sage`. Convention spec: `status-herald/docs/AGENT-STATUS-PROVIDERS.md`.

## Global Constraints

- Zero new runtime dependencies.
- Gates: `npm test` + biome (`npx biome check .` or the repo's configured lint script) green at every commit.
- **Never-block law:** the emitter hot path must not gain measurable latency or ever throw (this repo's advisor-plans 002/003 established the hardening pattern — follow it: try/catch around ALL convention I/O, throttle by mtime).
- Atomic writes: tmp file in same dir + `fs.renameSync`.
- Lease validity: `now - ts < ttl_ms`; corrupt JSON = absent; soft-fail everywhere.
- `war --json` / `board --json` / `fleet --json` are **schema 1, additive-only** — new fields OK, never rename/remove existing ones.
- Conventional commits, one per task.
- Sage's own session storage/schema (SCHEMA.md) is NOT modified.

## File Structure

```
lib/agent-status.mjs          NEW  convention primitives (read + heartbeat write)
emitter module                MOD  throttled heartbeat call (locate the hook-invoked
                                   emitter — hooks/ + lib/, the code path advisor-plan
                                   003 hardened)
war render + war --json       MOD  MODEL column / model+effort fields (locate via
                                   bin/sage war dispatch)
test/agent-status.test.mjs    NEW
test/ war tests               MOD  extend the existing war/board test files
test/fixtures/agent-status/** NEW  golden fixtures (own copies)
```

Read first: `bin/sage` (dispatcher), the emitter entry hooks call, war/board/fleet libs + their tests, `SCHEMA.md`, `CONVENTIONS.md`, `AGENTS.md`, `advisor-plans/002-*.md`, `advisor-plans/003-*.md` (the never-block contract).

---

### Task 1: `lib/agent-status.mjs` primitives

**Files:**
- Create: `lib/agent-status.mjs`
- Test: `test/agent-status.test.mjs`
- Fixtures: `test/fixtures/agent-status/providers/agentic-sage.json`, `test/fixtures/agent-status/sessions/grok-abc123.json` (copy field-for-field from the convention spec examples)

**Interfaces:**

```js
export const SCHEMA = 1;
export const HEARTBEAT_TTL_MS = 30_000;
export const resolveStatusDir = (env = process.env) => string;
// 1. AGENT_STATUS_DIR  2. XDG_RUNTIME_DIR/agent-status  3. ~/.local/state/agent-status

export const writeHeartbeat = ({ dir, nowMs, pid, capabilities }) => boolean;
// providers/agentic-sage.json, atomic tmp+rename; THROTTLED: skip (return true) when the
// existing file's mtime is younger than HEARTBEAT_TTL_MS / 2; false only means "failed",
// and it must never throw.

export const readFreshJson = (file, nowMs) => object | null; // absent | corrupt | expired → null
export const listSessionRecords = (dir, nowMs) => object[];  // fresh records in dir/sessions/
export const modelFor = (records, { pid, cwd }) => ({ model, effort } | null);
// match by pid first, then exact cwd; freshest updated_at wins; prefer written_by
// "token-oracle" over "llm-armory"; effort may be undefined.
```

Heartbeat JSON: `{ "schema": 1, "tool": "agentic-sage", "pid": <pid>, "ts": <nowMs>, "ttl_ms": 30000, "capabilities": ["board", "fleet", "war", "zones"] }`

- [ ] **Step 1: Failing tests** (`tmp_path`-style temp dirs via `fs.mkdtempSync`):

```js
test("dir resolution order", () => {
  assert.equal(resolveStatusDir({ AGENT_STATUS_DIR: "/x" }), "/x");
  assert.equal(resolveStatusDir({ XDG_RUNTIME_DIR: "/run/u" }), "/run/u/agent-status");
  assert.ok(resolveStatusDir({}).endsWith(".local/state/agent-status"));
});

test("heartbeat writes once then throttles by mtime", () => { /* two calls, one file write */ });
test("writeHeartbeat never throws on unwritable dir, returns false", () => { /* chmod 0o400 */ });
test("expired and corrupt records are absent", () => { /* fixture + garbage file */ });
test("modelFor prefers pid match and oracle over armory", () => {
  const recs = [
    { source_cli: "grok", pid: 9, model: "grok-4.5", effort: "high",
      written_by: "llm-armory", updated_at: 1000, ttl_ms: 60000 },
    { source_cli: "grok", pid: 9, model: "grok-4.5", effort: "high",
      written_by: "token-oracle", updated_at: 900, ttl_ms: 60000 },
  ];
  assert.equal(modelFor(recs, { pid: 9 }).model, "grok-4.5");
  // oracle wins despite being older
});
```

- [ ] **Step 2:** `node --test test/agent-status.test.mjs` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` + lint — PASS.
- [ ] **Step 5:** Commit: `feat: agent-status convention primitives (heartbeat + record reader)`

---

### Task 2: Emitter heartbeat (never-block)

**Files:**
- Modify: the emitter entry (the function every hook event funnels through)
- Test: extend the emitter's existing test file

Behavior: after a successful emit, call `writeHeartbeat({ dir: resolveStatusDir(), nowMs: Date.now(), pid: process.pid, capabilities: ["board", "fleet", "war", "zones"] })` inside the same try/catch hardening advisor-plan 003 added. Failure is invisible to the hook.

- [ ] **Step 1:** Failing test: emit with `AGENT_STATUS_DIR=<tmp>` → heartbeat file exists; emit with unwritable dir → emit still succeeds (its own outputs written, exit clean).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement (one call site).
- [ ] **Step 4:** `npm test` + lint — PASS.
- [ ] **Step 5:** Commit: `feat: emitter announces provider heartbeat (never-block)`

---

### Task 3: War MODEL column + `--json` model fields

**Files:**
- Modify: war render lib + war `--json` assembly
- Test: extend existing war tests; fixture records from Task 1

**Interfaces:**
- Consumes: Task 1 `listSessionRecords` + `modelFor`.
- Produces: each war session row optionally gains `model` and `effort` (strings, omitted when unknown) in `war --json` output — **additive** to schema 1. Rendered table: a `MODEL` column showing `grok-4.5@high` (or bare model when effort absent). When NO row has a model, the column is entirely absent (partial installs render exactly as today — spec §7).

Join rule: sage session row → convention record via `modelFor(records, { pid: row.pid, cwd: row.cwd })` (use whatever pid/cwd fields sage rows already carry — read the war row builder first; sage plan 020 added provenance capture).

- [ ] **Step 1:** Failing tests: (a) `AGENT_STATUS_DIR` seeded with a fresh grok record matching a fake session row's pid → `war --json` row has `model: "grok-4.5", effort: "high"` and rendered table contains `grok-4.5@high`; (b) empty/absent dir → output structurally identical to pre-change golden (no MODEL column, no model keys); (c) expired record → same as (b).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` + lint — PASS. Live check: `sage war --json` on this machine — confirm no errors and (if oracle/armory records exist) model fields appear; paste to PROGRESS.md.
- [ ] **Step 5:** Commit: `feat(war): optional MODEL column from agent-status records`

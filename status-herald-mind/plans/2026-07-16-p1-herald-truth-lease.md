# P1 — Herald Truth-Lease Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert the curtain from fail-working to fail-idle-with-TTL (truth leases), fix RC1/RC2/RC3 structurally, and add the Agent Status Providers reader so the curtain/bar can show model + sage data when siblings are installed.

**Architecture:** Every WORKING hold becomes a lease `{kind, id, exp}` stored in one tmux session option `@herald_leases`; expired leases stop counting automatically. Grok `Stop` reconciles the synthesized subagent set to empty. A PID backstop settles sessions whose agent process died. Per-CLI payload normalization moves into adapter modules. A new `lib/status/providers.mjs` reads the tool-neutral agent-status convention (heartbeats + session records) with soft-fail everywhere.

**Tech Stack:** Node >= 20, ESM (`.mjs`), zero runtime deps, `node --test`, biome.

**Spec:** `docs/superpowers/specs/2026-07-16-status-symbiosis-design.md` (all §references below point there).

## Global Constraints

- Node >= 20, `"type": "module"`, **zero new runtime dependencies**.
- Run gates from repo root: `npm test` (node --test) and `npm run lint` (biome check .). Both must pass at every commit.
- **Soft-fail law (spec §4.4):** a reader never lets a provider failure propagate past the display element it feeds. Corrupt JSON = absent. No throw may escape into render or hook paths.
- **Break freely (D3):** old tmux options / env names are removed, not aliased. No legacy adapters.
- Atomic writes: `tmp` + `rename` (this plan only reads convention files; herald writes none).
- Lease validity: `now - ts < ttl_ms` for convention files; `nowSec < exp` for tmux leases.
- Commit style: conventional commits (`feat(curtain): …`), one commit per completed task.
- Do NOT run repo generators or side-effect scripts not named in a task. Do NOT touch `scripts/curtain-card-loop.sh` grid internals beyond what tasks name.

## File Structure

```
lib/curtain/lease.mjs            NEW  pure lease algebra (no I/O)
lib/curtain/adapters/claude.mjs  NEW  Claude payload → canonical event
lib/curtain/adapters/grok.mjs    NEW  Grok payload → canonical event
lib/curtain/adapters/index.mjs   NEW  detection + dispatch (normalizePayload)
lib/curtain/doctor.mjs           NEW  herald doctor checks
lib/status/providers.mjs         NEW  agent-status convention reader
lib/status/sage-bridge.mjs       NEW  cached `sage fleet --json` reader
lib/status/bridge-token-oracle.mjs NEW (replaces bridge-token-forecast.mjs)
lib/curtain/hook.mjs             MOD  nextState on canonical events; SessionEnd case
lib/curtain/session.mjs          MOD  stampFromHook → lease ops; hostKind; pid stamp
lib/curtain/settle.mjs           MOD  lease-aware settle; watcher immunity removed; pid backstop input
lib/surfaces/curtain-card.mjs    MOD  info lines from leases; optional model/zone lines
lib/status/grok-adapter.mjs      MOD  bar glyph from @herald_state, not hardcoded busy
lib/status/segments.mjs          MOD  token feed via oracle bridge; sage segment
lib/cli.mjs                      MOD  `herald doctor` wiring
docs/AGENT-STATUS-PROVIDERS.md   NEW  normative convention spec (schema 1)
test/lease.test.mjs              NEW
test/adapters.test.mjs           NEW
test/doctor.test.mjs             NEW
test/providers.test.mjs          NEW
test/fixtures/agent-status/**    NEW  golden convention fixtures
test/{session,settle,hook,curtain-card,status-*}.test.mjs  MOD  flipped semantics
```

Read these before starting (current truth): `lib/curtain/hook.mjs`, `lib/curtain/session.mjs`, `lib/curtain/settle.mjs`, `lib/curtain/state.mjs`, `lib/curtain/tmux.mjs`, `lib/surfaces/curtain-card.mjs`, `lib/status/grok-adapter.mjs`, `lib/status/segments.mjs`, `lib/status/bridge-token-forecast.mjs`, `lib/cli.mjs`, `AGENTS.md`.

---

### Task 1: Lease algebra module

**Files:**
- Create: `lib/curtain/lease.mjs`
- Test: `test/lease.test.mjs`

**Interfaces:**
- Produces (later tasks rely on these exact names):
  ```js
  export const LEASE_KINDS = Object.freeze(["subagent", "watcher", "bg_shell", "turn"]);
  export const LEASE_DEFAULTS = Object.freeze({
    subagentTtlSec: 120, watcherTtlSec: 900, bgShellTtlSec: 120, turnTtlSec: 120,
  });
  export const ttlSecFor = (kind, cfg = {}) => number;
  export const parseLeases = (str) => Lease[];        // Lease = { kind, id, exp } (exp = unix sec)
  export const serializeLeases = (leases) => string;  // "kind:id:exp,kind:id:exp"
  export const pruneExpired = (leases, nowSec) => Lease[];
  export const grant = (leases, kind, id, nowSec, cfg) => Lease[];      // upsert, exp = now + ttl
  export const release = (leases, kind, id) => Lease[];
  export const reconcile = (leases, kind, ids, nowSec, cfg) => Lease[]; // exact live set for kind
  export const touch = (leases, nowSec, cfg) => Lease[];                // refresh exp of all live leases
  export const countLive = (leases, nowSec) => ({ subagent, watcher, bg_shell, turn });
  export const hasLive = (leases, nowSec) => boolean;
  ```
- Pure module: no imports besides nothing (mirror `settle.mjs` style — "No I/O").

Behavior details:
- `ttlSecFor("subagent", cfg)` reads `cfg.subagentTtlSec` etc. (config lives under `curtain.lease`, merged over `LEASE_DEFAULTS` the same way `SETTLE_DEFAULTS` merges).
- Ids are sanitized on grant/reconcile: strip `,` and `:` (`String(id).replace(/[,:]/g, "_")`); empty id → `anon-<kind>`.
- `parseLeases` tolerates garbage: malformed entries dropped silently; non-numeric exp → drop entry.
- `grant` on an existing `(kind, id)` refreshes `exp` (idempotent upsert).
- `reconcile(leases, "subagent", [], now, cfg)` removes all subagent leases; `reconcile(leases, "subagent", ["a","b"], …)` keeps/creates exactly a and b with fresh exp.
- `touch` re-arms every non-expired lease to `now + ttlSecFor(kind)`; expired leases are NOT resurrected.

- [ ] **Step 1: Write failing tests** — `test/lease.test.mjs`, at minimum:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEASE_DEFAULTS, countLive, grant, hasLive, parseLeases, pruneExpired,
  reconcile, release, serializeLeases, touch, ttlSecFor,
} from "../lib/curtain/lease.mjs";

test("grant + serialize + parse round-trips", () => {
  const l = grant([], "subagent", "syn-1", 1000, {});
  const round = parseLeases(serializeLeases(l));
  assert.deepEqual(round, [{ kind: "subagent", id: "syn-1", exp: 1000 + LEASE_DEFAULTS.subagentTtlSec }]);
});

test("expired leases stop counting without any event", () => {
  let l = grant([], "subagent", "syn-1", 1000, {});
  assert.equal(countLive(l, 1060).subagent, 1);
  assert.equal(countLive(l, 1000 + 121).subagent, 0); // TTL 120 elapsed
  assert.equal(hasLive(l, 1200), false);
});

test("watcher lease expires after its own TTL (RC2 bound)", () => {
  const l = grant([], "watcher", "loop", 1000, {});
  assert.equal(countLive(l, 1000 + 899).watcher, 1);
  assert.equal(countLive(l, 1000 + 901).watcher, 0);
});

test("reconcile to empty clears the kind (RC1 primitive)", () => {
  let l = grant([], "subagent", "a", 1000, {});
  l = grant(l, "subagent", "b", 1000, {});
  l = grant(l, "turn", "t", 1000, {});
  l = reconcile(l, "subagent", [], 1001, {});
  assert.equal(countLive(l, 1001).subagent, 0);
  assert.equal(countLive(l, 1001).turn, 1); // other kinds untouched
});

test("grant refreshes exp idempotently; release removes; touch re-arms live only", () => {
  let l = grant([], "subagent", "a", 1000, {});
  l = grant(l, "subagent", "a", 1100, {});
  assert.equal(l.length, 1);
  assert.equal(l[0].exp, 1100 + 120);
  l = grant(l, "bg_shell", "s", 1100, {});
  l = release(l, "bg_shell", "s");
  assert.equal(countLive(l, 1100).bg_shell, 0);
  // expired lease not resurrected by touch
  l = touch(l, 1100 + 121, {});
  assert.equal(hasLive(l, 1100 + 121), false);
});

test("parse tolerates garbage and id sanitization strips separators", () => {
  assert.deepEqual(parseLeases("bogus,,subagent:x:notanum,:::"), []);
  const l = grant([], "subagent", "a,b:c", 1000, {});
  assert.equal(l[0].id, "a_b_c");
});

test("cfg overrides TTLs", () => {
  assert.equal(ttlSecFor("watcher", { watcherTtlSec: 60 }), 60);
  const l = grant([], "watcher", "w", 1000, { watcherTtlSec: 60 });
  assert.equal(countLive(l, 1061).watcher, 0);
});
```

- [ ] **Step 2:** Run `node --test test/lease.test.mjs` — expect FAIL (module missing).
- [ ] **Step 3:** Implement `lib/curtain/lease.mjs` per the interface above (pure functions, immutable returns — always new arrays).
- [ ] **Step 4:** Run `node --test test/lease.test.mjs` — expect PASS. Run `npm run lint`.
- [ ] **Step 5:** Commit: `feat(curtain): pure truth-lease algebra module`

---

### Task 2: Canonical-event adapters (Claude, Grok)

**Files:**
- Create: `lib/curtain/adapters/claude.mjs`, `lib/curtain/adapters/grok.mjs`, `lib/curtain/adapters/index.mjs`
- Modify: `lib/curtain/hook.mjs` (move normalization out; keep pure state logic)
- Test: `test/adapters.test.mjs`; update `test/hook.test.mjs` imports where normalization moved

**Interfaces:**
- Produces:
  ```js
  // adapters/index.mjs
  export const detectSourceCli = (raw) => "claude" | "grok" | "unknown";
  export const normalizePayload = (raw) => CanonicalEvent;
  // CanonicalEvent = {
  //   event: "UserPromptSubmit"|"SubagentStart"|"SubagentStop"|"Stop"|"Notification"|
  //          "SessionStart"|"SessionEnd"|"PreCompact"|"PreToolUse"|"PostToolUse"|"",
  //   notificationType: "permission_prompt"|"idle_prompt"|"task_complete"|
  //                     "push_notification"|"agent_error"|""|string,
  //   synthetic: boolean,          // synthetic user prompt (task-completed resume)
  //   hasTasks: boolean,           // payload carried an authoritative task list
  //   inflightIds: string[],       // ids of running/pending tasks (empty when !hasTasks)
  //   agentId: string,             // subagent id if present
  //   pid: number,                 // agent process pid (payload pid ?? 0)
  //   sourceCli: "claude"|"grok"|"unknown",
  //   toolName: string,            // for watcher classifiers
  //   prompt: string,              // raw prompt text (loop/monitor classifiers)
  // }
  ```
- Consumes: existing logic in `hook.mjs` — `normalizeEventName`, notification normalization, `isSyntheticUserPrompt`, `INFLIGHT`, task-list extraction currently inside `parseHookPayload`/`stampFromHook`. Move the per-CLI parts into the adapters; **behavioral parity with today** is the requirement, verified by keeping all existing `hook.test.mjs` cases passing (update imports only, not expectations).

Rules:
- `detectSourceCli`: Grok markers (camel/Pascal event names, grok-specific fields, `GROK_*`-style hints in payload) → `"grok"`; `background_tasks` array or snake_case Claude fields → `"claude"`; else `"unknown"` (treated as synthesis host downstream).
- `adapters/claude.mjs` exports `normalize(raw) → CanonicalEvent` (extracts `background_tasks[]` → `hasTasks` + `inflightIds` filtered by `INFLIGHT` statuses).
- `adapters/grok.mjs` exports `normalize(raw) → CanonicalEvent` (camelCase names, Cursor aliases, `task_complete`/push normalization, synthetic prompt detection).
- Adding a new CLI later = one new adapter file + one line in `index.mjs` (D5). Put a comment saying exactly that at the top of `index.mjs`.
- `nextState` and classifiers (`isLoopPrompt`, `isMonitorStart`, `isSchedulerCreate`, `isWatchEnd`, `isBgTaskStart`) stay in `hook.mjs`, operating on `CanonicalEvent` only.

- [ ] **Step 1: Write failing tests** — `test/adapters.test.mjs` with fixture payloads (spec §9). Real shapes, one per CLI; base them on the payload shapes the existing tests in `test/hook.test.mjs` / `test/session.test.mjs` construct today:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSourceCli, normalizePayload } from "../lib/curtain/adapters/index.mjs";

test("claude Stop with background_tasks reconciles inflight ids", () => {
  const ev = normalizePayload({
    hook_event_name: "Stop",
    background_tasks: [
      { id: "a", status: "running" },
      { id: "b", status: "completed" },
    ],
  });
  assert.equal(ev.sourceCli, "claude");
  assert.equal(ev.event, "Stop");
  assert.equal(ev.hasTasks, true);
  assert.deepEqual(ev.inflightIds, ["a"]);
});

test("grok camelCase Stop has no task list", () => {
  const ev = normalizePayload({ hookEventName: "Stop" });
  assert.equal(ev.event, "Stop");
  assert.equal(ev.hasTasks, false);
  assert.deepEqual(ev.inflightIds, []);
});

test("grok synthetic task-completed prompt flagged synthetic", () => {
  const ev = normalizePayload({
    hookEventName: "UserPromptSubmit",
    promptId: "task-completed-42",
    prompt: "background task completed",
  });
  assert.equal(ev.event, "UserPromptSubmit");
  assert.equal(ev.synthetic, true);
});

test("unknown host degrades to synthesis-safe defaults", () => {
  const ev = normalizePayload({ event: "weird_thing" });
  assert.equal(ev.sourceCli, "unknown");
  assert.equal(ev.hasTasks, false);
});
```

Also port the alias cases already covered in `test/hook.test.mjs` (PascalCase, `afterAgentThought` → PostToolUse, notification type normalization) so they run against `normalizePayload`.

- [ ] **Step 2:** Run `node --test test/adapters.test.mjs` — FAIL.
- [ ] **Step 3:** Implement the three adapter files by extracting the existing normalization code paths from `hook.mjs` (move, don't rewrite; keep comments). Rewire `hook.mjs`/`session.mjs` callers through `normalizePayload`.
- [ ] **Step 4:** Run `node --test test/adapters.test.mjs test/hook.test.mjs test/session.test.mjs` — PASS (existing expectations unchanged in this task). `npm test` + `npm run lint` green.
- [ ] **Step 5:** Commit: `feat(curtain): per-CLI payload adapters (claude, grok) behind normalizePayload`

---

### Task 3: Lease-backed stampFromHook + Grok Stop reconciliation (RC1)

**Files:**
- Modify: `lib/curtain/session.mjs` (arm/reset + `stampFromHook`), `lib/curtain/hook.mjs` (`nextState` counts input), `lib/surfaces/curtain-card.mjs` (info lines source)
- Test: update `test/session.test.mjs`, `test/session.integration.test.mjs`, `test/curtain-card.test.mjs`

**Interfaces:**
- Consumes: Task 1 lease API, Task 2 `CanonicalEvent`.
- Produces: tmux option layout used by every later task:
  - NEW options: `@herald_leases` (serialized leases), `@herald_host_kind` (`task_list`|`synthesis`|`hybrid`), `@herald_agent_pid` (int, 0 = unknown)
  - KEPT: `@herald_state`, `@herald_since`, `@herald_last_active`, `@herald_covered`, `@herald_worked`
  - REMOVED everywhere (arm, reset, stamp, card, tests): `@herald_bg_subagents`, `@herald_bg_subagent_ids`, `@herald_bg_shells`, `@herald_bg_watchers`, `@herald_bg_watcher_ids`, `@herald_tasks_seen`
- `nextState(ev, cur, counts)` keeps its signature; `counts = { subagents, watchers }` is now **derived**: `const c = countLive(parseLeases(opt), nowSec)` → `{ subagents: c.subagent, watchers: c.watcher }`.

Semantics to implement in `stampFromHook` (order matters):
1. Normalize payload via adapter (Task 2). Stamp `@herald_agent_pid` = `ev.pid || process.ppid` on every **active** event (`isActiveHookEvent`).
2. Lease mutations:
   - `SubagentStart` → `grant(leases, "subagent", ev.agentId || syn-<now>-<n>, now, cfg)` (keep today's synthesized-id scheme).
   - `SubagentStop` → `release(leases, "subagent", ev.agentId)`; when id missing, release the oldest subagent lease (today's drain behavior).
   - `hasTasks` (any event) → `reconcile(leases, "subagent", ev.inflightIds, now, cfg)`; also `reconcile(leases, "bg_shell", <shell task ids>, …)` mirroring today's task classification (`isBgTaskStart`).
   - **`Stop` with `!ev.hasTasks` → `reconcile(leases, "subagent", [], now, cfg)`** — THE RC1 FIX. Grok's Stop now reconciles exactly like Claude's `background_tasks: []`.
   - Watcher classifiers (`isLoopPrompt`, `isMonitorStart`, `isSchedulerCreate`) → `grant(leases, "watcher", <slot id — keep today's loop/mon slot ids>, now, cfg)`; `isWatchEnd` → `reconcile(leases, "watcher", [], now, cfg)` (today's clear-all behavior).
   - Non-synthetic `UserPromptSubmit` → `reconcile(leases, "subagent", [], …)` (today's line ~319 behavior) + `grant(leases, "turn", "turn", now, cfg)`.
   - Any active event → `grant(leases, "turn", "turn", now, cfg)` and `touch(leases, now, cfg)` (activity refreshes all live leases — spec §5.1 "refreshed by any hook activity").
   - `Stop` → `release(leases, "turn", "turn")`.
3. hostKind: on first `hasTasks` payload set `@herald_host_kind=task_list`; if a task_list session later synthesizes a subagent id (SubagentStart without task list) set `hybrid`; default `synthesis` (set at arm).
3b. Env model hint (spec §4.3 env fallback): the hook process is a child of the agent CLI, so it inherits armory env. On active events, when `process.env.GROK_MODEL` (or `LLM_PRESET`) is set and `@herald_model_hint` is empty, stamp `@herald_model_hint` = `GROK_MODEL` + (`@` + `GROK_EFFORT` when set). This is the zero-install fallback the model line uses when no convention records exist (Task 8).
4. `nextState` unchanged in table shape, but consumes live counts. Result stamped as today (`@herald_state`, `@herald_since`).
5. `shouldSettleSynthSubagentStop` stays, expressed against live lease counts.

Card info lines (`curtain-card.mjs`): derive `N subagents / N watchers / N tasks` from `countLive(parseLeases(@herald_leases), now)` instead of the removed count options.

Test changes — **flip, don't delete** (spec §9):
- `test/session.test.mjs` "Grok Stop without tasks keeps WORKING while subagent ids remain" (~line 491) becomes:

```js
test("Grok Stop without task list reconciles synth subagents to empty → DONE", () => {
  // arrange: armed synthesis session, two synthesized SubagentStarts, then Stop w/o tasks
  // assert: @herald_state === DONE and countLive(...).subagent === 0
});
```

- Mismatch-heal test (~758) updates to lease vocabulary; drain-on-last-SubagentStop tests keep passing.
- Add fake-clock TTL test: SubagentStart at t, **no further events**, settle pass at t+121 → subagent count 0 (write against `countLive`; full settle wiring lands Task 4).

- [ ] **Step 1:** Rewrite the affected tests first (red).
- [ ] **Step 2:** `node --test test/session.test.mjs` — FAIL.
- [ ] **Step 3:** Implement `session.mjs`/`hook.mjs`/`curtain-card.mjs` changes.
- [ ] **Step 4:** `npm test` — PASS; `npm run lint` — PASS.
- [ ] **Step 5:** Commit: `feat(curtain)!: truth-lease state store; Grok Stop reconciles subagents (RC1)`

---

### Task 4: Lease-aware settle — watcher immunity removed (RC2) + precedence

**Files:**
- Modify: `lib/curtain/settle.mjs`, `lib/curtain/session.mjs` (settle call sites build the new snap)
- Test: `test/settle.test.mjs`, `test/session.test.mjs` `/loop` cases

**Interfaces:**
- Produces:
  ```js
  export const SETTLE_DEFAULTS = Object.freeze({
    settleSynthQuietSec: 90,
    settleSynthLeakSec: 180,
    maxWorkingSec: 0,
    maxNeedsSec: 0,
  }); // unchanged values
  // settleIfStale(snap, nowSec, cfg) → { state, clearLeases: boolean } | null
  // snap = { state, counts: {subagent, watcher, bg_shell, turn}, hostKind,
  //          lastActive, since, agentAlive: true|false|null }
  ```
- Consumes: Task 3 option layout. Call sites compute `counts` via `countLive` at `nowSec` — **expired leases are already invisible here; that is the structural RC2 fix.**

Pinned rules, in precedence order (spec §5.3 — "whichever fires first settles; no lease kind is exempt"):
1. `agentAlive === false` and state is WORKING/COMPACTING/NEEDS → `{ state: DONE, clearLeases: true }` (PID backstop consumes this — Task 5 wires the input; `null` = unknown → skip).
2. NEEDS: `maxNeedsSec` behavior unchanged.
3. Only WORKING/COMPACTING beyond this point.
4. All live counts zero:
   - `hostKind === "task_list"` → wait for `idle_prompt` unless `maxWorkingSec` fires (today's Claude semantics, unchanged);
   - else (`synthesis`/`hybrid`) → quiet ≥ `settleSynthQuietSec` → `{ state: DONE, clearLeases: true }`.
5. Live `subagent > 0`, hostKind !== task_list, quiet ≥ `settleSynthLeakSec` → DONE + clear (leak net stays; lease TTL 120s usually beats it).
6. **No watcher-immunity branch.** A live watcher lease holds WORKING (via `nextState`/rule 4 counts), but once it expires (default 15 min) it stops counting and rule 4 applies. Delete the `settle.mjs:83–84` early-return.
7. `maxWorkingSec` ceiling applies to every host when > 0 (unchanged).

Config: settle knobs stay under `curtain.settle`; lease TTLs under `curtain.lease` (document both in `AGENTS.md` in Task 9).

Test changes:
- Flip "quiet settle never fires while watchers > 0": now: watcher lease granted at t; settle at t+400 (lease live, quiet>90) → **null** (held); settle at t+901 (lease expired) with quiet ≥ 90 → DONE. Fake clock only — no sleeps.
- Flip session-level `/loop` test (~821): Stop with fresh watcher lease stays WORKING; advance clock past `watcherTtlSec` + quiet → settle pass returns DONE.
- Add precedence test: expired subagent lease + quiet 30s (< 90) → rule 4 not yet, returns null; at quiet 91 → DONE. Confirms lease expiry and settle are independent paths, never holding state against each other.

- [ ] **Step 1:** Rewrite `test/settle.test.mjs` cases (red).
- [ ] **Step 2:** `node --test test/settle.test.mjs` — FAIL.
- [ ] **Step 3:** Implement settle rework + call sites.
- [ ] **Step 4:** `npm test` && `npm run lint` — PASS.
- [ ] **Step 5:** Commit: `feat(curtain)!: lease-aware settle; watchers expire instead of blocking (RC2)`

---

### Task 5: PID-liveness backstop + SessionEnd → DONE

**Files:**
- Modify: `lib/curtain/session.mjs` (settle wrapper computes `agentAlive`), `lib/curtain/hook.mjs` (`nextState` SessionEnd case)
- Test: `test/session.test.mjs`, `test/hook.test.mjs`, new integration case in `test/session.integration.test.mjs`

**Interfaces:**
- Produces in `session.mjs`:
  ```js
  export const isPidAlive = (pid) => boolean; // process.kill(pid, 0); EPERM counts alive
  ```
- The card-loop settle path (the code invoked by `scripts/curtain-card-session.sh` each tick — find it via `lib/cli.mjs` curtain settle wiring) reads `@herald_agent_pid`; `agentAlive = pid > 0 ? isPidAlive(pid) : null`.

Semantics:
- `nextState` gains an explicit `SessionEnd` case → `DONE` (today it falls through `default → cur`); `stampFromHook` on SessionEnd also `reconcile`s **all** lease kinds to empty and releases turn. Rationale: the agent process is ending; leases represent work that dies with it. (Spec §5.3 wording "when no fresh leases" is satisfied trivially — we clear them; the PID backstop remains for lost SessionEnd events.)
- `kill -9` path (spec §9 PID backstop test): integration test spawns `node -e 'setInterval(()=>{},1e3)'`, stamps its pid via the fake tmux harness used by existing session integration tests, kills it with SIGKILL, runs the settle pass → DONE + leases cleared. No real tmux needed — reuse the existing fake `t` test double.

```js
test("pid backstop: dead agent process forces DONE despite fresh leases", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  // arrange armed fake session, WORKING, fresh subagent lease, @herald_agent_pid = child.pid
  child.kill("SIGKILL");
  await once(child, "exit");
  // run card-loop settle pass with real isPidAlive
  // assert state DONE, hasLive(...) === false
});
```

- [ ] **Step 1:** Write failing tests (SessionEnd case in `hook.test.mjs`; pid backstop integration).
- [ ] **Step 2:** Run them — FAIL.
- [ ] **Step 3:** Implement `isPidAlive`, settle-wrapper input, SessionEnd case + lease clear.
- [ ] **Step 4:** `npm test` && `npm run lint` — PASS.
- [ ] **Step 5:** Commit: `feat(curtain): PID-liveness backstop and SessionEnd→DONE (kill -9 safety)`

---

### Task 6: Bar glyph from lease state (drop hardcoded busy)

**Files:**
- Modify: `lib/status/grok-adapter.mjs` (line ~224 hardcoded `status: "busy"`), `lib/status/segments.mjs` / `lib/status/tmux-status.mjs` (wherever the glyph is chosen)
- Test: `test/status-compute.test.mjs` / `test/status-segments.test.mjs`

**Interfaces:**
- Consumes: `@herald_state` for the tmux session that owns the pane (herald owns pane↔session mapping — reuse how the curtain resolves it in `session.mjs`; the status surface knows its target session).
- Produces: `discoverLiveGrokSessions` emits `status: "working" | "idle" | "needs" | "unknown"`; glyph mapping: WORKING/COMPACTING → ▶, DONE/IDLE → idle glyph, NEEDS → the needs glyph already used by the card, unarmed/unknown → neutral `·`. Keep the exported shape otherwise identical (additive).

Rule: when the pane's session is herald-armed, the glyph derives from `@herald_state` — same truth as the curtain. When not armed, `"unknown"` (never fabricate busy). Injectable tmux reader (same `t` double pattern) for tests.

- [ ] **Step 1:** Failing tests: armed session WORKING → ▶; armed DONE → idle glyph; unarmed → `·` (no "busy" string anywhere in adapter output).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` && `npm run lint` — PASS.
- [ ] **Step 5:** Commit: `fix(status)!: grok bar glyph derives from curtain lease state, not hardcoded busy`

---

### Task 7: Providers convention reader + golden fixtures

**Files:**
- Create: `lib/status/providers.mjs`, `test/providers.test.mjs`, fixtures under `test/fixtures/agent-status/providers/token-oracle.json`, `.../providers/agentic-sage.json`, `.../sessions/grok-abc123.json`, `.../sessions/claude-def456.json`, `.../sessions/corrupt.json` (literally invalid JSON)

**Interfaces:**
- Produces (spec §4 — these fixtures are the schema-1 golden copies; siblings carry their own copies):
  ```js
  export const resolveStatusDir = (env = process.env) => string;
  // 1. env.AGENT_STATUS_DIR  2. env.XDG_RUNTIME_DIR + "/agent-status"  3. ~/.local/state/agent-status
  export const readFreshJson = (file, nowMs) => object | null;   // null: absent | corrupt | now - ts >= ttl_ms
  export const listProviderHeartbeats = (dir, nowMs) => object[]; // fresh heartbeats only
  export const listSessionRecords = (dir, nowMs) => object[];     // fresh records only
  export const bestModelRecord = (records, { sourceCli, pid, cwd }) => { model, effort, written_by } | null;
  export const isPidAliveOpt = (pid) => boolean;                  // re-export/wrap session.mjs isPidAlive
  ```
- Fixture contents exactly per spec §4.2/§4.3 (copy the JSON blocks from the spec, `ts`/`started_at` values written as fixed numbers; tests pass `nowMs` relative to them).

Rules:
- `bestModelRecord`: filter by `sourceCli` (+ `pid` or `cwd` when given); precedence `written_by`: `token-oracle` > `llm-armory`; among equals, freshest `updated_at` wins. Records with `written_by: "llm-armory"` additionally require `isPidAliveOpt(record.pid)` (long-TTL launch records die with the process).
- Soft-fail everywhere: unreadable dir → `[]`; corrupt file → skipped; **no throw ever escapes**.
- No caching in this module (callers cache).

- [ ] **Step 1:** Failing tests: dir resolution env matrix (3 branches), fresh/expired/corrupt fixture reads, precedence oracle-over-armory, armory record with dead pid rejected.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` && `npm run lint` — PASS.
- [ ] **Step 5:** Commit: `feat(status): agent-status providers convention reader (schema 1) + golden fixtures`

---

### Task 8: Curtain optional lines + sage bridge + token bridge repoint

**Files:**
- Create: `lib/status/sage-bridge.mjs`, `lib/status/bridge-token-oracle.mjs`
- Delete: `lib/status/bridge-token-forecast.mjs`
- Modify: `lib/surfaces/curtain-card.mjs` (optional info lines), `lib/status/segments.mjs` (token segment source; new sage segment), `lib/config.mjs` (defaults for `curtain.lines`)
- Test: `test/curtain-card.test.mjs`, `test/status-segments.test.mjs`, new `test/sage-bridge.test.mjs`

**Interfaces:**
- Config additions (defaults **off**): `curtain.lines = { model: false, sageZone: false }`, plus a sage-segment toggle in the existing bar config section (read `lib/config.mjs` for the real key family — `tmuxBar`/status keys — and follow it; default off).
- `sage-bridge.mjs`:
  ```js
  export const readSageFleet = ({ nowMs, cachePath, execFn }) => object | null;
  // shells out `sage fleet --json` (spec §4.5 — CLI JSON is the contract, never raw sage files),
  // 400ms timeout, file cache (default join(tmpdir(), "herald-sage-fleet.json")) refreshed when
  // older than 15s; every failure → null (soft-fail law). execFn injectable for tests.
  ```
- `bridge-token-oracle.mjs`: same export surface `segments.mjs` consumes from the old bridge (keep function names — read them from `bridge-token-forecast.mjs` before deleting), default feed `~/.local/share/token-oracle/forecast.json`, env override `HERALD_TOKEN_FEED` kept, **`TOKEN_FORECAST_SNAPSHOT` env and token-forecast paths removed** (D3). Derive the field mapping from token-oracle's `snapshot/writer.py` (repo lives at `~/Repositories/token-oracle`) and encode a sample as `test/fixtures/agent-status/forecast.json`.
- Curtain lines (in `curtain-card.mjs` info-line builder): when `curtain.lines.model`, append `model@effort` with precedence **records → env hint** (spec §4.3): `bestModelRecord(listSessionRecords(...), {sourceCli, pid})` first — the session's own pid/source from tmux options — else the `@herald_model_hint` option stamped in Task 3. When `curtain.lines.sageZone`, append `zone <zone>` for the fleet row matching this session's cwd/pane. Absent/stale data → line simply absent (spec §6.4, §7 partial installs: "Nothing errors").

- [ ] **Step 1:** Failing tests: card renders model line from fixture records when enabled; renders nothing when disabled or records stale; sage-bridge returns null on exec failure + respects cache TTL (inject fake exec + clock); token segment reads oracle fixture; grep guard test asserting no source file references `token-forecast` any more:

```js
test("token-forecast naming is gone (D3)", () => {
  const hits = execSync("grep -rl token-forecast lib/ || true").toString().trim();
  assert.equal(hits, "");
});
```

- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; delete old bridge; update all imports.
- [ ] **Step 4:** `npm test` && `npm run lint` — PASS.
- [ ] **Step 5:** Commit: `feat(status)!: oracle token feed, sage segment, optional curtain model/zone lines`

---

### Task 9: Observability — settle health stamp + `herald doctor`

**Files:**
- Create: `lib/curtain/doctor.mjs`, `test/doctor.test.mjs`
- Modify: `lib/curtain/session.mjs` (settle pass stamps `@herald_settle_ts`), `lib/cli.mjs` (wire `herald doctor`), `AGENTS.md` (new options + lease/settle config table — keep the existing doc style)

**Interfaces:**
- Produces:
  ```js
  // doctor.mjs
  export const runDoctor = ({ t, env, fs, nowSec }) => { checks: Check[], ok: boolean };
  // Check = { name: string, ok: boolean, hard: boolean, detail: string }
  ```
  CLI prints one line per check (`✓`/`✗` + detail), exits 1 iff any `hard` check fails.
- Checks (spec §5.5): (1) hook config files reference an **absolute node path** and `herald curtain hook` (inspect `~/.claude/settings.json` and Grok's hook config — find the exact file `lib/curtain/install.mjs` writes); (2) tmux reachable; armed sessions' options coherent (state ∈ STATES, leases parseable); (3) `@herald_settle_ts` recency < 120s for armed+covered sessions (hard — this is RC3 detection); (4) agent-status dir resolvable + heartbeat freshness listing (soft, informational); (5) card-loop script resolves `bin/herald` absolutely.
- All inputs injected (`t`, `env`, `fs`, `nowSec`) — tests never touch real tmux/home.

- [ ] **Step 1:** Failing tests: each check red/green against injected doubles; settle pass stamps `@herald_settle_ts=nowSec`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement + CLI wiring + AGENTS.md doc update.
- [ ] **Step 4:** `npm test` && `npm run lint` — PASS. Also run `bin/herald doctor` live once; paste output into PROGRESS.md.
- [ ] **Step 5:** Commit: `feat(curtain): settle health stamp + herald doctor (RC3 diagnosis)`

---

### Task 10: Normative convention spec document

**Files:**
- Create: `docs/AGENT-STATUS-PROVIDERS.md`

Content — expand spec §4 into a standalone normative doc (this is the document siblings link to; write it for third-party tool authors):
1. Title + status line (`Schema 1 — 2026-07-16`), purpose paragraph (tool-neutral, zero shared code).
2. Directory resolution (the 3-step order, verbatim from Global Constraints of the spec §4.1).
3. Provider heartbeat schema — copy the JSON example from spec §4.2, then a field table (name, type, required, meaning).
4. Session record schema — JSON example from spec §4.3 + field table + key derivation rule (`<source_cli>-<session_id>`, fallback `<source_cli>-pid<pid>`, sanitize to `[A-Za-z0-9._-]`).
5. Writer rules: atomic tmp+rename, cadence ≤ ttl_ms/2, long-TTL launch records must include `pid` and note that readers pid-check them.
6. Reader rules: lease validity, corrupt = absent, soft-fail law (quote it), field precedence is reader policy (herald's: oracle → armory → env).
7. Versioning: additive-only within schema 1; schema 2 side-by-side.
8. Known writers/readers table (herald reads; oracle/sage/armory write — link sibling repos).

- [ ] **Step 1:** Write the doc (no TBDs; every field in the fixtures from Task 7 documented).
- [ ] **Step 2:** Cross-check: every field name in `test/fixtures/agent-status/**` appears in the doc tables. Fix drift on either side.
- [ ] **Step 3:** Commit: `docs: AGENT-STATUS-PROVIDERS convention spec (schema 1)`

---

### Task 11: Full-suite gate + live smoke

- [ ] **Step 1:** `npm test` — all green; `npm run lint` — clean.
- [ ] **Step 2:** Grep guards: `grep -rn "@herald_bg_\|@herald_tasks_seen\|token-forecast" lib/ scripts/ test/ || true` → only allowed hits are CHANGELOG-style prose (should be zero in code).
- [ ] **Step 3:** Combo-matrix smoke (spec §9): one test file/section asserting herald-alone behavior — with `AGENT_STATUS_DIR` pointing at an empty temp dir AND sage exec failing AND token feed absent, the card renders (no model/zone lines), the bar renders (no sage/token segments), and **zero** errors/throws reach output. This is the "absent siblings produce empty segments and zero errors" guarantee.
- [ ] **Step 4:** Live smoke (this machine runs tmux): `bin/herald doctor`; append output + any anomalies to PROGRESS.md. Do NOT re-arm or disturb live sessions.
- [ ] **Step 5:** Commit any stragglers: `chore(curtain): P1 gate — full suite green`

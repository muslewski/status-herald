# P7: Subagent Truth — counts self-heal, empty-Stop distrust, fleet visible when done

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the three live defects that make subagent/shell counts lie: quiet-gap lease decay (monitor sandwich shows 0 subagents), Claude Stop payloads that falsely report `background_tasks: []`, and a done-state card that hides parked subagents.

**Architecture:** All changes inside the existing truth-lease engine (`lib/curtain/`) plus one display tweak (`lib/surfaces/curtain-card.mjs`). No new files. Semantics: subagents KEEP holding WORKING (unlike watchers) — these fixes make their counts truthful, not weaker.

**Tech Stack:** Node ESM, `node --test` suite, biome lint via `node --run lint`.

## Global Constraints

- Branch: `fix/subagent-truth` (this worktree). Commit after each task. NEVER push, NEVER merge.
- Full suite green after every task: `npm test` (385 pass baseline + your new tests) and `node --run lint`.
- Never run `herald curtain install`, never touch tmux options of live sessions, never spawn tmux commands in tests (suite uses fake tmux — follow existing patterns in `test/`).
- Match existing code style: JSDoc on exported functions, comments state constraints not narration.
- Grok/synthesis behavior must NOT change: Grok Stop (no `background_tasks`) still reconciles subagents to empty (RC1). Existing tests asserting that are correct — do not weaken them.

## Live-bug evidence (captured 2026-07-16, hook-debug.log)

1. **`background_tasks` exists ONLY on `Stop` and `SubagentStop`** Claude payloads. PreToolUse/PostToolUse/UserPromptSubmit/SubagentStart never carry it. Between those reconcile points, counts are pure lease TTL decay.
2. **Every tool event fired BY a subagent carries `agent_id`** (+ `agent_type`): observed `PreToolUse`/`PostToolUse` with `agent_id: a635528dc...` from a live probe. This is unused re-grant evidence: a parked monitor whose 120s lease expired fires heartbeat tool calls every ~3 min that could re-earn its lease — today they don't, so the count stays 0 until the next Stop/SubagentStop.
3. **False-empty Stop:** session `hermes`, Stop at epoch 1784224736 listed `[subagent a858e273 running, 3 shells running]`; Stop at 1784224779 listed `[]` — while the same shells and monitor were demonstrably still alive (their leases were re-granted by a later SubagentStop reconcile). Trusting `[]` wipes live inventory → card flashes "done · 1 watcher in bg" while the fleet grinds on (user-reported).
4. Card done-state tail renders shells and watchers but NOT subagents — a genuinely-parked fleet is invisible.

---

### Task 1: Self-healing subagent leases from `agent_id` events

**Files:**
- Modify: `lib/curtain/session.mjs` (`stampFromHook`, just after the SubagentStart/SubagentStop block ending ~line 570)
- Test: `test/session.test.mjs`

**Interfaces:**
- Consumes: existing `grant(leases, kind, id, nowSec, cfg)` from `lib/curtain/lease.mjs` (idempotent re-arm for same kind+id).
- Produces: behavioral contract only.

- [ ] **Step 1: Write failing tests** (fake tmux, follow existing stampFromHook test patterns):

```js
test("PostToolUse with agentId re-grants an expired subagent lease", () => {
  // grant subagent at t=0 (TTL 300 after Task 2; use explicit cfg ttl if needed),
  // advance past expiry with NO events, then fire:
  //   { event: "PostToolUse", agentId: "mon1", toolName: "Bash", ... }
  // assert a live subagent:mon1 lease exists with exp = now + ttl
});

test("PreToolUse without agentId grants no subagent lease", () => {
  // main-agent tool call (agentId: "") must not invent a subagent
});

test("SubagentStop does not resurrect the stopping agent", () => {
  // SubagentStop for id mon1 (which also carries agentId) must still end
  // with no live subagent:mon1 lease
});
```

- [ ] **Step 2: Run tests, verify they fail**
- [ ] **Step 3: Implement** — in `stampFromHook`, immediately after the `SubagentStart`/`SubagentStop` if/else block:

```js
  // Self-healing counts: any tool event fired BY a subagent carries agentId
  // (captured live 2026-07-16). A parked monitor whose lease TTL-expired
  // re-earns it on its next heartbeat; background_tasks only exists on
  // Stop/SubagentStop, so this is the only between-reconcile evidence.
  if (
    ev.agentId &&
    (ev.event === "PreToolUse" || ev.event === "PostToolUse")
  ) {
    leases = grant(leases, "subagent", ev.agentId, nowSec, leaseCfg);
  }
```

- [ ] **Step 4: Full suite + lint green**
- [ ] **Step 5: Commit** `fix(curtain): subagent leases self-heal from agent_id tool events`

---

### Task 2: Distrust empty background_tasks on Stop; raise decay TTLs

**Files:**
- Modify: `lib/curtain/session.mjs` (the `ev.hasTasks` reconcile branch, ~line 540)
- Modify: `lib/curtain/lease.mjs` (`LEASE_DEFAULTS`)
- Modify: `lib/curtain/settle.mjs` or wherever `settleSynthLeakSec` default (180) lives — find with `rtk proxy grep -rn "settleSynthLeakSec" lib/`
- Modify (docs, same commit): `AGENTS.md` config table rows + the settle prose (`subagentTtlSec` 120→300, `bgShellTtlSec` 120→300, `settleSynthLeakSec` 180→360)
- Test: `test/session.test.mjs`, `test/lease.test.mjs` (or wherever LEASE_DEFAULTS is asserted), settle tests

**Interfaces:**
- Produces: `LEASE_DEFAULTS.subagentTtlSec === 300`, `LEASE_DEFAULTS.bgShellTtlSec === 300`, leak default 360. Later tasks and existing tests that hard-code 120 for these two kinds must be updated to the new defaults — that is part of this task, they encode the old contract.

Rationale: monitors heartbeat every ~3 min; a 120s lease dies in the gap even with Task 1 (no event = no heal). 300s covers the cadence with slack while staying fail-idle (a crashed CLI settles ≤5 min). The leak-settle ceiling must stay ABOVE the TTL (invariant: `settleSynthLeakSec > subagentTtlSec`), else settle kills leases TTL would have kept.

- [ ] **Step 1: Write failing tests**:

```js
test("Claude Stop with empty background_tasks does not wipe live subagent/shell leases", () => {
  // leases: subagent:mon1 + bg_shell:sh1, both live.
  // fire Stop with hasTasks: true, subagentIds: [], shellIds: []  (empty lists)
  // assert both leases still live (they decay by TTL, not by this event)
});

test("Claude Stop with non-empty background_tasks stays authoritative", () => {
  // leases: subagent:mon1, subagent:stale2
  // Stop with hasTasks: true, subagentIds: ["mon1"]
  // assert mon1 live, stale2 gone
});

test("SubagentStop with empty inflight list still reconciles to empty", () => {
  // last subagent reporting: SubagentStop, hasTasks: true, subagentIds: []
  // assert no live subagent leases (do-not-strand-WORKING rule intact)
});

test("Grok Stop (no tasks) still reconciles subagents to empty", () => {
  // hasTasks: false, event Stop → RC1 unchanged
});
```

- [ ] **Step 2: Verify failures**
- [ ] **Step 3: Implement** — replace the `else if (ev.hasTasks)` branch body:

```js
  } else if (ev.hasTasks) {
    const subIds = subagentIdsFromEv(ev);
    const shIds = shellIdsFromEv(ev);
    // Claude Stop sometimes reports background_tasks: [] while monitors and
    // shells are demonstrably alive (captured live 2026-07-16). An empty list
    // on Stop must not wipe inventory -- TTL decay retires the leases within
    // one TTL if the emptiness was real. Non-empty lists, and every
    // SubagentStop, stay authoritative.
    const distrust =
      ev.event === "Stop" && subIds.length === 0 && shIds.length === 0;
    if (!distrust) {
      leases = reconcile(leases, "subagent", subIds, nowSec, leaseCfg);
      leases = reconcile(leases, "bg_shell", shIds, nowSec, leaseCfg);
    }
  } else if (ev.event === "Stop") {
```

Then bump `LEASE_DEFAULTS`: `subagentTtlSec: 300`, `bgShellTtlSec: 300` (turn stays 120), and the leak default 180→360. Update every existing test that asserted the old 120/180 defaults for these keys. Update AGENTS.md rows/prose in the same commit.

- [ ] **Step 4: Full suite + lint green**
- [ ] **Step 5: Commit** `fix(curtain): distrust empty background_tasks on Stop; subagent/shell TTL 300s`

---

### Task 3: Done-state card shows parked subagents

**Files:**
- Modify: `lib/surfaces/curtain-card.mjs` (`infoLines`, done case ~line 40)
- Test: `test/curtain-card.test.mjs`

- [ ] **Step 1: Write failing test**:

```js
test("done tail lists parked subagents before tasks and watchers", () => {
  // infoLines("done", { worked: 297, subagents: 2, shells: 3, watchers: 1 })
  // → tail line contains "2 subagents in bg · 3 tasks in bg · 1 watcher in bg"
});
```

- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement** — in the `done` case, before the `sh` push:

```js
      const subs = Number(subagents) || 0;
      if (subs) tail.push(`${plural(subs, "subagent")} in bg`);
```

- [ ] **Step 4: Full suite + lint green**
- [ ] **Step 5: Commit** `fix(curtain): done card shows parked subagents in bg`

---

### Task 4: Combo smoke — monitor-sandwich lifecycle locked

**Files:**
- Test: `test/session.test.mjs` (integration-style, fake tmux + fake clock)

- [ ] **Step 1: Write the repro test**: SubagentStart (agentId `mon1`) at t=0 → parent goes quiet → heartbeat `PreToolUse`/`PostToolUse` with agentId `mon1` at t=200, 400, 600 (each beyond the old 120s TTL) → assert after each heartbeat `countLive` reports 1 subagent. At t=610 fire Stop with `hasTasks: true` and empty lists → assert subagent lease still live and state stays WORKING. At t=620 fire SubagentStop for `mon1` with empty inflight → assert no live subagents and settle path can reach DONE.
- [ ] **Step 2–4:** should pass if Tasks 1–3 are right; if not, fix the engine, not the test.
- [ ] **Step 5: Commit** `test(curtain): monitor-sandwich lifecycle repro locked`

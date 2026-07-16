# P6: Watcher Truth — leases decay honestly, watchers never hold WORKING

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the four live defects that make curtains lie: immortal leases (blanket `touch`), watchers holding WORKING, fossil `@herald_bg_*` options feeding pre-merge card loops, and stale cross-CLI model hints.

**Architecture:** All changes inside the existing truth-lease engine (`lib/curtain/`). No new files. Semantics change: a watcher lease is *informational only* — it renders as an info line but never holds WORKING and never blocks settle. Leases are refreshed only by evidence for their own kind.

**Tech Stack:** Node ESM, `node --test` suite, biome lint via `node --run lint`.

## Global Constraints

- Branch: `fix/watcher-truth` (this worktree). Commit after each task. NEVER push, NEVER merge.
- Full suite green after every task: `npm test` (378 pass baseline + your new tests) and `node --run lint`.
- Never run `herald curtain install`, never touch tmux options of live sessions, never spawn tmux commands in tests (suite uses fake tmux already — follow existing test patterns in `test/`).
- Match existing code style: JSDoc on exported functions, comments state constraints not narration.
- Docs claims: if `AGENTS.md` or `docs/` state "watchers hold WORKING" (grep for it), update those sentences to the new semantics in the same commit as Task 3.

## Live-bug evidence (why each fix is right)

Observed on session `herald-sage-oracle-armory` at epoch 1784219153: `@herald_leases watcher:mon:1784220051,turn:turn:1784219271`, `@herald_state working` while the CLI sat idle waiting for user input. `watcher:mon` was granted hours earlier by a Monitor tool call; every hook event re-armed it via blanket `touch` (session.mjs:565) so exp stayed `last_active + 900` forever, and `nextState` Stop kept WORKING because `stored.watchers > 0`. Separately, tmux carries `@herald_bg_watchers 1` / `@herald_bg_watcher_ids mon` — options NO merged code writes (grep proves it) — and pre-merge `_curtain` bash loops still render them.

---

### Task 1: Kind-scoped `touch` in lease.mjs

**Files:**
- Modify: `lib/curtain/lease.mjs` (the `touch` export, currently ~line 159)
- Test: `test/curtain-lease.test.mjs` (or wherever existing `touch` tests live — find with `rtk proxy grep -rln "touch(" test/`)

**Interfaces:**
- Produces: `touch(leases, nowSec, cfg = {}, kinds = null)` — when `kinds` is a non-empty array, only leases whose `kind` is included are re-armed; all other non-expired leases pass through UNCHANGED (same exp). `kinds = null`/omitted keeps today's behavior (re-arm all) so existing callers/tests stay valid.

- [ ] **Step 1: Write failing tests**

```js
// in the existing touch describe block
test("touch with kinds re-arms only listed kinds", () => {
  const now = 1000;
  const leases = [
    { kind: "watcher", id: "mon", exp: 1100 },
    { kind: "subagent", id: "s1", exp: 1050 },
  ];
  const out = touch(leases, now, {}, ["subagent"]);
  const mon = out.find((l) => l.id === "mon");
  const s1 = out.find((l) => l.id === "s1");
  assert.equal(mon.exp, 1100); // untouched
  assert.equal(s1.exp, now + LEASE_DEFAULTS.subagentTtlSec);
});

test("touch with kinds still drops expired leases of any kind", () => {
  const now = 1000;
  const leases = [{ kind: "watcher", id: "mon", exp: 999 }];
  assert.deepEqual(touch(leases, now, {}, ["subagent"]), []);
});
```

- [ ] **Step 2: Run tests, verify both fail** (`node --test test/<file> 2>&1 | tail`)

- [ ] **Step 3: Implement**

```js
export const touch = (leases, nowSec, cfg = {}, kinds = null) => {
  const now = Number(nowSec) || 0;
  if (!Array.isArray(leases)) return [];
  const pick = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
  return leases
    .filter((l) => l && Number(l.exp) > now)
    .map((l) =>
      pick && !pick.has(l.kind)
        ? l
        : { kind: l.kind, id: l.id, exp: now + ttlSecFor(l.kind, cfg) },
    );
};
```

- [ ] **Step 4: Full suite + lint green**
- [ ] **Step 5: Commit** `fix(curtain): kind-scoped lease touch`

---

### Task 2: stampFromHook stops feeding watchers; legacy option cleanup; model hint source

**Files:**
- Modify: `lib/curtain/session.mjs` (`stampFromHook`)
- Test: `test/curtain-session.test.mjs` (follow existing fake-tmux patterns there)

**Interfaces:**
- Consumes: Task 1's `touch(leases, now, cfg, kinds)`.
- Produces: behavioral contract only (no new exports).

Three changes inside `stampFromHook`:

**(a) Scoped touch.** Replace the current turn-lease block's blanket touch:

```js
  // Turn lease: activity grants/refreshes; Stop releases. Watchers are NOT
  // touched by generic activity — they live only on their own evidence
  // (loop wakeup / scheduler_create / monitor call) plus TTL decay.
  if (
    isActiveHookEvent(ev) ||
    (ev.event === "UserPromptSubmit" && !ev.synthetic)
  ) {
    leases = grant(leases, "turn", "turn", nowSec, leaseCfg);
    leases = touch(leases, nowSec, leaseCfg, ["subagent", "bg_shell", "turn"]);
  }
```

**(b) Legacy fossil cleanup.** On `SessionStart` OR non-synthetic `UserPromptSubmit`, unset the pre-lease display options (old, still-running card loops read them; merged code never writes them, so they show frozen counts forever):

```js
const LEGACY_BG_OPTS = [
  "@herald_bg_watchers",
  "@herald_bg_watcher_ids",
  "@herald_bg_subagents",
  "@herald_bg_subagent_ids",
  "@herald_bg_shells",
  "@herald_tasks_seen",
];
```

In `stampFromHook`, early (near the PID/model-hint block):

```js
  if (
    ev.event === "SessionStart" ||
    (ev.event === "UserPromptSubmit" && !ev.synthetic)
  ) {
    for (const opt of LEGACY_BG_OPTS) {
      if (t.getSessOpt(sess, opt)) t.setSessOpt(sess, opt, "");
    }
  }
```

(Check whether the fake tmux + real tmux wrapper support an `unset`; if `setSessOpt(sess, opt, "")` is the established way to blank an option in this codebase, use it — old card scripts treat empty as 0.)

**(c) Model hint source tag.** Replace the set-once hint block:

```js
    if (ev.sourceCli && ev.sourceCli !== "unknown") {
      const prevSrc = t.getSessOpt(sess, "@herald_model_hint_src");
      if (prevSrc && prevSrc !== ev.sourceCli) {
        // CLI changed (e.g. grok child finished, Fable session resumed):
        // the old hint is a lie for this source — drop it.
        t.setSessOpt(sess, "@herald_model_hint", "");
        t.setSessOpt(sess, "@herald_model_hint_src", "");
      }
      if (!t.getSessOpt(sess, "@herald_model_hint")) {
        const model = process.env.GROK_MODEL || process.env.LLM_PRESET || "";
        if (model) {
          const effort = process.env.GROK_EFFORT || "";
          t.setSessOpt(
            sess,
            "@herald_model_hint",
            effort ? `${model}@${effort}` : model,
          );
          t.setSessOpt(sess, "@herald_model_hint_src", ev.sourceCli);
        }
      }
    }
```

Keep this inside the existing `isActiveHookEvent(ev)` guard where the hint block lives today.

- [ ] **Step 1: Write failing tests** (fake tmux; follow existing stampFromHook tests):
  - active PostToolUse event does NOT extend a watcher lease's exp (grant watcher at t=0 with 900 TTL, fire PostToolUse at t=100, assert watcher exp still `0+900`, not `100+900`)
  - subagent lease IS re-armed by the same event
  - non-synthetic UserPromptSubmit blanks `@herald_bg_watchers` when set
  - grok-sourced event with `GROK_MODEL=x` env stamps hint + src `grok`; later claude-sourced event clears both
- [ ] **Step 2: Verify failures**
- [ ] **Step 3: Implement (a)+(b)+(c)**
- [ ] **Step 4: Full suite + lint green**
- [ ] **Step 5: Commit** `fix(curtain): watchers decay honestly; clear legacy bg fossils; source-tagged model hint`

---

### Task 3: Watchers never hold WORKING (nextState + settle)

**Files:**
- Modify: `lib/curtain/hook.mjs` (`nextState`), `lib/curtain/settle.mjs` (`totalLive`), `lib/curtain/session.mjs` (`shouldSettleSynthSubagentStop`)
- Modify (docs, same commit): any `AGENTS.md`/`docs/` sentence claiming watchers hold WORKING
- Test: existing nextState/settle test files

Changes:

**(a) `nextState` Stop case** — watchers no longer hold:

```js
    case "Stop":
      if (inflightSubagents(ev, stored) > 0) return STATES.WORKING;
      return STATES.DONE;
```

Update the comment above the case: background shells AND watchers are informational; only subagents keep the turn alive.

**(b) `nextState` synthetic UserPromptSubmit** — a *wakeup firing* is real work starting; a merely-armed watcher is not:

```js
      if (ev.loopPrompt) return STATES.WORKING;
      if ((stored.subagents || 0) > 0) return STATES.WORKING;
      if (ev.taskCompleteInject) return STATES.WORKING;
      return cur;
```

(Replaces the `stored.watchers > 0` clause.)

**(c) `settle.mjs` `totalLive`** — watcher excluded, so a lone watcher cannot block quiet settle:

```js
const totalLive = (counts) => {
  const c = counts || {};
  // watcher deliberately excluded: informational, never holds state.
  return (
    (Number(c.subagent) || 0) +
    (Number(c.bg_shell) || 0) +
    (Number(c.turn) || 0)
  );
};
```

Also update the file-top comment (`// No lease kind is exempt — watchers hold only while live...`) to the new truth.

**(d) `shouldSettleSynthSubagentStop`** — drop the `watchers === 0` condition (and its parameter if now unused; keep signature backward-compatible if tests pass it).

- [ ] **Step 1: Write failing tests**:
  - `nextState("working", {event:"Stop", hasTasks:false}, {subagents:0, watchers:1})` → `done`
  - synthetic UserPromptSubmit with `loopPrompt: true` → `working`; with only `stored.watchers: 1` → returns `cur`
  - `settleIfStale` with state WORKING, counts `{watcher:1, turn:0, subagent:0, bg_shell:0}`, quiet past threshold → returns DONE decision (previously null)
- [ ] **Step 2: Verify failures**
- [ ] **Step 3: Implement (a)–(d) + docs sentence fixes**
- [ ] **Step 4: Full suite + lint green** — expect existing tests asserting the OLD semantics (watchers hold WORKING) to fail: UPDATE those tests to the new contract, they are the point of this change. Any other failure = your bug.
- [ ] **Step 5: Commit** `fix(curtain): watcher leases are informational — never hold WORKING or block settle`

---

### Task 4: Combo smoke — the live repro can't recur

**Files:**
- Test: add one integration-style test in the session test file

- [ ] **Step 1: Write the repro test** (fake tmux, fake clock): grant `watcher:mon` via a Monitor PreToolUse event at t=0; fire PostToolUse events at t=60, 120, 180 (busy session); fire `Stop` (no tasks) at t=200. Assert: state is `done`, watcher lease exp is `0+900` (never re-armed). Then advance to t=901 and run `applySettle`; assert `countLive` reports 0 watchers.
- [ ] **Step 2–4:** should pass already if Tasks 1–3 are right; if not, fix the engine, not the test.
- [ ] **Step 5: Commit** `test(curtain): immortal-watcher repro locked`

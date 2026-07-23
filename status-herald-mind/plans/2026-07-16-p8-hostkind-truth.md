# P8: Host-kind Truth — Claude sessions are never quiet-settled

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop DONE-flashes on Claude sessions mid-turn: host-kind classification must follow `sourceCli` evidence, not the false signal of a bt-less SubagentStart; genuine synthesis hosts get thinking headroom.

**Architecture:** Two condition changes in `lib/curtain/session.mjs` host-kind transitions, one default bump in settle config. No new files, no state-machine changes.

**Tech Stack:** Node ESM, `node --test`, biome via `node --run lint`.

## Global Constraints

- Branch: `fix/hostkind-truth` (this worktree). Commit after each task. NEVER push, NEVER merge.
- Full suite green after every task: `npm test` (394 pass baseline + your new tests) and `node --run lint`.
- Never run `herald curtain install`, never touch tmux options of live sessions, no tmux in tests (fake tmux patterns in `test/`).
- Grok behavior: pure-synthesis hosts must keep quiet settle and SubagentStop settle — only the numeric default changes.

## Live-bug evidence (2026-07-16)

Session `hermes` (Claude CLI, xhigh effort) flashed DONE while the CLI showed `✢ Running mail research lane… (36s · thinking…)`. Mechanics, all confirmed in code + captured payloads:

1. Claude `SubagentStart` payloads NEVER carry `background_tasks` (capture: keys are `session_id, transcript_path, cwd, prompt_id, agent_id, agent_type, hook_event_name`). So `session.mjs` ~line 560 — `if (hostKind === "task_list" && !ev.hasTasks) hostKind = "hybrid"` — demotes EVERY Claude session on its 2nd+ subagent spawn. `hermes` sits at `@herald_host_kind hybrid` right now.
2. Hybrid hosts inherit synthesis settle heuristics: `shouldSettleSynthSubagentStop` (session.mjs ~422) flips DONE on a SubagentStop with `subs === 0` even while the main turn is open; `settleIfStale` quiet path flips DONE once all leases expire (turn TTL 120s) + 90s quiet — long thinking emits NO hook events, so a >2 min silent think = DONE flash, next event = WORKING again.
3. There is no hybrid→task_list promotion (only synthesis→task_list at ~line 528), so a wrongly demoted session never recovers.

Claude has a reliable `Stop` event — its sessions must live by Stop, not by silence heuristics. `ev.sourceCli` ("claude"|"grok"|"unknown") is already populated by the adapters.

---

### Task 1: Demotion requires non-Claude evidence; hybrid re-promotes on Claude task list

**Files:**
- Modify: `lib/curtain/session.mjs` (~lines 528 and 560)
- Test: `test/session.test.mjs`

**Interfaces:** behavioral contract only; `ev.sourceCli` already exists on CanonicalEvent.

- [ ] **Step 1: Write failing tests** (fake tmux, existing stampFromHook patterns):

```js
test("claude SubagentStart does not demote task_list to hybrid", () => {
  // host pre-set task_list; fire SubagentStart with sourceCli: "claude", hasTasks: false
  // assert @herald_host_kind still "task_list"
});

test("grok SubagentStart still demotes task_list to hybrid", () => {
  // same but sourceCli: "grok" → "hybrid"
});

test("claude hasTasks event re-promotes hybrid to task_list", () => {
  // host pre-set hybrid; fire Stop with sourceCli: "claude", hasTasks: true (any list)
  // assert @herald_host_kind "task_list"
});

test("grok hasTasks event does not re-promote hybrid", () => {
  // host hybrid; synthetic grok event with hasTasks true (grok adapter can produce
  // backgroundTasks) → stays hybrid
});
```

- [ ] **Step 2: Verify failures**
- [ ] **Step 3: Implement** — two edits:

Replace (~line 528):

```js
  // 2. Host kind classification.
  if (ev.hasTasks && hostKind === "synthesis") {
    hostKind = "task_list";
    t.setSessOpt(sess, "@herald_host_kind", "task_list");
  }
```

with:

```js
  // 2. Host kind classification. A Claude-sourced task list is proof the
  // reliable-Stop CLI is speaking: it claims (or reclaims) task_list even
  // from hybrid, so a wrongly demoted session self-heals on its next Stop.
  if (
    ev.hasTasks &&
    (hostKind === "synthesis" ||
      (hostKind === "hybrid" && ev.sourceCli === "claude"))
  ) {
    hostKind = "task_list";
    t.setSessOpt(sess, "@herald_host_kind", "task_list");
  }
```

Replace (~line 560, inside the SubagentStart branch):

```js
    if (hostKind === "task_list" && !ev.hasTasks) {
      hostKind = "hybrid";
      t.setSessOpt(sess, "@herald_host_kind", "hybrid");
    }
```

with:

```js
    // Claude SubagentStart never carries background_tasks (captured live
    // 2026-07-16) -- a bt-less start proves host mixing only when it comes
    // from a NON-Claude CLI. Demoting on Claude's own starts put every
    // multi-subagent Claude session on Grok's silence heuristics.
    if (
      hostKind === "task_list" &&
      !ev.hasTasks &&
      ev.sourceCli !== "claude"
    ) {
      hostKind = "hybrid";
      t.setSessOpt(sess, "@herald_host_kind", "hybrid");
    }
```

- [ ] **Step 4: Full suite + lint green** — existing tests asserting the old demotion for claude-sourced events encode the bug: update them; anything else failing is your bug.
- [ ] **Step 5: Commit** `fix(curtain): host-kind follows sourceCli — Claude never demotes itself to hybrid`

---

### Task 2: Thinking headroom for synthesis hosts

**Files:**
- Modify: `lib/curtain/settle.mjs` (`SETTLE_DEFAULTS.settleSynthQuietSec` 90 → 300), `lib/config.mjs` (same default), `AGENTS.md` (settle prose sentence + config table row for `settleSynthQuietSec`; also fix the hybrid sentence in the "Grok has no idle_prompt" bullet if it claims Claude sessions become hybrid)
- Test: whatever tests assert the 90 default (find with `rtk proxy grep -rn "settleSynthQuietSec\| 90" test/settle.test.mjs test/config.test.mjs`)

Rationale: long reasoning ("thinking") emits zero hook events; 120s turn TTL + 90s quiet = DONE flash after ~2 min of silence on synthesis/hybrid hosts. 300s quiet (≈7 min total silence before settle) keeps the RC3 safety net while surviving deep thinking. Crashed CLIs are caught faster by the PID backstop regardless.

- [ ] **Step 1: Update/write tests** for the new default (settle fires at quiet ≥ 300, not at 90)
- [ ] **Step 2: Verify failures**
- [ ] **Step 3: Implement** (both defaults + docs in same commit)
- [ ] **Step 4: Full suite + lint green**
- [ ] **Step 5: Commit** `fix(curtain): synthesis quiet settle 90s→300s — silent thinking is not idleness`

---

### Task 3: Combo smoke — the hermes flash can't recur

**Files:**
- Test: `test/session.test.mjs`

- [ ] **Step 1: Write the repro test** (fake tmux + fake clock): host task_list, Claude session mid-turn. (a) SubagentStart `lane1` (sourceCli claude, no bt) at t=0 → assert hostKind still task_list. (b) SubagentStop `lane1` at t=30 with bt listing nothing inflight → subs go 0; assert state stays WORKING (shouldSettleSynthSubagentStop must not fire on task_list). (c) Silence until t=400 (turn lease long expired), run the settle path (`settleIfStale` with hostKind task_list, counts all zero, quiet 400) → assert it returns null (no DONE). (d) Stop with bt `[]` at t=410 → state DONE (turn genuinely over).
- [ ] **Step 2–4:** should pass if Tasks 1–2 are right; if not, fix the engine, not the test.
- [ ] **Step 5: Commit** `test(curtain): hermes mid-turn DONE-flash repro locked`

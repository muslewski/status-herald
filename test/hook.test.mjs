import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nextState,
  parseHookPayload,
  resetsElapsed,
} from "../lib/curtain/hook.mjs";
import { STATES } from "../lib/curtain/state.mjs";

const ev = (o) => ({
  event: "Stop",
  agentId: "",
  notificationType: "",
  hasTasks: false,
  subagents: 0,
  shells: 0,
  ...o,
});

const payload = (o) => JSON.stringify({ hook_event_name: "Stop", ...o });

const task = (o) => ({ id: "t1", type: "shell", status: "running", ...o });

test("parseHookPayload rejects junk without throwing", () => {
  assert.equal(parseHookPayload(""), null);
  assert.equal(parseHookPayload("not json"), null);
  assert.equal(parseHookPayload("null"), null);
  assert.equal(parseHookPayload("[]"), null);
  assert.equal(parseHookPayload('{"no":"event"}'), null);
});

test("parseHookPayload counts running subagents and shells separately", () => {
  const p = parseHookPayload(
    payload({
      background_tasks: [
        task({ id: "a1", type: "subagent" }),
        task({ id: "a2", type: "subagent" }),
        task({ id: "s1", type: "shell" }),
      ],
    }),
  );
  assert.equal(p.subagents, 2);
  assert.equal(p.shells, 1);
});

test("parseHookPayload treats a missing background_tasks as nothing in flight", () => {
  const p = parseHookPayload(payload({}));
  assert.equal(p.subagents, 0);
  assert.equal(p.shells, 0);
});

test("parseHookPayload ignores tasks that are not running", () => {
  const p = parseHookPayload(
    payload({
      background_tasks: [
        task({ id: "s1", status: "completed" }),
        task({ id: "s2", status: "failed" }),
        task({ id: "s3", status: "running" }),
      ],
    }),
  );
  assert.equal(p.shells, 1);
});

test("parseHookPayload excludes the reporting subagent from its own in-flight list", () => {
  // Observed live: SubagentStop lists the very subagent that is stopping as
  // "running" in 68 of 295 samples. Counting it would keep the session WORKING
  // forever after the last subagent reports.
  const p = parseHookPayload(
    payload({
      hook_event_name: "SubagentStop",
      agent_id: "a1",
      background_tasks: [task({ id: "a1", type: "subagent" })],
    }),
  );
  assert.equal(p.agentId, "a1");
  assert.equal(p.subagents, 0, "own agent must not count as in flight");
});

test("parseHookPayload accepts Grok/camelCase payload shape (hookEventName, notificationType, no background_tasks)", () => {
  const p = parseHookPayload(
    JSON.stringify({
      hookEventName: "Notification",
      notificationType: "approval_required",
    }),
  );
  assert.equal(p.event, "Notification");
  assert.equal(p.notificationType, "permission_prompt");
  assert.equal(p.hasTasks, false);
});

test("parseHookPayload accepts Grok Stop and Subagent* variants; falls back on env", () => {
  const p1 = parseHookPayload(JSON.stringify({ hookEventName: "Stop" }));
  assert.equal(p1.event, "Stop");
  const p2 = parseHookPayload(
    JSON.stringify({ hookEventName: "subagentStart" }),
  );
  assert.equal(p2.event, "SubagentStart");
  // env fallback when no field (rare)
  const old = process.env.GROK_HOOK_EVENT;
  try {
    process.env.GROK_HOOK_EVENT = "UserPromptSubmit";
    const p3 = parseHookPayload("{}");
    assert.equal(p3?.event, "UserPromptSubmit");
  } finally {
    if (old === undefined) process.env.GROK_HOOK_EVENT = undefined;
    else process.env.GROK_HOOK_EVENT = old;
  }
});

test("a user prompt starts work and restarts the clock", () => {
  assert.equal(
    nextState(STATES.IDLE, ev({ event: "UserPromptSubmit" })),
    STATES.WORKING,
  );
  assert.equal(resetsElapsed(ev({ event: "UserPromptSubmit" })), true);
  assert.equal(resetsElapsed(ev({ event: "Stop" })), false);
});

test("dispatching a subagent keeps the session working", () => {
  assert.equal(
    nextState(STATES.DONE, ev({ event: "SubagentStart" })),
    STATES.WORKING,
  );
});

test("Stop with a subagent still running does NOT mean done", () => {
  // The bug. Claude Code fires Stop once per user prompt -- when the MAIN
  // agent's turn ends -- even with subagents still running, and never re-fires
  // it when a finishing subagent wakes the agent back up.
  assert.equal(
    nextState(STATES.WORKING, ev({ event: "Stop", subagents: 2 })),
    STATES.WORKING,
  );
});

test("Stop with only background shells running does mean done", () => {
  // A background shell (CI watch, long build) does not block you: the agent has
  // genuinely finished its turn and you can move on.
  assert.equal(
    nextState(STATES.WORKING, ev({ event: "Stop", shells: 1 })),
    STATES.DONE,
  );
});

test("Stop with nothing in flight means done", () => {
  assert.equal(nextState(STATES.WORKING, ev({ event: "Stop" })), STATES.DONE);
});

test("SubagentStop never resurrects WORKING from a settled card", () => {
  // Claude Code fires an internal, unattributed SubagentStop ~2s after almost
  // every Stop (90 of 91 observed carry no agent_id). Were that to flip the
  // card back to WORKING, no session would ever come to rest.
  assert.equal(
    nextState(STATES.DONE, ev({ event: "SubagentStop" })),
    STATES.DONE,
  );
  assert.equal(
    nextState(STATES.NEEDS, ev({ event: "SubagentStop", subagents: 1 })),
    STATES.NEEDS,
  );
});

test("SubagentStop holds a still-working session at WORKING", () => {
  assert.equal(
    nextState(STATES.WORKING, ev({ event: "SubagentStop", subagents: 1 })),
    STATES.WORKING,
  );
  // Last subagent out: main is waking to compose its reply, and only
  // idle_prompt ever marks the end of a turn resumed that way.
  assert.equal(
    nextState(STATES.WORKING, ev({ event: "SubagentStop" })),
    STATES.WORKING,
  );
});

test("a permission prompt blocks the session", () => {
  const n = ev({
    event: "Notification",
    notificationType: "permission_prompt",
  });
  assert.equal(nextState(STATES.WORKING, n), STATES.NEEDS);
});

test("idle_prompt is the terminal signal a resumed turn never sends otherwise", () => {
  // 97 of 153 idle_prompts follow no Stop at all -- they are the only end-marker
  // a turn resumed by a completing background task ever emits.
  const n = ev({ event: "Notification", notificationType: "idle_prompt" });
  assert.equal(nextState(STATES.WORKING, n), STATES.DONE);
});

test("idle_prompt does not mean done while subagents are still running", () => {
  // Observed live (eventizer, 2026-07-09): Stop at 20:07:22 carried three
  // running subagents and correctly held WORKING; idle_prompt at 20:08:22 then
  // flipped the card to DONE while all three were still working. A Notification
  // payload carries no background_tasks -- its only keys are `message` and
  // `notification_type` -- so the rule has to consult the counts we stored from
  // the last event that did carry them. "Main agent is idle" is exactly what a
  // main agent looks like while it waits on its subagents.
  const n = ev({ event: "Notification", notificationType: "idle_prompt" });
  assert.equal(nextState(STATES.WORKING, n, { subagents: 3 }), STATES.WORKING);
  assert.equal(nextState(STATES.DONE, n, { subagents: 1 }), STATES.WORKING);
});

test("idle_prompt with only background shells left is still done", () => {
  // A shell never blocks you, so it must not hold the card at WORKING.
  const n = ev({ event: "Notification", notificationType: "idle_prompt" });
  assert.equal(
    nextState(STATES.WORKING, n, { subagents: 0, shells: 2 }),
    STATES.DONE,
  );
});

test("a permission prompt beats a running subagent", () => {
  // You are blocked either way, but only NEEDS YOU tells you to go look.
  const n = ev({
    event: "Notification",
    notificationType: "permission_prompt",
  });
  assert.equal(nextState(STATES.WORKING, n, { subagents: 3 }), STATES.NEEDS);
});

test("Stop trusts its own payload over the stored counts", () => {
  // Stop always carries background_tasks, so a stale stored count must not
  // resurrect WORKING once the subagents have actually drained.
  const stop = ev({ event: "Stop", subagents: 0, hasTasks: true });
  assert.equal(nextState(STATES.WORKING, stop, { subagents: 3 }), STATES.DONE);
});

test("idle_prompt must never clear a pending permission prompt", () => {
  // Observed live: idle_prompt can fire while a permission prompt is still
  // unanswered. Flipping to DONE there would hide a blocked agent.
  const n = ev({ event: "Notification", notificationType: "idle_prompt" });
  assert.equal(nextState(STATES.NEEDS, n), STATES.NEEDS);
});

test("an informational notification never hijacks a working card", () => {
  // The bug: Grok fires `task_complete` every time a background task finishes
  // (~470/day on executor sessions like token-oracle and agentic-sage); a push
  // the agent SENT and any unrecognized ping are the same kind of thing. None of
  // them means "blocked on you", so none may flip a session off what it is doing.
  for (const notificationType of [
    "task_complete",
    "push_notification",
    "something_new",
  ]) {
    const n = ev({ event: "Notification", notificationType });
    assert.equal(
      nextState(STATES.WORKING, n),
      STATES.WORKING,
      notificationType,
    );
    assert.equal(nextState(STATES.DONE, n), STATES.DONE, notificationType);
  }
});

test("Grok task_complete does not raise a false NEEDS while working", () => {
  // End to end through parseHookPayload, the Grok camelCase shape observed live.
  const p = parseHookPayload(
    JSON.stringify({
      hookEventName: "notification",
      notificationType: "task_complete",
    }),
  );
  assert.equal(p.event, "Notification");
  assert.equal(p.notificationType, "task_complete");
  assert.equal(nextState(STATES.WORKING, p), STATES.WORKING);
});

test("a surfaced agent error still asks for you", () => {
  const n = ev({ event: "Notification", notificationType: "agent_error" });
  assert.equal(nextState(STATES.WORKING, n), STATES.NEEDS);
});

test("Grok approval_required notification maps to NEEDS", () => {
  // The approval_required -> permission_prompt mapping lives in parseHookPayload,
  // so the mapping has to be exercised through it (the real hook path always is).
  const p = parseHookPayload(
    JSON.stringify({
      hookEventName: "notification",
      notificationType: "approval_required",
    }),
  );
  assert.equal(p.notificationType, "permission_prompt");
  assert.equal(nextState(STATES.WORKING, p), STATES.NEEDS);
});

test("an unknown event leaves the state alone", () => {
  assert.equal(
    nextState(STATES.WORKING, ev({ event: "PreToolUse" })),
    STATES.WORKING,
  );
});

test("PostToolUse clears a stale NEEDS/COMPACTING/DONE back to working", () => {
  // Claude Code fires no event when a block clears -- the tool the agent ran is
  // the only proof it is active again. A permission_prompt that set NEEDS, a
  // PreCompact that set COMPACTING, or a DONE the turn has since moved past all
  // clear to WORKING on the next tool.
  const t = ev({ event: "PostToolUse" });
  assert.equal(nextState(STATES.NEEDS, t), STATES.WORKING);
  assert.equal(nextState(STATES.COMPACTING, t), STATES.WORKING);
  assert.equal(nextState(STATES.DONE, t), STATES.WORKING);
});

test("PostToolUse normalizes from Claude snake and camelCase shapes", () => {
  assert.equal(
    parseHookPayload(JSON.stringify({ hook_event_name: "PostToolUse" })).event,
    "PostToolUse",
  );
  assert.equal(
    parseHookPayload(JSON.stringify({ hookEventName: "post_tool_use" })).event,
    "PostToolUse",
  );
});

test("PostToolUse does not restart the elapsed clock", () => {
  // Only a new user prompt resets the wait timer; tools within a turn keep it.
  assert.equal(resetsElapsed(ev({ event: "PostToolUse" })), false);
});

test("PreCompact shows the session as compacting, not finished", () => {
  // Compaction is real work with no live output. Before this, no event moved the
  // card, so a session compacting after a turn sat on DONE and looked ready.
  assert.equal(
    nextState(STATES.DONE, ev({ event: "PreCompact" })),
    STATES.COMPACTING,
  );
  assert.equal(
    nextState(STATES.WORKING, ev({ event: "PreCompact" })),
    STATES.COMPACTING,
  );
});

test("parseHookPayload normalizes the PreCompact event name", () => {
  assert.equal(
    parseHookPayload(payload({ hook_event_name: "PreCompact" })).event,
    "PreCompact",
  );
  // Grok/snake spelling, should it ever fire one.
  assert.equal(
    parseHookPayload(JSON.stringify({ hookEventName: "pre_compact" })).event,
    "PreCompact",
  );
});

test("a completing turn drains COMPACTING back to DONE", () => {
  // The end-marker after compaction (idle_prompt when it ends, or the resumed
  // turn's Stop) must move it on, so COMPACTING never sticks.
  const idle = ev({ event: "Notification", notificationType: "idle_prompt" });
  assert.equal(nextState(STATES.COMPACTING, idle), STATES.DONE);
  assert.equal(
    nextState(STATES.COMPACTING, ev({ event: "Stop" })),
    STATES.DONE,
  );
});

// Golden compact sequence — mirrors agentic-sage plan 026 / interop contract.
// Same normalized hook order: prompt → tools → PreCompact → drain → tools again.
// Herald must never show compacting as DONE; PostToolUse is "active again".
test("interop golden compact sequence: never DONE while compacting", () => {
  let s = STATES.IDLE;
  s = nextState(s, ev({ event: "UserPromptSubmit" }));
  assert.equal(s, STATES.WORKING);
  s = nextState(s, ev({ event: "PostToolUse" }));
  assert.equal(s, STATES.WORKING);
  s = nextState(s, ev({ event: "PreCompact" }));
  assert.equal(s, STATES.COMPACTING);
  assert.notEqual(s, STATES.DONE);
  // Drain via idle_prompt (primary end-marker after compact) or Stop.
  s = nextState(s, ev({ event: "Notification", notificationType: "idle_prompt" }));
  assert.equal(s, STATES.DONE);
  // Or: compact → PostToolUse resumes working (block cleared / turn continues).
  assert.equal(
    nextState(STATES.COMPACTING, ev({ event: "PostToolUse" })),
    STATES.WORKING,
  );
});

test("end to end: a subagent turn never reports DONE while the agent works", () => {
  // Replayed from a real recorded session (prompt f6214c38, 2026-07-09).
  const seen = [];
  let s = STATES.IDLE;
  const feed = (raw) => {
    const p = parseHookPayload(raw);
    s = nextState(s, p);
    seen.push(s);
  };
  feed(payload({ hook_event_name: "UserPromptSubmit" }));
  feed(payload({ hook_event_name: "SubagentStart", agent_id: "a1" }));
  feed(
    payload({
      hook_event_name: "Stop",
      background_tasks: [task({ id: "a1", type: "subagent" })],
    }),
  );
  feed(
    payload({
      hook_event_name: "SubagentStop",
      agent_id: "a1",
      background_tasks: [task({ id: "a1", type: "subagent" })],
    }),
  );
  assert.deepEqual(seen, [
    STATES.WORKING,
    STATES.WORKING,
    STATES.WORKING,
    STATES.WORKING,
  ]);
  feed(
    payload({
      hook_event_name: "Notification",
      notification_type: "idle_prompt",
    }),
  );
  assert.equal(s, STATES.DONE, "only now is it really done");
});

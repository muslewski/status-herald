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

test("idle_prompt must never clear a pending permission prompt", () => {
  // Observed live: idle_prompt can fire while a permission prompt is still
  // unanswered. Flipping to DONE there would hide a blocked agent.
  const n = ev({ event: "Notification", notificationType: "idle_prompt" });
  assert.equal(nextState(STATES.NEEDS, n), STATES.NEEDS);
});

test("an unknown notification surfaces rather than hides", () => {
  const n = ev({ event: "Notification", notificationType: "something_new" });
  assert.equal(nextState(STATES.WORKING, n), STATES.NEEDS);
});

test("an unknown event leaves the state alone", () => {
  assert.equal(
    nextState(STATES.WORKING, ev({ event: "PreCompact" })),
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

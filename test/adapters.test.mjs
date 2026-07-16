import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectSourceCli,
  normalizePayload,
} from "../lib/curtain/adapters/index.mjs";

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

test("detectSourceCli: claude markers", () => {
  assert.equal(
    detectSourceCli({ hook_event_name: "Stop", background_tasks: [] }),
    "claude",
  );
});

test("detectSourceCli: grok camelCase markers", () => {
  assert.equal(detectSourceCli({ hookEventName: "Stop" }), "grok");
});

test("PascalCase and Cursor aliases normalize via normalizePayload", () => {
  assert.equal(
    normalizePayload({ hookEventName: "PostToolUse" }).event,
    "PostToolUse",
  );
  assert.equal(
    normalizePayload({ hookEventName: "post_tool_use" }).event,
    "PostToolUse",
  );
  assert.equal(
    normalizePayload({ hookEventName: "afterAgentThought" }).event,
    "PostToolUse",
  );
  assert.equal(
    normalizePayload({ hookEventName: "afterAgentResponse" }).event,
    "PostToolUse",
  );
  assert.equal(
    normalizePayload({ hookEventName: "pre_compact" }).event,
    "PreCompact",
  );
  assert.equal(
    normalizePayload({ hookEventName: "PreToolUse" }).event,
    "PreToolUse",
  );
});

test("notification type normalization (Grok approval_required)", () => {
  const ev = normalizePayload({
    hookEventName: "notification",
    notificationType: "approval_required",
  });
  assert.equal(ev.event, "Notification");
  assert.equal(ev.notificationType, "permission_prompt");
});

test("task_complete and push_notification normalize", () => {
  assert.equal(
    normalizePayload({
      hookEventName: "Notification",
      notificationType: "task_complete",
    }).notificationType,
    "task_complete",
  );
  assert.equal(
    normalizePayload({
      hookEventName: "Notification",
      notificationType: "push_notification",
    }).notificationType,
    "push_notification",
  );
});

test("claude SubagentStop excludes reporting agent from inflight", () => {
  const ev = normalizePayload({
    hook_event_name: "SubagentStop",
    agent_id: "a1",
    background_tasks: [
      { id: "a1", type: "subagent", status: "running" },
      { id: "a2", type: "subagent", status: "running" },
    ],
  });
  assert.equal(ev.agentId, "a1");
  assert.deepEqual(ev.inflightIds, ["a2"]);
  assert.deepEqual(ev.subagentIds, ["a2"]);
});

test("pid extracted from payload when present", () => {
  const ev = normalizePayload({
    hook_event_name: "Stop",
    pid: 4242,
  });
  assert.equal(ev.pid, 4242);
});

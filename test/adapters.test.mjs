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

test("claude Monitor PostToolUse extracts toolTaskId from tool_response.taskId", () => {
  const ev = normalizePayload({
    hook_event_name: "PostToolUse",
    tool_name: "Monitor",
    tool_input: {
      description: "debt-fleet child completions",
      persistent: true,
      timeout_ms: 3600000,
      command: "while true; do sleep 60; done",
    },
    tool_response: { taskId: "bdxck8yos", timeoutMs: 0, persistent: true },
  });
  assert.equal(ev.event, "PostToolUse");
  assert.equal(ev.toolName, "Monitor");
  assert.equal(ev.toolTaskId, "bdxck8yos");
});

test("claude Bash background PostToolUse extracts toolTaskId from backgroundTaskId", () => {
  const ev = normalizePayload({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "sleep 999",
      description: "bg shell",
      run_in_background: true,
    },
    tool_response: {
      stdout: "",
      stderr: "",
      interrupted: false,
      backgroundTaskId: "b1ik7ojoi",
    },
  });
  assert.equal(ev.toolBackground, true);
  assert.equal(ev.toolTaskId, "b1ik7ojoi");
});

test("claude background_tasks type monitor is not counted as shell", () => {
  const ev = normalizePayload({
    hook_event_name: "Stop",
    background_tasks: [
      { id: "s1", type: "shell", status: "running", description: "build" },
      {
        id: "m1",
        type: "monitor",
        status: "running",
        description: "watch child",
      },
      {
        id: "m2",
        type: "shell",
        status: "running",
        description: "poll worktree",
        // still shell-typed — only explicit type:monitor splits here
      },
    ],
  });
  assert.deepEqual(ev.shellIds, ["s1", "m2"]);
  assert.deepEqual(ev.monitorIds, ["m1"]);
  assert.equal(ev.shells, 2);
  assert.equal(ev.monitors, 1);
});

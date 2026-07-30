import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  findActiveByPid,
  inventoryForPid,
  listGrokHomes,
  listSubagentMetas,
  openBgShellIds,
  runningSubagentIds,
} from "../lib/status/grok-inventory.mjs";

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "herald-ginv-"));
}

function writeMeta(sessionDir, id, status, extra = {}) {
  const dir = path.join(sessionDir, "subagents", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      subagent_id: id,
      child_session_id: id,
      status,
      subagent_type: "general-purpose",
      description: extra.description || id,
      ...extra,
    }),
  );
}

test("listGrokHomes includes .grok and profile dirs with sessions", () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, ".grok", "sessions"), { recursive: true });
  fs.mkdirSync(path.join(root, ".grok-profiles", "delieta"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, ".grok-profiles", "delieta", "active_sessions.json"),
    "[]",
  );
  fs.mkdirSync(path.join(root, ".grok-profiles", "empty"), { recursive: true });
  const homes = listGrokHomes(root);
  assert.ok(homes.some((h) => h.endsWith(`${path.sep}.grok`)));
  assert.ok(homes.some((h) => h.includes(`${path.sep}delieta`)));
  assert.ok(!homes.some((h) => h.endsWith(`${path.sep}empty`)));
});

test("runningSubagentIds counts only status=running", () => {
  const root = mkTmp();
  const sessionDir = path.join(root, "sess");
  for (let i = 0; i < 25; i++) writeMeta(sessionDir, `run-${i}`, "running");
  for (let i = 0; i < 100; i++) writeMeta(sessionDir, `done-${i}`, "completed");
  writeMeta(sessionDir, "junk", "weird");
  const ids = runningSubagentIds(sessionDir);
  assert.equal(ids.length, 25);
  assert.ok(ids.every((id) => id.startsWith("run-")));
  assert.equal(listSubagentMetas(sessionDir).length, 126);
});

test("findActiveByPid + inventoryForPid resolve profile home", () => {
  const root = mkTmp();
  const home = path.join(root, ".grok-profiles", "delieta");
  const cwd = "/tmp/proj";
  const sid = "sess-abc";
  const pid = 424242;
  fs.mkdirSync(path.join(home, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "active_sessions.json"),
    JSON.stringify([{ pid, cwd, session_id: sid }]),
  );
  const sessionDir = path.join(home, "sessions", encodeURIComponent(cwd), sid);
  writeMeta(sessionDir, "a1", "running");
  writeMeta(sessionDir, "a2", "running");
  writeMeta(sessionDir, "a3", "completed");

  const hit = findActiveByPid(pid, {
    homes: [home],
    alive: () => true,
  });
  assert.ok(hit);
  assert.equal(hit.sessionId, sid);

  const inv = inventoryForPid(pid, {
    homes: [home],
    alive: () => true,
    openBgShellIds: () => ["shell-1"],
  });
  assert.ok(inv);
  assert.equal(inv.source, "grok-meta");
  assert.equal(inv.subagentIds.length, 2);
  assert.deepEqual(inv.shellIds, ["shell-1"]);
});

test("inventoryForPid returns null when pid unknown", () => {
  assert.equal(
    inventoryForPid(999999991, {
      homes: [mkTmp()],
      alive: () => true,
    }),
    null,
  );
});

test("openBgShellIds tracks task_backgrounded until task_completed", () => {
  const root = mkTmp();
  const sessionDir = path.join(root, "sess");
  fs.mkdirSync(sessionDir, { recursive: true });
  const lines = [
    {
      params: {
        update: {
          sessionUpdate: "task_backgrounded",
          taskId: "bg-1",
        },
      },
    },
    {
      params: {
        update: {
          sessionUpdate: "task_backgrounded",
          taskId: "bg-2",
        },
      },
    },
    {
      params: {
        update: {
          sessionUpdate: "task_completed",
          taskId: "bg-1",
        },
      },
    },
    {
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-bg",
          title: "[bg] sleep 999",
          status: "in_progress",
        },
      },
    },
  ];
  fs.writeFileSync(
    path.join(sessionDir, "updates.jsonl"),
    `${lines.map((o) => JSON.stringify(o)).join("\n")}\n`,
  );
  const open = openBgShellIds(sessionDir);
  assert.ok(open.includes("bg-2"));
  assert.ok(open.includes("call-bg"));
  assert.ok(!open.includes("bg-1"));
});

test("corrupt meta soft-fails", () => {
  const root = mkTmp();
  const sessionDir = path.join(root, "sess");
  const bad = path.join(sessionDir, "subagents", "x");
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, "meta.json"), "{not-json");
  writeMeta(sessionDir, "ok", "running");
  assert.deepEqual(runningSubagentIds(sessionDir), ["ok"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SETTLE_DEFAULTS,
  isActiveHookEvent,
  settleIfStale,
} from "../lib/curtain/settle.mjs";

const snap = (o = {}) => {
  const { counts: countOver = {}, ...rest } = o;
  return {
    state: "working",
    hostKind: "synthesis",
    lastActive: 1000,
    since: 900,
    agentAlive: null,
    ...rest,
    counts: {
      subagent: 0,
      watcher: 0,
      bg_shell: 0,
      turn: 0,
      ...countOver,
    },
  };
};

test("SETTLE_DEFAULTS are fleet-safe", () => {
  assert.equal(SETTLE_DEFAULTS.settleSynthQuietSec, 90);
  assert.equal(SETTLE_DEFAULTS.settleSynthLeakSec, 360);
  assert.equal(SETTLE_DEFAULTS.maxWorkingSec, 0);
  assert.equal(SETTLE_DEFAULTS.maxNeedsSec, 0);
});

test("isActiveHookEvent ignores task_complete and synthetic prompts", () => {
  assert.equal(
    isActiveHookEvent({
      event: "Notification",
      notificationType: "task_complete",
    }),
    false,
  );
  assert.equal(
    isActiveHookEvent({ event: "UserPromptSubmit", synthetic: true }),
    false,
  );
  assert.equal(isActiveHookEvent({ event: "UserPromptSubmit" }), true);
  assert.equal(isActiveHookEvent({ event: "Stop" }), true);
  assert.equal(isActiveHookEvent({ event: "PostToolUse" }), true);
  assert.equal(
    isActiveHookEvent({
      event: "Notification",
      notificationType: "idle_prompt",
    }),
    true,
  );
});

test("settleIfStale: synthesis quiet WORKING + all counts 0 → DONE", () => {
  assert.deepEqual(settleIfStale(snap({}), 1090, { settleSynthQuietSec: 90 }), {
    state: "done",
    clearLeases: true,
  });
});

test("settleIfStale: lone watcher does not block quiet settle (informational)", () => {
  // Watcher still live but informational — quiet ≥ 90 → DONE
  assert.deepEqual(
    settleIfStale(snap({ counts: { watcher: 1 }, lastActive: 1000 }), 1400, {
      settleSynthQuietSec: 90,
    }),
    { state: "done", clearLeases: true },
  );
  // Watcher expired (count already 0) + quiet ≥ 90 → DONE (unchanged)
  assert.deepEqual(
    settleIfStale(
      snap({ counts: { watcher: 0 }, lastActive: 1000 }),
      1000 + 901,
      { settleSynthQuietSec: 90 },
    ),
    { state: "done", clearLeases: true },
  );
});

test("settleIfStale: task_complete-hot last_hook would not matter — uses lastActive", () => {
  assert.equal(
    settleIfStale(snap({ lastActive: 1000 }), 1010, {
      settleSynthQuietSec: 90,
    }),
    null,
  );
});

test("settleIfStale: task_list host does not quiet-settle", () => {
  assert.equal(
    settleIfStale(snap({ hostKind: "task_list", lastActive: 1000 }), 2000, {
      settleSynthQuietSec: 90,
      maxWorkingSec: 0,
    }),
    null,
  );
});

test("settleIfStale: hybrid host quiet-settles like synthesis", () => {
  assert.deepEqual(
    settleIfStale(snap({ hostKind: "hybrid", lastActive: 1000 }), 1090, {
      settleSynthQuietSec: 90,
    }),
    { state: "done", clearLeases: true },
  );
});

test("settleIfStale: synthesis leak clears leases after settleSynthLeakSec", () => {
  assert.deepEqual(
    settleIfStale(
      snap({ counts: { subagent: 3 }, lastActive: 1000 }),
      1000 + 180,
      { settleSynthLeakSec: 180 },
    ),
    { state: "done", clearLeases: true },
  );
});

test("settleIfStale: never leak-settles task_list with subagents", () => {
  assert.equal(
    settleIfStale(
      snap({
        hostKind: "task_list",
        counts: { subagent: 2 },
        lastActive: 1000,
      }),
      9999,
      { settleSynthLeakSec: 1 },
    ),
    null,
  );
});

test("settleIfStale: maxWorkingSec can settle task_list WORKING when enabled", () => {
  assert.deepEqual(
    settleIfStale(
      snap({ hostKind: "task_list", lastActive: 1000, since: 1000 }),
      1000 + 3600,
      { maxWorkingSec: 3600 },
    ),
    { state: "done", clearLeases: true },
  );
});

test("settleIfStale: maxNeedsSec off by default", () => {
  assert.equal(
    settleIfStale(
      snap({ state: "needs", lastActive: 1000, since: 1000 }),
      1000 + 99999,
      {},
    ),
    null,
  );
});

test("settleIfStale: maxNeedsSec can clear abandoned NEEDS when enabled", () => {
  assert.deepEqual(
    settleIfStale(
      snap({ state: "needs", lastActive: 1000, since: 1000 }),
      1000 + 3600,
      { maxNeedsSec: 3600 },
    ),
    { state: "done", clearLeases: true },
  );
});

test("settleIfStale: PID backstop forces DONE when agentAlive is false", () => {
  assert.deepEqual(
    settleIfStale(
      snap({
        state: "working",
        counts: { subagent: 2, turn: 1 },
        agentAlive: false,
      }),
      1000,
      {},
    ),
    { state: "done", clearLeases: true },
  );
  // unknown → skip
  assert.equal(
    settleIfStale(
      snap({ agentAlive: null, counts: { subagent: 1 } }),
      1000,
      {},
    ),
    null,
  );
});

test("settleIfStale: lease expiry and quiet are independent (precedence)", () => {
  // Expired subagent already not in counts; quiet 30s < 90 → null
  assert.equal(
    settleIfStale(snap({ counts: { subagent: 0 }, lastActive: 1000 }), 1030, {
      settleSynthQuietSec: 90,
    }),
    null,
  );
  // quiet 91 → DONE
  assert.deepEqual(
    settleIfStale(snap({ counts: { subagent: 0 }, lastActive: 1000 }), 1091, {
      settleSynthQuietSec: 90,
    }),
    { state: "done", clearLeases: true },
  );
});

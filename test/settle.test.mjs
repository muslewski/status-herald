import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SETTLE_DEFAULTS,
  isActiveHookEvent,
  settleIfStale,
} from "../lib/curtain/settle.mjs";

test("SETTLE_DEFAULTS are fleet-safe", () => {
  assert.equal(SETTLE_DEFAULTS.settleSynthQuietSec, 90);
  assert.equal(SETTLE_DEFAULTS.settleSynthLeakSec, 180);
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

test("settleIfStale: synthesis quiet WORKING+subs0 → DONE", () => {
  assert.deepEqual(
    settleIfStale(
      {
        state: "working",
        subs: 0,
        tasksSeen: false,
        lastActive: 1000,
        since: 900,
      },
      1090,
      { settleSynthQuietSec: 90 },
    ),
    { state: "done", clearSubs: false },
  );
});

test("settleIfStale: task_complete-hot last_hook would not matter — uses lastActive", () => {
  // Quiet only 10s on lastActive → no settle even if "hook spam"
  assert.equal(
    settleIfStale(
      {
        state: "working",
        subs: 0,
        tasksSeen: false,
        lastActive: 1000,
        since: 900,
      },
      1010,
      { settleSynthQuietSec: 90 },
    ),
    null,
  );
});

test("settleIfStale: Claude tasks_seen does not quiet-settle", () => {
  assert.equal(
    settleIfStale(
      {
        state: "working",
        subs: 0,
        tasksSeen: true,
        lastActive: 1000,
        since: 900,
      },
      2000,
      { settleSynthQuietSec: 90, maxWorkingSec: 0 },
    ),
    null,
  );
});

test("settleIfStale: synthesis leak clears subs after settleSynthLeakSec", () => {
  assert.deepEqual(
    settleIfStale(
      {
        state: "working",
        subs: 3,
        tasksSeen: false,
        lastActive: 1000,
        since: 900,
      },
      1000 + 180,
      { settleSynthLeakSec: 180 },
    ),
    { state: "done", clearSubs: true },
  );
});

test("settleIfStale: never leak-settles Claude tasks_seen with subs", () => {
  assert.equal(
    settleIfStale(
      {
        state: "working",
        subs: 2,
        tasksSeen: true,
        lastActive: 1000,
        since: 900,
      },
      9999,
      { settleSynthLeakSec: 1 },
    ),
    null,
  );
});

test("settleIfStale: maxWorkingSec can settle Claude WORKING+subs0 when enabled", () => {
  assert.deepEqual(
    settleIfStale(
      {
        state: "working",
        subs: 0,
        tasksSeen: true,
        lastActive: 1000,
        since: 1000,
      },
      1000 + 3600,
      { maxWorkingSec: 3600 },
    ),
    { state: "done", clearSubs: false },
  );
});

test("settleIfStale: maxNeedsSec off by default", () => {
  assert.equal(
    settleIfStale(
      {
        state: "needs",
        subs: 0,
        tasksSeen: false,
        lastActive: 1000,
        since: 1000,
      },
      1000 + 99999,
      {},
    ),
    null,
  );
});

test("settleIfStale: maxNeedsSec can clear abandoned NEEDS when enabled", () => {
  assert.deepEqual(
    settleIfStale(
      {
        state: "needs",
        subs: 0,
        tasksSeen: false,
        lastActive: 1000,
        since: 1000,
      },
      1000 + 3600,
      { maxNeedsSec: 3600 },
    ),
    { state: "done", clearSubs: true },
  );
});

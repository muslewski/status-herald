// Spec §9 combo matrix: herald alone (absent siblings) → empty optional
// segments/lines, zero errors/throws.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readAccountUsage } from "../lib/status/bridge-token-oracle.mjs";
import {
  listProviderHeartbeats,
  listSessionRecords,
  resolveStatusDir,
} from "../lib/status/providers.mjs";
import { readSageFleet } from "../lib/status/sage-bridge.mjs";
import {
  REGISTRY,
  orderSegments,
  renderLine,
} from "../lib/status/segments.mjs";
import { renderCard } from "../lib/surfaces/curtain-card.mjs";

test("absent siblings: empty status dir + sage fail + no token feed → zero throws", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "herald-combo-"));
  const env = { AGENT_STATUS_DIR: empty };
  const dir = resolveStatusDir(env);
  assert.equal(dir, empty);
  assert.deepEqual(listProviderHeartbeats(dir, Date.now()), []);
  assert.deepEqual(listSessionRecords(dir, Date.now()), []);

  const sage = await readSageFleet({
    nowMs: Date.now(),
    cachePath: path.join(empty, "sage-cache.json"),
    execFn: async () => {
      throw new Error("sage not installed");
    },
  });
  assert.equal(sage, null);

  const usage = await readAccountUsage({
    snapshotPath: path.join(empty, "no-forecast.json"),
    now: Date.now() / 1000,
  });
  assert.equal(usage.fiveHour, null);
  assert.equal(usage.weekly, null);

  // Card renders without model/zone when not provided
  const lines = renderCard("working", 5, 60, 10, {
    subagents: 0,
    shells: 0,
    watchers: 0,
  });
  assert.equal(lines.length, 10);
  const esc = String.fromCharCode(27);
  const plain = lines
    .join("\n")
    .split(esc)
    .join("")
    .replace(/\[[0-9;]*m/g, "");
  assert.doesNotMatch(plain, /zone /);
  assert.doesNotMatch(plain, /@high/);

  // Bar segments with sage off + no account data
  const ordered = orderSegments(REGISTRY, {
    sage: { enabled: true, priority: 25 },
    account5h: { enabled: true },
    accountWeekly: { enabled: true },
  });
  const ctx = {
    session: { context: null, sageZone: "" },
    account: { fiveHour: null, weekly: null, caps: {} },
  };
  const items = ordered
    .map((seg) => {
      try {
        return seg.render(ctx);
      } catch (e) {
        assert.fail(`segment ${seg.id} threw: ${e}`);
      }
    })
    .filter(Boolean);
  // No sage/account items without data
  assert.ok(!items.some((i) => i.id === "sage"));
  const line = renderLine(items, { width: 200, mode: "plain" });
  assert.equal(typeof line, "string");

  try {
    fs.rmSync(empty, { recursive: true, force: true });
  } catch {}
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readSageFleet } from "../lib/status/sage-bridge.mjs";

test("readSageFleet returns null on exec failure", async () => {
  const cache = path.join(
    os.tmpdir(),
    `herald-sage-test-fail-${process.pid}.json`,
  );
  try {
    fs.unlinkSync(cache);
  } catch {}
  const out = await readSageFleet({
    nowMs: 1_000_000,
    cachePath: cache,
    execFn: async () => {
      throw new Error("no sage");
    },
  });
  assert.equal(out, null);
});

test("readSageFleet caches within 15s TTL", async () => {
  const cache = path.join(
    os.tmpdir(),
    `herald-sage-test-cache-${process.pid}.json`,
  );
  try {
    fs.unlinkSync(cache);
  } catch {}
  let calls = 0;
  const execFn = async () => {
    calls += 1;
    return JSON.stringify({ sessions: [{ zone: "alpha" }] });
  };
  const a = await readSageFleet({ nowMs: 1_000_000, cachePath: cache, execFn });
  assert.deepEqual(a, { sessions: [{ zone: "alpha" }] });
  assert.equal(calls, 1);
  const b = await readSageFleet({
    nowMs: 1_000_000 + 5_000,
    cachePath: cache,
    execFn,
  });
  assert.deepEqual(b, a);
  assert.equal(calls, 1, "must not re-exec within cache TTL");
  // After TTL
  const c = await readSageFleet({
    nowMs: 1_000_000 + 16_000,
    cachePath: cache,
    execFn,
  });
  assert.deepEqual(c, a);
  assert.equal(calls, 2);
  try {
    fs.unlinkSync(cache);
  } catch {}
});

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bestModelRecord,
  listProviderHeartbeats,
  listSessionRecords,
  readFreshJson,
  resolveStatusDir,
} from "../lib/status/providers.mjs";

const FIX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "agent-status",
);

const NOW = 1784200000000 + 5_000; // 5s after fixture ts → fresh
const EXPIRED = 1784200000000 + 120_000; // past all ttls

test("resolveStatusDir: AGENT_STATUS_DIR wins", () => {
  assert.equal(
    resolveStatusDir({ AGENT_STATUS_DIR: "/custom/status" }),
    "/custom/status",
  );
});

test("resolveStatusDir: XDG_RUNTIME_DIR second", () => {
  assert.equal(
    resolveStatusDir({ XDG_RUNTIME_DIR: "/run/user/1000" }),
    path.join("/run/user/1000", "agent-status"),
  );
});

test("resolveStatusDir: home fallback", () => {
  const d = resolveStatusDir({});
  assert.match(d, /agent-status$/);
  assert.ok(d.includes(".local") || d.includes("state"));
});

test("readFreshJson: fresh fixture ok; expired null; corrupt null", () => {
  const f = path.join(FIX, "providers", "token-oracle.json");
  const ok = readFreshJson(f, NOW);
  assert.equal(ok?.tool, "token-oracle");
  assert.equal(readFreshJson(f, EXPIRED), null);
  assert.equal(
    readFreshJson(path.join(FIX, "sessions", "corrupt.json"), NOW),
    null,
  );
  assert.equal(readFreshJson("/no/such/file.json", NOW), null);
});

test("listProviderHeartbeats returns fresh only", () => {
  const fresh = listProviderHeartbeats(FIX, NOW);
  assert.ok(fresh.some((h) => h.tool === "token-oracle"));
  assert.ok(fresh.some((h) => h.tool === "agentic-sage"));
  assert.deepEqual(listProviderHeartbeats(FIX, EXPIRED), []);
  assert.deepEqual(listProviderHeartbeats("/no/dir", NOW), []);
});

test("listSessionRecords skips corrupt", () => {
  const recs = listSessionRecords(FIX, NOW);
  assert.ok(recs.some((r) => r.session_id === "abc123"));
  assert.ok(recs.some((r) => r.session_id === "def456"));
  assert.ok(!recs.some((r) => !r.schema));
});

test("bestModelRecord: token-oracle beats llm-armory even if armory fresher", () => {
  const recs = listSessionRecords(FIX, NOW);
  const best = bestModelRecord(recs, { sourceCli: "grok", pid: 4321 });
  assert.ok(best);
  assert.equal(best.written_by, "token-oracle");
  assert.equal(best.effort, "high");
});

test("bestModelRecord: armory record with dead pid rejected", () => {
  const armory = {
    schema: 1,
    source_cli: "grok",
    session_id: "dead",
    pid: 999999999,
    model: "grok-4.5",
    effort: "high",
    written_by: "llm-armory",
    updated_at: NOW,
    ttl_ms: 60000,
  };
  assert.equal(bestModelRecord([armory], { sourceCli: "grok" }), null);
});

test("bestModelRecord: soft-fail on garbage", () => {
  assert.equal(bestModelRecord(null, {}), null);
  assert.equal(bestModelRecord([null, "x"], {}), null);
});

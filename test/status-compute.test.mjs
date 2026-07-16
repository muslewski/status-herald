import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// The modules under test (will be created in steps)
import {
  buildPerSessionData,
  computeContext,
  countMessages,
  discoverLiveClaudeSessions,
  fmtTokens,
  getAccountGauges,
  latestUsed,
  modelWindow,
  readLines,
  readSessionMeta,
  shortModelBadge,
} from "../lib/status/compute.mjs";

import {
  contextFromGrokSignals,
  detectGrok,
  discoverLiveGrokSessions,
  grokSessionDir,
  latestGrokMetaTotalTokens,
  readProcStatusPpid,
} from "../lib/status/grok-adapter.mjs";

import {
  feedSnapshot,
  readAccountUsage,
} from "../lib/status/bridge-token-forecast.mjs";

// --- helpers for tests only ---
async function loadFixture(name) {
  const p = path.join("test/fixtures", name);
  if (name.endsWith(".jsonl")) {
    const buf = await fs.readFile(p);
    return buf.toString("utf8").split(/\r?\n/).filter(Boolean);
  }
  const txt = await fs.readFile(p, "utf8");
  return JSON.parse(txt);
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "herald-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ===== Task 1 pure math =====

test("latestUsed walks reversed and sums input+cache tokens", async () => {
  const lines = await loadFixture("transcript-claude-sample.jsonl");
  assert.equal(latestUsed(lines), 400);
});

test("countMessages counts human messages, resets on compact_boundary", async () => {
  const lines = await loadFixture("transcript-claude-sample.jsonl");
  assert.equal(countMessages(lines), 1);
});

test("modelWindow 1M for opus-4 / sonnet-4 / 1m markers else 200k; Grok is 500k", () => {
  assert.equal(modelWindow("claude-opus-4-8"), 1_000_000);
  assert.equal(modelWindow("claude-sonnet-4-5"), 1_000_000);
  assert.equal(modelWindow("something-1m"), 1_000_000);
  assert.equal(modelWindow("claude-3-haiku"), 200_000);
  assert.equal(modelWindow(null), 200_000);
  assert.equal(modelWindow("grok-4"), 500_000);
  assert.equal(modelWindow("xai/grok-code"), 500_000);
});

test("computeContext returns used/win/pct/messages from transcript", async () => {
  const lines = await loadFixture("transcript-claude-sample.jsonl");
  const c = computeContext(lines);
  assert.equal(c.used, 400);
  assert.equal(c.win, 1_000_000);
  assert.equal(c.pct, 0); // small in fixture; other tests use synthetic
  assert.equal(c.messages, 1);
});

test("fmtTokens matches python", () => {
  assert.equal(fmtTokens(2700000), "2.7M");
  assert.equal(fmtTokens(351234), "351k");
  assert.equal(fmtTokens(999), "0k");
});

test("latestUsed / count on synthetic lines with realistic numbers", () => {
  const lines = [
    JSON.stringify({ type: "user", message: { content: "a" }, isMeta: false }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 300000,
          cache_read_input_tokens: 50000,
          cache_creation_input_tokens: 1000,
        },
      },
    }),
    JSON.stringify({ type: "user", message: { content: "b" }, isMeta: false }),
  ];
  assert.equal(latestUsed(lines), 351000);
  assert.equal(countMessages(lines), 2);
  const ctx = computeContext(lines);
  assert.equal(ctx.pct, 35);
  assert.equal(ctx.messages, 2);
});

// ===== Task 2 grok adapter basics (more in later tasks) =====

test("readProcStatusPpid returns a number for self (linux)", () => {
  const pp = readProcStatusPpid(process.pid);
  assert.ok(typeof pp === "number" && pp > 0);
});

test("detectGrok on non-grok pid (init) returns not grok (safe)", () => {
  const g = detectGrok(1);
  assert.equal(g.isGrok, false);
});

test("isGrokProcess on current test pid may be polluted by test cmdline but detect is defensive", () => {
  // The test runner command line can contain "grok" text from aliases; do not assert on process.pid.
  // Just ensure it does not throw and returns a boolean shape.
  const g = detectGrok(process.pid);
  assert.ok(typeof g.isGrok === "boolean");
});

test("contextFromGrokSignals maps tokens + userMessageCount (💬 parity)", () => {
  const c = contextFromGrokSignals({
    contextTokensUsed: 375752,
    contextWindowTokens: 500000,
    contextWindowUsage: 75,
    userMessageCount: 25,
  });
  assert.equal(c.used, 375752);
  assert.equal(c.win, 500_000);
  assert.equal(c.pct, 75);
  assert.equal(c.messages, 25);
});

test("contextFromGrokSignals defaults to 500k window and zero messages", () => {
  const c = contextFromGrokSignals({});
  assert.equal(c.win, 500_000);
  assert.equal(c.used, 0);
  assert.equal(c.messages, 0);
  assert.equal(c.pct, 0);
});

test("contextFromGrokSignals prefers live _meta.totalTokens over stale signals", () => {
  // Bug: mid-turn signals stays at 103969/20% while CLI shows ~128k/25%.
  const c = contextFromGrokSignals(
    {
      contextTokensUsed: 103969,
      contextWindowTokens: 500000,
      contextWindowUsage: 20, // stale — must not be trusted when live is higher
      userMessageCount: 26,
    },
    128966,
  );
  assert.equal(c.used, 128966);
  assert.equal(c.pct, 25); // floor(128966*100/500000)
  assert.equal(c.messages, 26);
  assert.equal(c.win, 500_000);
});

test("contextFromGrokSignals does not regress below signals when live is lower", () => {
  const c = contextFromGrokSignals(
    {
      contextTokensUsed: 200000,
      contextWindowTokens: 500000,
      userMessageCount: 3,
    },
    150000,
  );
  assert.equal(c.used, 200000);
  assert.equal(c.pct, 40);
});

test("latestGrokMetaTotalTokens reads _meta only, ignores cumulative usage", async () => {
  await withTempDir(async (dir) => {
    // Cumulative API usage must NOT win over live context meta.
    const lines = [
      JSON.stringify({
        params: {
          _meta: { totalTokens: 90000 },
          update: { sessionUpdate: "tool_call" },
        },
      }),
      JSON.stringify({
        params: {
          update: {
            sessionUpdate: "turn_completed",
            usage: { totalTokens: 1895396, inputTokens: 1800000 },
          },
        },
      }),
      JSON.stringify({
        params: {
          _meta: { totalTokens: 128966 },
          update: { sessionUpdate: "tool_call_update" },
        },
      }),
    ];
    await fs.writeFile(
      path.join(dir, "updates.jsonl"),
      `${lines.join("\n")}\n`,
    );
    assert.equal(latestGrokMetaTotalTokens(dir), 128966);
  });
});

test("discoverLiveGrokSessions prefers live updates totalTokens over stale signals", async () => {
  await withTempDir(async (dir) => {
    const cwd = "/tmp/herald-grok-fixture";
    const sid = "sess-grok-1";
    const sessDir = grokSessionDir(sid, cwd, dir);
    await fs.mkdir(sessDir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "active_sessions.json"),
      JSON.stringify([
        { session_id: sid, pid: process.pid, cwd },
        { session_id: "dead", pid: 999999999, cwd: "/x" },
      ]),
    );
    await fs.writeFile(
      path.join(sessDir, "signals.json"),
      JSON.stringify({
        contextTokensUsed: 100000, // stale
        contextWindowTokens: 500000,
        contextWindowUsage: 20,
        userMessageCount: 7,
        primaryModelId: "grok-4.5",
      }),
    );
    await fs.writeFile(
      path.join(sessDir, "updates.jsonl"),
      `${JSON.stringify({ params: { _meta: { totalTokens: 150000 } } })}\n`,
    );
    await fs.writeFile(
      path.join(sessDir, "summary.json"),
      JSON.stringify({
        current_model_id: "grok-4.5",
        reasoning_effort: "high",
      }),
    );
    const found = discoverLiveGrokSessions({
      grokHome: dir,
      alive: (pid) => pid === process.pid,
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].sessionId, sid);
    assert.equal(found[0].isGrok, true);
    assert.equal(found[0].context.messages, 7);
    assert.equal(found[0].context.used, 150000); // live wins
    assert.equal(found[0].context.pct, 30);
    assert.equal(found[0].context.win, 500_000);
    assert.equal(found[0].messages, 7);
    assert.match(found[0].modelBadge, /Grok/);
  });
});

// ===== Task 3 sidecar + badge =====

test("readSessionMeta returns {} for missing", async () => {
  const m = await readSessionMeta("no-such-sid");
  assert.deepEqual(m, {});
});

test("shortModelBadge reproduces python families + effort glyph", () => {
  assert.equal(
    shortModelBadge("Opus 4.8 (1M context)", "xhigh"),
    "Opus 🧠xhigh",
  );
  assert.equal(shortModelBadge("claude-sonnet-4-5", ""), "Sonnet");
  assert.equal(shortModelBadge("Fable 5", "high"), "Fable 🧠high");
  assert.equal(shortModelBadge("", ""), "");
  assert.equal(shortModelBadge("Grok build", "xhigh"), "Grok 🧠xhigh");
});

// ===== Task 4 bridge (read + feed) =====

test("readAccountUsage from fixture snapshot", async () => {
  // Hermetic: pin now before fixture resets_at so wall-clock cannot stale the windows
  const u = await readAccountUsage({
    snapshotPath: "test/fixtures/token-forecast-snapshot.json",
    now: 1783950000,
  });
  assert.ok(u.fiveHour);
  assert.equal(u.fiveHour.usedPercentage, 12.3);
  assert.equal(u.fiveHour.stale, false);
  assert.ok(u.weekly);
  assert.equal(u.weekly.usedPercentage, 45.0);
  assert.equal(u.weekly.stale, false);
  // caps come from defaults or limits when present
  assert.ok(u.caps && u.caps.fiveHourCap > 0);
});

test("readAccountUsage respects injectable now for secsToReset", async () => {
  const now = 1783950000;
  const u = await readAccountUsage({
    snapshotPath: "test/fixtures/token-forecast-snapshot.json",
    now,
  });
  // five_hour resets_at 1784000000 → 50000s remaining at pinned now
  assert.equal(u.fiveHour.resetsAt, 1784000000);
  assert.equal(u.fiveHour.secsToReset, 1784000000 - now);
  assert.equal(u.weekly.resetsAt, 1785000000);
  assert.equal(u.weekly.secsToReset, 1785000000 - now);
});

test("feedSnapshot is best-effort and does not throw", async () => {
  await assert.doesNotReject(async () => {
    await feedSnapshot(
      { rate_limits: { five_hour: { used_percentage: 10, resets_at: 123 } } },
      { command: "" },
    );
  });
});

// ===== Task 5 discovery + facade (red skeleton) =====

test("discoverLiveClaudeSessions with fixture dir returns matching live sessions", async () => {
  await withTempDir(async (tmp) => {
    const sessDir = path.join(tmp, "sessions");
    await fs.mkdir(sessDir);
    await fs.copyFile(
      "test/fixtures/session-sample.json",
      path.join(sessDir, "test-sid-1234.json"),
    );
    // pid 999999 is not alive; expect filtered
    const found = await discoverLiveClaudeSessions({ sessionsDir: sessDir });
    assert.equal(found.length, 0);
  });
});

test("discoverLiveClaudeSessions attaches ppid for live pid", async () => {
  await withTempDir(async (tmp) => {
    const sessDir = path.join(tmp, "sessions");
    await fs.mkdir(sessDir);
    const expectedPpid = readProcStatusPpid(process.pid);
    const session = {
      pid: process.pid,
      sessionId: "live-sid-ppid",
      cwd: "/tmp",
      name: "Live",
      status: "busy",
      statusUpdatedAt: 1783950000000,
    };
    await fs.writeFile(
      path.join(sessDir, "live-sid-ppid.json"),
      JSON.stringify(session),
    );
    const found = await discoverLiveClaudeSessions({ sessionsDir: sessDir });
    assert.equal(found.length, 1);
    assert.equal(found[0].pid, process.pid);
    assert.equal(found[0].sessionId, "live-sid-ppid");
    assert.equal(found[0].ppid, expectedPpid);
    assert.ok(typeof found[0].ppid === "number" && found[0].ppid > 0);
  });
});

test("buildPerSessionData + grok path returns degraded but valid shape", async () => {
  const data = await buildPerSessionData("missing-sid", process.pid);
  assert.ok(data);
  assert.ok("context" in data);
  assert.ok(typeof data.modelBadge === "string");
});

test("buildPerSessionData with injectable dirs loads transcript + meta", async () => {
  await withTempDir(async (tmp) => {
    const sessionId = "test-sid-1234";
    const projectsDir = path.join(tmp, "projects");
    const metaDir = path.join(tmp, "session-meta");
    // projects/<encoded-cwd>/<sessionId>.jsonl — walk finds by filename
    const projLeaf = path.join(projectsDir, "-tmp-testrepo");
    await fs.mkdir(projLeaf, { recursive: true });
    await fs.mkdir(metaDir, { recursive: true });
    await fs.copyFile(
      "test/fixtures/transcript-claude-sample.jsonl",
      path.join(projLeaf, `${sessionId}.jsonl`),
    );
    await fs.copyFile(
      "test/fixtures/session-meta-test-sid-1234.json",
      path.join(metaDir, `${sessionId}.json`),
    );

    const data = await buildPerSessionData(sessionId, null, {
      projectsDir,
      metaDir,
    });
    assert.equal(data.sessionId, sessionId);
    // transcript: latestUsed=400, messages after compact=1, opus window 1M
    assert.equal(data.context.used, 400);
    assert.equal(data.context.messages, 1);
    assert.equal(data.messages, 1);
    // meta fixture: Opus 4.8 + effort xhigh
    assert.equal(data.modelBadge, "Opus 🧠xhigh");
  });
});

test("discoverLiveGrokSessions: armed WORKING → working status (▶ glyph path)", async () => {
  await withTempDir(async (dir) => {
    const cwd = "/tmp/herald-glyph";
    const sid = "glyph-1";
    const sessDir = grokSessionDir(sid, cwd, dir);
    await fs.mkdir(sessDir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "active_sessions.json"),
      JSON.stringify([{ session_id: sid, pid: process.pid, cwd }]),
    );
    await fs.writeFile(
      path.join(sessDir, "signals.json"),
      JSON.stringify({ contextTokensUsed: 1, contextWindowTokens: 500000 }),
    );
    const found = discoverLiveGrokSessions({
      grokHome: dir,
      alive: (pid) => pid === process.pid,
      getSessOpt: (name, k) => {
        if (k === "@herald_armed") return "1";
        if (k === "@herald_state") return "working";
        return "";
      },
      sessionNameFor: () => "s1",
    });
    assert.equal(found[0].status, "working");
    assert.notEqual(found[0].status, "busy");
  });
});

test("discoverLiveGrokSessions: armed DONE → idle; unarmed → unknown", async () => {
  await withTempDir(async (dir) => {
    const cwd = "/tmp/herald-glyph2";
    const sid = "glyph-2";
    const sessDir = grokSessionDir(sid, cwd, dir);
    await fs.mkdir(sessDir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "active_sessions.json"),
      JSON.stringify([{ session_id: sid, pid: process.pid, cwd }]),
    );
    await fs.writeFile(
      path.join(sessDir, "signals.json"),
      JSON.stringify({ contextTokensUsed: 1, contextWindowTokens: 500000 }),
    );
    const done = discoverLiveGrokSessions({
      grokHome: dir,
      alive: (pid) => pid === process.pid,
      getSessOpt: (_n, k) =>
        k === "@herald_armed" ? "1" : k === "@herald_state" ? "done" : "",
      sessionNameFor: () => "s1",
    });
    assert.equal(done[0].status, "idle");
    const unarmed = discoverLiveGrokSessions({
      grokHome: dir,
      alive: (pid) => pid === process.pid,
      getSessOpt: () => "",
      sessionNameFor: () => "s1",
    });
    assert.equal(unarmed[0].status, "unknown");
  });
});

test("stateGlyph maps working/idle/needs/unknown (no busy from grok path)", async () => {
  const { stateGlyph } = await import("../lib/status/side-effects.mjs");
  assert.equal(stateGlyph("working"), "▶");
  assert.equal(stateGlyph("idle"), "⏸");
  assert.equal(stateGlyph("needs"), "⚠");
  assert.equal(stateGlyph("unknown"), "·");
});

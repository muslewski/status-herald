import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatDoctorReport,
  runDoctor,
} from "../lib/curtain/doctor.mjs";
import { applySettle } from "../lib/curtain/session.mjs";

const makeT = (init = {}) => {
  const S = init;
  return {
    _S: S,
    getSessOpt: (s, k) => S[s]?.opts?.[k] ?? "",
    setSessOpt: (s, k, v) => {
      S[s] ??= { opts: {}, active: "@live", windows: {} };
      S[s].opts[k] = String(v);
    },
    listArmed: () =>
      Object.entries(S)
        .filter(([, v]) => v.opts?.["@herald_armed"] === "1")
        .map(([name]) => ({ name })),
    activeWindowId: () => "@live",
    newCardWindow: () => {},
    killWindow: () => {},
    windowNameOf: () => "live",
    selectWindow: () => {},
    unsetSessOpt: (s, k) => {
      delete S[s]?.opts?.[k];
    },
  };
};

/** Stub wiring: inject via settingsPaths pointing at temp files is heavy;
 *  we exercise check shape with real disk for card-loop and soft hooks. */

test("runDoctor: card-loop-bin hard check green on this checkout", () => {
  const { checks, ok } = runDoctor({
    tmuxOk: true,
    inTmux: true,
    env: { AGENT_STATUS_DIR: "/tmp/no-such-agent-status" },
    t: makeT(),
    nowSec: 1000,
    bars: { tmux: {}, claude: {} },
    // Avoid real home hooks affecting hooks-wired hard fail in isolation
    settingsPaths: {
      claude: "/tmp/herald-doctor-no-claude-settings",
      grok: "/tmp/herald-doctor-no-grok-hooks",
    },
  });
  const card = checks.find((c) => c.name === "card-loop-bin");
  assert.ok(card);
  assert.equal(card.ok, true);
  assert.equal(card.hard, true);
  // hooks-wired fails (no host) so overall ok false — expected
  assert.equal(typeof ok, "boolean");
});

test("runDoctor: covered session without settle_ts fails hard (RC3)", () => {
  const t = makeT({
    s1: {
      opts: {
        "@herald_armed": "1",
        "@herald_covered": "1",
        "@herald_state": "working",
        "@herald_leases": "",
      },
    },
  });
  const { checks, ok } = runDoctor({
    t,
    tmuxOk: true,
    inTmux: true,
    nowSec: 5000,
    env: {},
    bars: { tmux: {}, claude: {} },
    settingsPaths: {
      claude: "/tmp/herald-doctor-no-claude-settings",
      grok: "/tmp/herald-doctor-no-grok-hooks",
    },
  });
  const st = checks.find((c) => c.name === "session:s1:settle_ts");
  assert.ok(st);
  assert.equal(st.ok, false);
  assert.equal(st.hard, true);
  assert.ok(st.fixHint, "RC3 failure must carry a fix hint");
  assert.match(st.fixHint, /refresh|arm/);
  assert.equal(ok, false);
});

test("runDoctor: fresh settle_ts on covered session passes that check", () => {
  const t = makeT({
    s1: {
      opts: {
        "@herald_armed": "1",
        "@herald_covered": "1",
        "@herald_state": "working",
        "@herald_leases": "",
        "@herald_settle_ts": "4950",
      },
    },
  });
  const { checks } = runDoctor({
    t,
    tmuxOk: true,
    inTmux: true,
    nowSec: 5000,
    env: {},
    bars: { tmux: {}, claude: {} },
    settingsPaths: {
      claude: "/tmp/herald-doctor-no-claude-settings",
      grok: "/tmp/herald-doctor-no-grok-hooks",
    },
  });
  const st = checks.find((c) => c.name === "session:s1:settle_ts");
  assert.equal(st.ok, true);
  assert.equal(st.fixHint, "");
});

test("applySettle stamps @herald_settle_ts even when no state change", () => {
  const t = makeT({
    s1: {
      opts: {
        "@herald_armed": "1",
        "@herald_state": "working",
        "@herald_leases": "",
        "@herald_host_kind": "task_list",
        "@herald_last_active": "1000",
        "@herald_since": "900",
      },
    },
  });
  applySettle("s1", 1000, t, { settle: { settleSynthQuietSec: 90 } });
  assert.equal(t.getSessOpt("s1", "@herald_settle_ts"), "1000");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
});

test("runDoctor: agent-status is soft informational", () => {
  const { checks } = runDoctor({
    tmuxOk: true,
    inTmux: false,
    env: { AGENT_STATUS_DIR: "/tmp/empty-as-dir" },
    t: makeT(),
    nowSec: 1,
    bars: { tmux: {}, claude: {} },
    settingsPaths: {
      claude: "/tmp/herald-doctor-no-claude-settings",
      grok: "/tmp/herald-doctor-no-grok-hooks",
    },
  });
  const a = checks.find((c) => c.name === "agent-status");
  assert.ok(a);
  assert.equal(a.hard, false);
  assert.equal(a.ok, true);
});

test("runDoctor: every failure has a fixHint; passes have empty fixHint", () => {
  const t = makeT({
    s1: {
      opts: {
        "@herald_armed": "1",
        "@herald_covered": "1",
        "@herald_state": "working",
        "@herald_leases": "",
      },
    },
  });
  const { checks } = runDoctor({
    t,
    tmuxOk: false,
    inTmux: false,
    nowSec: 100,
    env: {},
    bars: null,
    settingsPaths: {
      claude: "/tmp/herald-doctor-no-claude-settings",
      grok: "/tmp/herald-doctor-no-grok-hooks",
    },
  });
  for (const c of checks) {
    if (c.ok) assert.equal(c.fixHint, "", c.name);
    else assert.ok(c.fixHint.length > 0, `missing fixHint on ${c.name}`);
  }
  const wired = checks.find((c) => c.name === "hooks-wired");
  assert.ok(wired);
  assert.equal(wired.ok, false);
  assert.equal(wired.hard, true);
  const tmux = checks.find((c) => c.name === "tmux");
  assert.equal(tmux.ok, false);
  assert.match(tmux.fixHint, /tmux/i);
});

test("runDoctor: ok true only when no hard failures", () => {
  // Force green path with injected hooks via fake inspect — we can't easily
  // mock inspectWiring; instead assert that with tmux+card-loop green and
  // no covered sessions, hard fails are only hooks-wired when paths absent.
  const { checks, ok } = runDoctor({
    tmuxOk: true,
    inTmux: true,
    t: makeT(),
    nowSec: 1,
    env: {},
    bars: { tmux: {}, claude: {} },
    settingsPaths: {
      claude: "/tmp/herald-doctor-no-claude-settings",
      grok: "/tmp/herald-doctor-no-grok-hooks",
    },
  });
  const hardFails = checks.filter((c) => c.hard && !c.ok);
  assert.equal(ok, hardFails.length === 0);
  assert.ok(hardFails.some((c) => c.name === "hooks-wired"));
});

test("formatDoctorReport: banner + fix-hint under failures + exit narrative", () => {
  const report = formatDoctorReport({
    ok: false,
    passed: 2,
    total: 4,
    checks: [
      {
        name: "tmux",
        ok: true,
        hard: true,
        detail: "tmux reachable",
        fixHint: "",
      },
      {
        name: "hooks-wired",
        ok: false,
        hard: true,
        detail: "no herald hooks wired",
        fixHint: "herald curtain install",
      },
      {
        name: "session:s1:settle_ts",
        ok: false,
        hard: true,
        detail: "no settle stamp",
        fixHint: "herald curtain refresh",
      },
      {
        name: "agent-status",
        ok: true,
        hard: false,
        detail: "informational",
        fixHint: "",
      },
    ],
  });
  assert.match(report, /╔ doctor · 2\/4/);
  assert.match(report, /50%/);
  assert.match(report, /✓ tmux/);
  assert.match(report, /✗ hooks-wired/);
  assert.match(report, /→ herald curtain install/);
  assert.match(report, /→ herald curtain refresh/);
  assert.match(report, /next: fix/);
  // fix hints only under failures
  const lines = report.split("\n");
  const agentIdx = lines.findIndex((l) => l.includes("agent-status"));
  assert.ok(agentIdx >= 0);
  assert.ok(!lines[agentIdx + 1]?.includes("→"));
});

test("formatDoctorReport: all green has no next line", () => {
  const report = formatDoctorReport({
    ok: true,
    passed: 2,
    total: 2,
    checks: [
      { name: "a", ok: true, hard: true, detail: "ok", fixHint: "" },
      { name: "b", ok: true, hard: false, detail: "ok", fixHint: "" },
    ],
  });
  assert.match(report, /2\/2/);
  assert.doesNotMatch(report, /next:/);
});


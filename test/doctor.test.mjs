import assert from "node:assert/strict";
import { test } from "node:test";
import { runDoctor } from "../lib/curtain/doctor.mjs";
import { applySettle, arm } from "../lib/curtain/session.mjs";

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

test("runDoctor: card-loop-bin hard check green on this checkout", () => {
  const { checks, ok } = runDoctor({
    tmuxOk: true,
    env: { AGENT_STATUS_DIR: "/tmp/no-such-agent-status" },
    t: makeT(),
    nowSec: 1000,
  });
  const card = checks.find((c) => c.name === "card-loop-bin");
  assert.ok(card);
  assert.equal(card.ok, true);
  assert.equal(card.hard, true);
  assert.equal(ok, true);
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
    nowSec: 5000,
    env: {},
  });
  const st = checks.find((c) => c.name === "session:s1:settle_ts");
  assert.ok(st);
  assert.equal(st.ok, false);
  assert.equal(st.hard, true);
  assert.equal(ok, false);
});

test("runDoctor: fresh settle_ts on covered session passes", () => {
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
  const { checks, ok } = runDoctor({
    t,
    tmuxOk: true,
    nowSec: 5000,
    env: {},
  });
  const st = checks.find((c) => c.name === "session:s1:settle_ts");
  assert.equal(st.ok, true);
  assert.equal(ok, true);
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
    env: { AGENT_STATUS_DIR: "/tmp/empty-as-dir" },
    t: makeT(),
    nowSec: 1,
  });
  const a = checks.find((c) => c.name === "agent-status");
  assert.ok(a);
  assert.equal(a.hard, false);
  assert.equal(a.ok, true);
});

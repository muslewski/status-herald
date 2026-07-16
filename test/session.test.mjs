import assert from "node:assert/strict";
import { test } from "node:test";
import { countLive, parseLeases } from "../lib/curtain/lease.mjs";
import {
  TITLE_FMT,
  applySettle,
  applyWash,
  arm,
  armAll,
  armIfMatch,
  cover,
  disarm,
  focus,
  refreshCards,
  reveal,
  revealAll,
  shouldSettleSynthSubagentStop,
  stampFromHook,
  stampSession,
} from "../lib/curtain/session.mjs";
import { settleIfStale } from "../lib/curtain/settle.mjs";

/** Live lease counts at nowSec (default far-future so tests see granted leases). */
const liveAt = (t, nowSec = 0, sess = "s1") =>
  countLive(parseLeases(t.getSessOpt(sess, "@herald_leases")), nowSec);

// In-memory tmux double. Sessions: { [name]: { opts:{}, active:winId, windows:{winId:name} } }
const makeT = (init = {}) => {
  const S = init;
  return {
    _S: S,
    getSessOpt: (s, k) => S[s]?.opts?.[k] ?? "",
    setSessOpt: (s, k, v) => {
      S[s] ??= { opts: {}, active: "@live", windows: {} };
      S[s].opts[k] = String(v);
    },
    unsetSessOpt: (s, k) => {
      delete S[s]?.opts?.[k];
    },
    activeWindowId: (s) => S[s]?.active ?? "",
    selectWindow: (target) => {
      // target is either "sess:_curtain" or a window id "@live"
      if (target.includes(":")) {
        const [s] = target.split(":");
        S[s].active = "@curtain";
      } else {
        for (const s of Object.keys(S))
          if (S[s].windows?.[target] !== undefined) S[s].active = target;
      }
    },
    newCardWindow: (s, name, _loop) => {
      S[s] ??= { opts: {}, active: "@live", windows: {} };
      S[s].windows["@curtain"] = name;
    },
    killWindow: () => {},
    windowNameOf: (winId) => {
      for (const s of Object.keys(S))
        if (S[s].windows?.[winId] !== undefined) return S[s].windows[winId];
      return "";
    },
    listArmed: () =>
      Object.entries(S)
        .filter(([, v]) => v.opts?.["@herald_armed"] === "1")
        .map(([name, v]) => ({
          name,
          liveWin: v.opts?.["@herald_live_win"] || "",
        })),
    // Batched readers used by focus()'s fast path: one snapshot of armed
    // sessions, one id->name map of every window.
    snapshotArmed: () =>
      Object.entries(S)
        .filter(([, v]) => v.opts?.["@herald_armed"] === "1")
        .map(([name, v]) => ({
          name,
          covered: v.opts?.["@herald_covered"] === "1",
          state: v.opts?.["@herald_state"] || "",
          liveWin: v.opts?.["@herald_live_win"] || "",
          activeWin: v.active ?? "",
        })),
    windowNames: () => {
      const m = {};
      for (const s of Object.keys(S))
        for (const [id, name] of Object.entries(S[s].windows || {}))
          m[id] = name;
      return m;
    },
  };
};

const freshSession = () => ({
  s1: { opts: {}, active: "@live", windows: { "@live": "Syndcast Backlog" } },
});

test("arm marks the session, records live window, creates the card window", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_armed"), "1");
  assert.equal(t.getSessOpt("s1", "@herald_live_win"), "@live");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "idle");
  assert.equal(t._S.s1.windows["@curtain"], "_curtain");
});

test("arm is idempotent", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t._S.s1.opts["@herald_live_win"] = "@sentinel"; // must NOT be overwritten
  arm("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_live_win"), "@sentinel");
});

test("cover switches to the card window only when state is coverable", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  cover("s1", t); // state idle -> no cover
  assert.equal(t._S.s1.active, "@live");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "0");
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t);
  assert.equal(t._S.s1.active, "@curtain");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
});

test("cover covers compacting state", () => {
  // Inject cfg so this does not depend on the operator's real config.json
  // (which may still list only the pre-r002 three coverable states).
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "compacting");
  cover("s1", t, {});
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
});

test("coverableStates config can exclude done", () => {
  const t = makeT(freshSession());
  const cfg = { coverableStates: ["working", "needs", "compacting"] };
  arm("s1", t, cfg);
  t.setSessOpt("s1", "@herald_state", "done");
  cover("s1", t, cfg);
  assert.equal(
    t.getSessOpt("s1", "@herald_covered"),
    "0",
    "done not coverable",
  );
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t, cfg);
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
});

test("reveal restores the remembered live window", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t);
  reveal("s1", t);
  assert.equal(t._S.s1.active, "@live");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "0");
});

test("cover is a no-op when already covered (live window not lost)", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t);
  cover("s1", t); // second cover must not overwrite @herald_live_win with @curtain
  assert.equal(t.getSessOpt("s1", "@herald_live_win"), "@live");
});

test("cover never captures the card window as live_win (desync self-heal)", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t); // active=@curtain, covered=1, live_win=@live
  // Force the desync: covered flag reset while still parked on the card.
  t.setSessOpt("s1", "@herald_covered", "0");
  assert.equal(t._S.s1.active, "@curtain");
  cover("s1", t);
  assert.equal(
    t.getSessOpt("s1", "@herald_live_win"),
    "@live",
    "card window must never be captured as live_win",
  );
});

test("disarm reveals the live window before killing the card", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t);
  disarm("s1", t);
  assert.equal(t._S.s1.active, "@live");
  assert.equal(t.getSessOpt("s1", "@herald_armed"), "0");
});

test("arm pins the terminal title to the live window, not the card", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  assert.equal(t.getSessOpt("s1", "set-titles"), "on");
  const fmt = t.getSessOpt("s1", "set-titles-string");
  // When the card is active the format must resolve the live window's name,
  // otherwise a focused covered tab reports "_curtain" and focus() covers it.
  assert.equal(fmt, TITLE_FMT);
  assert.match(fmt, /@herald_live_win/);
  assert.match(fmt, /_curtain/);
});

test("disarm drops the session-local title overrides", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  disarm("s1", t);
  assert.equal(t.getSessOpt("s1", "set-titles-string"), "");
  assert.equal(t.getSessOpt("s1", "set-titles"), "");
});

test("revealAll reveals every covered armed session", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "done");
  cover("s1", t);
  revealAll(t);
  assert.equal(t._S.s1.active, "@live");
});

const twoArmed = () => ({
  s1: {
    opts: {
      "@herald_armed": "1",
      "@herald_live_win": "@w1",
      "@herald_state": "working",
      "@herald_covered": "0",
    },
    active: "@w1",
    windows: { "@w1": "Syndcast Backlog", "@curtain": "_curtain" },
  },
  s2: {
    opts: {
      "@herald_armed": "1",
      "@herald_live_win": "@w2",
      "@herald_state": "working",
      "@herald_covered": "0",
    },
    active: "@w2",
    windows: { "@w2": "Sage Run", "@curtain": "_curtain" },
  },
});

test("focus reveals the matching title and covers the rest", () => {
  const t = makeT(twoArmed());
  // start both covered so we can observe the reveal of the match
  cover("s1", t);
  cover("s2", t);
  focus("Syndcast Backlog", t);
  assert.equal(t._S.s1.active, "@w1", "matched session revealed");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "0");
  assert.equal(t._S.s2.active, "@curtain", "other session stays covered");
  assert.equal(t.getSessOpt("s2", "@herald_covered"), "1");
});

test("focus batches its reads: one snapshot + one window map, no per-session lookups", () => {
  const t = makeT(twoArmed());
  let snap = 0;
  let names = 0;
  let perName = 0;
  const s0 = t.snapshotArmed;
  const n0 = t.windowNames;
  const w0 = t.windowNameOf;
  t.snapshotArmed = () => {
    snap++;
    return s0();
  };
  t.windowNames = () => {
    names++;
    return n0();
  };
  t.windowNameOf = (id) => {
    perName++;
    return w0(id);
  };
  focus("Syndcast Backlog", t);
  assert.equal(snap, 1, "exactly one batched session snapshot");
  assert.equal(names, 1, "exactly one window-name map");
  assert.equal(
    perName,
    0,
    "no per-session windowNameOf calls in the fast path",
  );
  // and it still did the right thing
  assert.equal(t._S.s1.active, "@w1", "matched session revealed");
  assert.equal(t.getSessOpt("s2", "@herald_covered"), "1", "other covered");
});

test("focus with an empty title covers all coverable sessions", () => {
  const t = makeT(twoArmed());
  focus("", t);
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
  assert.equal(t.getSessOpt("s2", "@herald_covered"), "1");
});

test("focus never covers an idle session", () => {
  const t = makeT(twoArmed());
  t.setSessOpt("s2", "@herald_state", "idle");
  focus("Syndcast Backlog", t);
  assert.equal(t.getSessOpt("s2", "@herald_covered"), "0", "idle stays live");
});

test("stampSession sets session state and since on working", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampSession("%9", "working", 1000, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.equal(t.getSessOpt("s1", "@herald_since"), "1000");
  stampSession("%9", "done", 2000, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(
    t.getSessOpt("s1", "@herald_since"),
    "1000",
    "since unchanged off working",
  );
});

test("stampFromHook keeps a session WORKING when Stop leaves subagents running", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const ev = (o) => ({
    event: "Stop",
    agentId: "",
    notificationType: "",
    hasTasks: true,
    subagents: 0,
    shells: 0,
    subagentIds: [],
    ...o,
  });
  stampFromHook(
    "%9",
    ev({ event: "UserPromptSubmit", hasTasks: false }),
    1000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.equal(t.getSessOpt("s1", "@herald_since"), "1000");

  stampFromHook("%9", ev({ subagents: 2, subagentIds: ["a", "b"] }), 2000, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working", "not done yet");
  assert.equal(liveAt(t).subagent, 2);
  assert.equal(
    t.getSessOpt("s1", "@herald_since"),
    "1000",
    "a resumed turn keeps counting from the prompt",
  );
});

test("stampFromHook reports DONE with background shells still running", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    { event: "Stop", hasTasks: true, subagents: 0, shells: 1 },
    2000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(liveAt(t).bg_shell, 1);
});

test("stampFromHook leaves the counts alone for events without background_tasks (non start/stop)", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 2,
      shells: 0,
      subagentIds: ["a", "b"],
    },
    1000,
    t,
  );
  // A Notification (or Stop) without hasTasks must not overwrite stored counts.
  // (SubagentStart/Stop now correctly synthesize +1/-1.)
  stampFromHook(
    "%9",
    {
      event: "Notification",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      notificationType: "idle_prompt",
    },
    1001,
    t,
  );
  assert.equal(liveAt(t).subagent, 2);
});

test("stampFromHook: idle_prompt cannot call a subagent turn done", () => {
  // The eventizer bug, replayed from its real 2026-07-09 timeline. Stop at
  // 20:07:22 carried three running subagents; idle_prompt at 20:08:22 carried
  // no background_tasks at all, and used to overwrite WORKING with DONE while
  // all three were still running. It must read the stored counts instead.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 3,
      shells: 0,
      subagentIds: ["a", "b", "c"],
    },
    1000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");

  const idle = {
    event: "Notification",
    notificationType: "idle_prompt",
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
  };
  stampFromHook("%9", idle, 1060, t);
  assert.equal(
    t.getSessOpt("s1", "@herald_state"),
    "working",
    "three subagents are still running",
  );
  assert.equal(liveAt(t).subagent, 3);

  // The last SubagentStop drains the count; only then does idle mean idle.
  stampFromHook(
    "%9",
    { event: "SubagentStop", hasTasks: true, subagents: 0, shells: 0 },
    1100,
    t,
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_state"),
    "working",
    "still not done",
  );
  stampFromHook("%9", idle, 1160, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("id-set: same-id SubagentStarts are idempotent, distinct ones stack", () => {
  // A counter would double-count a re-delivered SubagentStart; a set will not.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const start = (id) => ({
    event: "SubagentStart",
    agentId: id,
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
  });
  stampFromHook("%9", start("a1"), 1000, t);
  stampFromHook("%9", start("a1"), 1001, t); // duplicate delivery
  assert.equal(liveAt(t).subagent, 1, "dedup by id");
  stampFromHook("%9", start("a2"), 1002, t);
  assert.equal(liveAt(t).subagent, 2);
});

test("id-set: a Stop task list reconciles a leaked synthesized count", () => {
  // Grok-style: two SubagentStarts synthesize a count of 2, but their Stops are
  // dropped. A later Grok Stop (no task list) must overwrite the leak via RC1.
  // Claude Stop with empty background_tasks is intentionally NOT trusted to wipe.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const start = (id) => ({
    event: "SubagentStart",
    agentId: id,
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
  });
  stampFromHook("%9", start("g1"), 1000, t);
  stampFromHook("%9", start("g2"), 1001, t);
  assert.equal(liveAt(t).subagent, 2, "leaked to 2");
  // Grok Stop (hasTasks false) reconciles synth subagents to empty:
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    2000,
    t,
  );
  assert.equal(liveAt(t).subagent, 0, "reconciled");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("Grok Stop without task list reconciles synth subagents to empty → DONE", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const start = (id) => ({
    event: "SubagentStart",
    agentId: id,
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
  });
  stampFromHook("%9", start("g1"), 1000, t);
  stampFromHook("%9", start("g2"), 1001, t);
  assert.equal(liveAt(t, 1001).subagent, 2);
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    2000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(liveAt(t, 2000).subagent, 0);
});

test("Grok: last SubagentStop with zero synth ids settles to DONE (no idle_prompt)", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const start = (id) => ({
    event: "SubagentStart",
    agentId: id,
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
  });
  const stopSub = (id) => ({
    event: "SubagentStop",
    agentId: id,
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
  });
  stampFromHook("%9", start("g1"), 1000, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.equal(liveAt(t, 1000).subagent, 1);
  stampFromHook("%9", stopSub("g1"), 3000, t);
  assert.equal(liveAt(t, 3000).subagent, 0);
  assert.equal(
    t.getSessOpt("s1", "@herald_state"),
    "done",
    "synthesis-only host must not wait forever for idle_prompt",
  );
});

test("Claude: last SubagentStop with hasTasks still holds WORKING until idle_prompt", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 1,
      shells: 0,
      subagentIds: ["a1"],
    },
    1000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.equal(t.getSessOpt("s1", "@herald_host_kind"), "task_list");
  stampFromHook(
    "%9",
    {
      event: "SubagentStop",
      agentId: "a1",
      hasTasks: true,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1100,
    t,
  );
  assert.equal(liveAt(t).subagent, 0);
  assert.equal(
    t.getSessOpt("s1", "@herald_state"),
    "working",
    "must NOT settle early on Claude",
  );
  stampFromHook(
    "%9",
    {
      event: "Notification",
      notificationType: "idle_prompt",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1160,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("generic synthetic UPS does not re-assert WORKING after DONE", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolName: "",
      toolBackground: false,
      loopPrompt: false,
    },
    1000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  stampFromHook(
    "%9",
    {
      event: "UserPromptSubmit",
      synthetic: true,
      taskCompleteInject: false,
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolName: "",
      toolBackground: false,
      loopPrompt: false,
    },
    1001,
    t,
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_state"),
    "done",
    "non-resume synthetic noise must not pull DONE → WORKING",
  );
});

test("task-complete inject after DONE marks WORKING (Grok thinking resume)", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolName: "",
      toolBackground: false,
      loopPrompt: false,
    },
    1000,
    t,
  );
  stampFromHook(
    "%9",
    {
      event: "UserPromptSubmit",
      synthetic: true,
      taskCompleteInject: true,
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolName: "",
      toolBackground: false,
      loopPrompt: false,
    },
    1001,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
});

test("permission_prompt still wins over synthesis-only SubagentStop drain", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Notification",
      notificationType: "permission_prompt",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "needs");
  stampFromHook(
    "%9",
    {
      event: "SubagentStop",
      agentId: "x",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1001,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "needs");
});

test("arm clears host_kind so a re-armed session can reclassify host", () => {
  const t = makeT(freshSession());
  t.setSessOpt("s1", "@herald_host_kind", "task_list");
  t.setSessOpt("s1", "@herald_leases", "subagent:a:9999");
  // arm is no-op if already armed; force unarmed
  t.setSessOpt("s1", "@herald_armed", "0");
  arm("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_host_kind"), "synthesis");
  assert.equal(t.getSessOpt("s1", "@herald_leases"), "");
});

// P8 host-kind truth: Claude SubagentStart never carries background_tasks
// (captured live 2026-07-16). Demoting on that false signal put every
// multi-subagent Claude session on synthesis quiet-settle heuristics.
test("claude SubagentStart does not demote task_list to hybrid", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  t.setSessOpt("s1", "@herald_host_kind", "task_list");
  t.setSessOpt("s1", "@herald_state", "working");
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "lane1",
      sourceCli: "claude",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_host_kind"),
    "task_list",
    "Claude bt-less SubagentStart must not demote task_list",
  );
});

test("grok SubagentStart still demotes task_list to hybrid", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  t.setSessOpt("s1", "@herald_host_kind", "task_list");
  t.setSessOpt("s1", "@herald_state", "working");
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "g1",
      sourceCli: "grok",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_host_kind"),
    "hybrid",
    "non-Claude bt-less SubagentStart still proves host mixing",
  );
});

test("claude hasTasks event re-promotes hybrid to task_list", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  t.setSessOpt("s1", "@herald_host_kind", "hybrid");
  t.setSessOpt("s1", "@herald_state", "working");
  stampFromHook(
    "%9",
    {
      event: "Stop",
      sourceCli: "claude",
      hasTasks: true,
      subagents: 1,
      shells: 0,
      subagentIds: ["a1"],
    },
    1000,
    t,
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_host_kind"),
    "task_list",
    "Claude task list must reclaim task_list from hybrid",
  );
});

test("grok hasTasks event does not re-promote hybrid", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  t.setSessOpt("s1", "@herald_host_kind", "hybrid");
  t.setSessOpt("s1", "@herald_state", "working");
  stampFromHook(
    "%9",
    {
      event: "Stop",
      sourceCli: "grok",
      hasTasks: true,
      subagents: 1,
      shells: 0,
      subagentIds: ["g1"],
    },
    1000,
    t,
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_host_kind"),
    "hybrid",
    "Grok backgroundTasks must not promote hybrid back to task_list",
  );
});

test("shouldSettleSynthSubagentStop pure helper", () => {
  assert.equal(
    shouldSettleSynthSubagentStop({
      tasksSeen: false,
      event: "SubagentStop",
      subs: 0,
      cur: "working",
    }),
    true,
  );
  assert.equal(
    shouldSettleSynthSubagentStop({
      tasksSeen: true,
      event: "SubagentStop",
      subs: 0,
      cur: "working",
    }),
    false,
  );
});

// P8 hermes flash lock: Claude mid-turn with a drained subagent must not
// DONE-flash via hybrid demotion + SubagentStop settle or quiet settle.
// Live bug 2026-07-16: task_list demoted on bt-less SubagentStart → hybrid
// → shouldSettleSynthSubagentStop / quiet settle while CLI still thinking.
test("hermes mid-turn DONE-flash cannot recur (task_list + Claude)", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  t.setSessOpt("s1", "@herald_host_kind", "task_list");
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt("s1", "@herald_since", "0");
  t.setSessOpt("s1", "@herald_last_active", "0");

  // (a) Claude SubagentStart without background_tasks — stay task_list.
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "lane1",
      sourceCli: "claude",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    0,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_host_kind"), "task_list");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.equal(liveAt(t, 0).subagent, 1);

  // (b) SubagentStop drains fleet; task_list must NOT synth-settle to DONE.
  stampFromHook(
    "%9",
    {
      event: "SubagentStop",
      agentId: "lane1",
      sourceCli: "claude",
      hasTasks: true,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    30,
    t,
  );
  assert.equal(liveAt(t, 30).subagent, 0);
  assert.equal(
    t.getSessOpt("s1", "@herald_state"),
    "working",
    "shouldSettleSynthSubagentStop must not fire on task_list",
  );
  assert.equal(t.getSessOpt("s1", "@herald_host_kind"), "task_list");

  // (c) Long silence past turn TTL + old 90s quiet: task_list quiet path is null.
  const quietSnap = {
    state: "working",
    hostKind: "task_list",
    lastActive: 30,
    since: 0,
    counts: { subagent: 0, watcher: 0, bg_shell: 0, turn: 0 },
    agentAlive: null,
  };
  assert.equal(
    settleIfStale(quietSnap, 400, { settleSynthQuietSec: 300 }),
    null,
    "task_list must not quiet-settle after 370s silence",
  );
  assert.equal(
    applySettle("s1", 400, t, {
      settle: { settleSynthQuietSec: 300, maxWorkingSec: 0 },
    }),
    false,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");

  // (d) Genuine end: Stop with empty bt → DONE (turn over).
  stampFromHook(
    "%9",
    {
      event: "Stop",
      sourceCli: "claude",
      hasTasks: true,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      shellIds: [],
    },
    410,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(t.getSessOpt("s1", "@herald_host_kind"), "task_list");
});

test("SubagentStop with mismatched id drops a syn-* id (Grok pairing)", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  const leases = t.getSessOpt("s1", "@herald_leases");
  assert.match(leases, /subagent:syn-/);
  stampFromHook(
    "%9",
    {
      event: "SubagentStop",
      agentId: "real-g1",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1001,
    t,
  );
  assert.equal(liveAt(t, 1001).subagent, 0);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("applySettle quiet-settles synthesis WORKING after quiet window", () => {
  const t = makeT(freshSession());
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt("s1", "@herald_leases", "");
  t.setSessOpt("s1", "@herald_host_kind", "synthesis");
  t.setSessOpt("s1", "@herald_last_active", "1000");
  t.setSessOpt("s1", "@herald_since", "900");
  const ok = applySettle("s1", 1000 + 90, t, {
    settle: { settleSynthQuietSec: 90 },
  });
  assert.equal(ok, true);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("applySettle does not settle Claude task_list during pure generation", () => {
  const t = makeT(freshSession());
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt("s1", "@herald_leases", "");
  t.setSessOpt("s1", "@herald_host_kind", "task_list");
  t.setSessOpt("s1", "@herald_last_active", "1000");
  t.setSessOpt("s1", "@herald_since", "900");
  const ok = applySettle("s1", 1000 + 999, t, {
    settle: { settleSynthQuietSec: 90, maxWorkingSec: 0 },
  });
  assert.equal(ok, false);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
});

test("Grok /loop: Stop is DONE while watchers live (informational only)", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const leaseCfg = { watcherTtlSec: 60 };
  stampFromHook(
    "%9",
    {
      event: "UserPromptSubmit",
      loopPrompt: true,
      synthetic: false,
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolName: "",
      toolBackground: false,
    },
    1000,
    t,
    { lease: leaseCfg, settle: { settleSynthQuietSec: 90 } },
  );
  assert.equal(liveAt(t, 1000).watcher, 1);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolName: "",
      toolBackground: false,
      loopPrompt: false,
    },
    1010,
    t,
    { lease: leaseCfg, settle: { settleSynthQuietSec: 90 } },
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_state"),
    "done",
    "watchers must not hold WORKING after Stop",
  );
  assert.equal(liveAt(t, 1010).watcher, 1, "watcher lease still present");
});

test("/loop prompt + scheduler_create is ONE watcher not two", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const base = {
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
    toolBackground: false,
  };
  stampFromHook(
    "%9",
    {
      event: "UserPromptSubmit",
      loopPrompt: true,
      synthetic: false,
      toolName: "",
      ...base,
    },
    1000,
    t,
  );
  stampFromHook(
    "%9",
    {
      event: "PostToolUse",
      toolName: "scheduler_create",
      loopPrompt: false,
      ...base,
    },
    1001,
    t,
  );
  assert.equal(liveAt(t).watcher, 1, "must not double-count /loop + create");
  assert.match(t.getSessOpt("s1", "@herald_leases"), /watcher:loop:/);
  assert.doesNotMatch(t.getSessOpt("s1", "@herald_leases"), /loop-pending/);
});

test("bg shell is a task not a second watcher", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "PostToolUse",
      toolName: "scheduler_create",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolBackground: false,
      loopPrompt: false,
    },
    1000,
    t,
  );
  stampFromHook(
    "%9",
    {
      event: "PostToolUse",
      toolName: "run_terminal_command",
      toolBackground: true,
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      loopPrompt: false,
    },
    1001,
    t,
  );
  assert.equal(liveAt(t).watcher, 1);
  assert.equal(liveAt(t).bg_shell, 1);
});

test("scheduler_delete clears watcher so Stop can DONE", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "PostToolUse",
      toolName: "scheduler_create",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolBackground: false,
      loopPrompt: false,
    },
    1000,
    t,
  );
  assert.equal(liveAt(t).watcher, 1);
  stampFromHook(
    "%9",
    {
      event: "PostToolUse",
      toolName: "scheduler_delete",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolBackground: false,
      loopPrompt: false,
    },
    1010,
    t,
  );
  assert.equal(liveAt(t).watcher, 0);
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolName: "",
      toolBackground: false,
      loopPrompt: false,
    },
    1020,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("fake-clock: subagent lease expires without further events (TTL)", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "a",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  assert.equal(liveAt(t, 1000).subagent, 1);
  assert.equal(liveAt(t, 1000 + 301).subagent, 0); // default subagentTtlSec 300
});

test("immortal-watcher repro: Monitor + busy session + Stop → DONE; watcher exp never re-armed", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const base = {
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
    toolBackground: false,
    loopPrompt: false,
  };
  // t=0: grant watcher:mon via Monitor PreToolUse
  stampFromHook(
    "%9",
    { event: "PreToolUse", toolName: "monitor", ...base },
    0,
    t,
  );
  const monExpAtGrant = parseLeases(t.getSessOpt("s1", "@herald_leases")).find(
    (l) => l.id === "mon",
  )?.exp;
  assert.equal(monExpAtGrant, 0 + 900);

  // Busy session: activity must not re-arm the watcher
  for (const ts of [60, 120, 180]) {
    stampFromHook(
      "%9",
      { event: "PostToolUse", toolName: "Read", ...base },
      ts,
      t,
    );
  }

  // t=200: Stop with no tasks → DONE; watcher exp still grant-time
  stampFromHook("%9", { event: "Stop", ...base, toolName: "" }, 200, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  const mon = parseLeases(t.getSessOpt("s1", "@herald_leases")).find(
    (l) => l.id === "mon",
  );
  assert.equal(mon.exp, 0 + 900, "watcher exp never re-armed by activity");

  // t=901: watcher TTL elapsed → countLive reports 0 watchers
  // applySettle may clear leases on quiet settle; also assert pure countLive.
  assert.equal(liveAt(t, 901).watcher, 0);
  applySettle("s1", 901, t, {
    settle: { settleSynthQuietSec: 90 },
  });
  assert.equal(liveAt(t, 901).watcher, 0);
});

test("PostToolUse does not extend watcher exp; does re-arm subagent", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  // Seed leases granted at t=0 with default TTLs (watcher 900, subagent 300).
  t.setSessOpt("s1", "@herald_leases", "watcher:mon:900,subagent:s1:300");
  t.setSessOpt("s1", "@herald_state", "working");
  stampFromHook(
    "%9",
    {
      event: "PostToolUse",
      toolName: "Read",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolBackground: false,
      loopPrompt: false,
    },
    100,
    t,
  );
  const leases = parseLeases(t.getSessOpt("s1", "@herald_leases"));
  const mon = leases.find((l) => l.id === "mon");
  const sub = leases.find((l) => l.kind === "subagent");
  assert.equal(mon.exp, 900, "watcher must keep exp from grant, not re-arm");
  assert.equal(sub.exp, 100 + 300, "subagent must be re-armed by activity");
});

test("non-synthetic UserPromptSubmit blanks legacy @herald_bg_watchers", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  t.setSessOpt("s1", "@herald_bg_watchers", "1");
  t.setSessOpt("s1", "@herald_bg_watcher_ids", "mon");
  stampFromHook(
    "%9",
    {
      event: "UserPromptSubmit",
      synthetic: false,
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      toolName: "",
      toolBackground: false,
      loopPrompt: false,
    },
    1000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_bg_watchers"), "");
  assert.equal(t.getSessOpt("s1", "@herald_bg_watcher_ids"), "");
});

test("model hint is source-tagged; CLI switch clears stale hint", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const prevModel = process.env.GROK_MODEL;
  const prevEffort = process.env.GROK_EFFORT;
  process.env.GROK_MODEL = "x";
  // biome-ignore lint/performance/noDelete: unset effort so hint is bare model
  delete process.env.GROK_EFFORT;
  try {
    stampFromHook(
      "%9",
      {
        event: "PostToolUse",
        toolName: "Read",
        sourceCli: "grok",
        hasTasks: false,
        subagents: 0,
        shells: 0,
        subagentIds: [],
        toolBackground: false,
        loopPrompt: false,
      },
      1000,
      t,
    );
    assert.equal(t.getSessOpt("s1", "@herald_model_hint"), "x");
    assert.equal(t.getSessOpt("s1", "@herald_model_hint_src"), "grok");

    stampFromHook(
      "%9",
      {
        event: "PostToolUse",
        toolName: "Read",
        sourceCli: "claude",
        hasTasks: false,
        subagents: 0,
        shells: 0,
        subagentIds: [],
        toolBackground: false,
        loopPrompt: false,
      },
      1001,
      t,
    );
    assert.equal(
      t.getSessOpt("s1", "@herald_model_hint"),
      "",
      "cross-CLI must clear stale model hint",
    );
    assert.equal(t.getSessOpt("s1", "@herald_model_hint_src"), "");
  } finally {
    if (prevModel === undefined)
      // biome-ignore lint/performance/noDelete: restore unset env
      delete process.env.GROK_MODEL;
    else process.env.GROK_MODEL = prevModel;
    if (prevEffort === undefined)
      // biome-ignore lint/performance/noDelete: restore unset env
      delete process.env.GROK_EFFORT;
    else process.env.GROK_EFFORT = prevEffort;
  }
});

test("applyWash uses transparent bg + sliding line when working", () => {
  const t = makeT(freshSession());
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt("s1", "@herald_since", "1000");
  applyWash("s1", 1004, t, {
    tmuxBar: { wash: true, doneFlashSec: 3, whenCovered: "keep" },
  });
  assert.match(t.getSessOpt("s1", "status-style"), /bg=default/);
  assert.doesNotMatch(t.getSessOpt("s1", "status-style"), /bg=colour\d+/);
  assert.match(t.getSessOpt("s1", "@herald_bar_line"), /━/);
  assert.match(t.getSessOpt("s1", "status-left"), /@herald_bar_line/);
});

test("applyWash is no-op when wash disabled", () => {
  const t = makeT(freshSession());
  t.setSessOpt("s1", "@herald_state", "working");
  applyWash("s1", 1000, t, { tmuxBar: { wash: false } });
  assert.equal(t.getSessOpt("s1", "status-style"), "");
  assert.equal(t.getSessOpt("s1", "@herald_bar_line"), "");
});

test("stampFromHook sets last_active on Stop but not on task_complete", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    50,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_last_active"), "50");
  stampFromHook(
    "%9",
    {
      event: "Notification",
      notificationType: "task_complete",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    60,
    t,
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_last_active"),
    "50",
    "informational ping must not refresh last_active",
  );
  assert.equal(t.getSessOpt("s1", "@herald_last_hook"), "60");
});

test("stampFromHook writes a heartbeat on every event", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    { event: "Stop", hasTasks: true, subagents: 0, shells: 0, subagentIds: [] },
    4242,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_last_hook"), "4242");
});

test("armIfMatch arms a session matching the glob, skips one that does not", () => {
  const t = makeT({
    "syndcast-10": { opts: {}, active: "@a", windows: { "@a": "Backlog" } },
    "token-oracle": { opts: {}, active: "@b", windows: { "@b": "Oracle" } },
  });
  armIfMatch("syndcast-10", "syndcast-*", t);
  armIfMatch("token-oracle", "syndcast-*", t);
  assert.equal(t.getSessOpt("syndcast-10", "@herald_armed"), "1", "matched");
  assert.equal(
    t.getSessOpt("token-oracle", "@herald_armed"),
    "",
    "not matched",
  );
});

test("armIfMatch on an already-armed session is a no-op (idempotent)", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t._S.s1.opts["@herald_live_win"] = "@sentinel"; // must survive a re-arm attempt
  armIfMatch("s1", "*", t);
  assert.equal(t.getSessOpt("s1", "@herald_live_win"), "@sentinel");
});

test("arm clears stale in-flight counts", () => {
  // Otherwise a re-arm inherits a count that no event will ever drain, and
  // every future idle_prompt is held at WORKING forever.
  const t = makeT(freshSession());
  t.setSessOpt("s1", "@herald_leases", "subagent:x:9999");
  t.setSessOpt("s1", "@herald_worked", 999);
  arm("s1", t);
  assert.equal(liveAt(t).subagent, 0);
  assert.equal(t.getSessOpt("s1", "@herald_worked"), "0");
});

test("stampFromHook freezes how long the turn worked when it reaches DONE", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const ev = (o) => ({
    event: "Stop",
    agentId: "",
    notificationType: "",
    hasTasks: true,
    subagents: 0,
    shells: 0,
    subagentIds: [],
    ...o,
  });
  // Prompt starts the clock at t=1000; the turn ends at t=1125 -> worked 125s.
  stampFromHook(
    "%9",
    ev({ event: "UserPromptSubmit", hasTasks: false }),
    1000,
    t,
  );
  stampFromHook("%9", ev({ event: "Stop" }), 1125, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(t.getSessOpt("s1", "@herald_worked"), "125");

  // A later idle_prompt (still DONE) must not recompute and inflate the clock.
  stampFromHook(
    "%9",
    {
      event: "Notification",
      notificationType: "idle_prompt",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    9999,
    t,
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_worked"),
    "125",
    "frozen, not ticking",
  );
});

test("stampFromHook records no worked time when the turn was never clocked", () => {
  // A Stop with no prior prompt (@herald_since unset) has nothing to measure.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    { event: "Stop", hasTasks: true, subagents: 0, shells: 0, subagentIds: [] },
    2000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_worked"), "0");
});

test("refreshCards respawns each card window without disturbing state", () => {
  const t = makeT({
    s1: {
      opts: {
        "@herald_armed": "1",
        "@herald_live_win": "@w1",
        "@herald_state": "done",
        "@herald_worked": "125",
        "@herald_covered": "1",
      },
      active: "@curtain",
      windows: { "@w1": "Backlog", "@curtain": "_curtain" },
    },
    s2: {
      opts: {
        "@herald_armed": "1",
        "@herald_live_win": "@w2",
        "@herald_state": "working",
        "@herald_covered": "0",
      },
      active: "@w2",
      windows: { "@w2": "Run", "@curtain": "_curtain" },
    },
  });
  refreshCards(t);
  // A covered session ends up covered again; an uncovered one stays on its live
  // window. Neither loses its state.
  assert.equal(t._S.s1.active, "@curtain", "covered session re-covered");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(t.getSessOpt("s1", "@herald_worked"), "125", "state preserved");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
  assert.equal(
    t._S.s2.active,
    "@w2",
    "uncovered session left on its live window",
  );
  assert.equal(t.getSessOpt("s2", "@herald_state"), "working");
  assert.equal(t._S.s2.windows["@curtain"], "_curtain", "card recreated");
  assert.equal(
    t.getSessOpt("s1", "@herald_refreshing"),
    "",
    "refresh flag cleared after",
  );
});

// r007: kill of _curtain fires the card EXIT trap → reveal. Without a
// refreshing gate + re-assert, a covered session ends with covered=0, bar
// restored, while the new card is selected (keypress no-op).
test("refreshCards survives card EXIT trap without uncover", () => {
  const transparentCfg = { tmuxBar: { whenCovered: "transparent" } };
  const t = makeT({
    s1: {
      opts: {
        "@herald_armed": "1",
        "@herald_live_win": "@w1",
        "@herald_state": "done",
        "@herald_worked": "42",
        "@herald_covered": "1",
        "status-style": "bg=colour234,fg=white,bg=default",
        "@herald_prev_status_style": "bg=colour234,fg=white",
        "@herald_bar_saved": "1",
      },
      active: "@curtain",
      windows: { "@w1": "Backlog", "@curtain": "_curtain" },
    },
  });
  // Simulate the shell EXIT trap on killWindow: reveal unless refreshing.
  t.killWindow = (target) => {
    const [s] = target.split(":");
    if (t.getSessOpt(s, "@herald_refreshing") !== "1") {
      reveal(s, t, transparentCfg);
    }
  };
  refreshCards(t, transparentCfg);
  assert.equal(
    t.getSessOpt("s1", "@herald_covered"),
    "1",
    "still covered after kill+recreate",
  );
  assert.equal(t._S.s1.active, "@curtain", "card window selected");
  assert.equal(
    t.getSessOpt("s1", "status-style"),
    "bg=colour234,fg=white,bg=default",
    "transparent bar re-applied / preserved",
  );
  assert.equal(t.getSessOpt("s1", "@herald_bar_saved"), "1");
  assert.equal(t.getSessOpt("s1", "@herald_worked"), "42", "state preserved");
  assert.equal(t.getSessOpt("s1", "@herald_refreshing"), "", "flag cleared");
  assert.equal(t._S.s1.windows["@curtain"], "_curtain", "card recreated");
});

test("stampFromHook is a no-op outside tmux", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "";
  stampFromHook(
    "%9",
    { event: "Stop", hasTasks: true, subagents: 0, shells: 0 },
    1,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "");
});

test("armAll arms every session matching the glob", () => {
  const t = makeT({
    "web-1": { opts: {}, active: "@a", windows: { "@a": "Web 1" } },
    "web-2": { opts: {}, active: "@b", windows: { "@b": "Web 2" } },
    api: { opts: {}, active: "@c", windows: { "@c": "Api" } },
  });
  t.listSessions = () => ["web-1", "web-2", "api"];
  armAll("web*", t);
  assert.equal(t.getSessOpt("web-1", "@herald_armed"), "1");
  assert.equal(t.getSessOpt("web-2", "@herald_armed"), "1");
  assert.equal(t.getSessOpt("api", "@herald_armed"), "", "non-match not armed");
});

test("armAll with * arms all", () => {
  const t = makeT({
    s1: { opts: {}, active: "@a", windows: { "@a": "S1" } },
    s2: { opts: {}, active: "@b", windows: { "@b": "S2" } },
  });
  t.listSessions = () => ["s1", "s2"];
  armAll("*", t);
  assert.equal(t.getSessOpt("s1", "@herald_armed"), "1");
  assert.equal(t.getSessOpt("s2", "@herald_armed"), "1");
});

test("arm stores the resolved theme name and frame interval", () => {
  // Inject an explicit config so the assertion does not depend on the real user
  // config file (which the user retunes -- e.g. a fleet-wide forge default).
  const t = makeT(freshSession());
  arm("s1", t, {});
  assert.equal(t.getSessOpt("s1", "@herald_theme"), "classic");
  assert.equal(t.getSessOpt("s1", "@herald_frame_ms"), "1000", "static -> 1s");
});

const transparent = { tmuxBar: { whenCovered: "transparent" } };

test("cover in transparent mode drops the bar bg and saves the exact prior style", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt("s1", "status-style", "bg=colour234,fg=white");
  cover("s1", t, transparent);
  assert.equal(
    t.getSessOpt("s1", "status-style"),
    "bg=colour234,fg=white,bg=default",
  );
  assert.equal(
    t.getSessOpt("s1", "@herald_prev_status_style"),
    "bg=colour234,fg=white",
  );
  assert.equal(t.getSessOpt("s1", "@herald_bar_saved"), "1");
});

test("reveal restores the exact prior status-style", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt("s1", "status-style", "bg=colour234,fg=white");
  cover("s1", t, transparent);
  reveal("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=colour234,fg=white");
  assert.equal(t.getSessOpt("s1", "@herald_bar_saved"), "");
});

test("with no prior status-style, reveal unsets it (back to inheritance)", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=default");
  reveal("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "", "unset, not stranded");
});

test("keep mode never touches status-style", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t, {}); // default keep
  assert.equal(t.getSessOpt("s1", "status-style"), "");
  assert.equal(t.getSessOpt("s1", "@herald_bar_saved"), "");
});

test("revealAll and disarm restore the bar", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "done");
  t.setSessOpt("s1", "status-style", "bg=colour234");
  cover("s1", t, transparent);
  revealAll(t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=colour234");

  cover("s1", t, transparent);
  disarm("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=colour234");
});

test("focus covers the non-matching session with the bar dropped", () => {
  const t = makeT(twoArmed());
  t.setSessOpt("s2", "status-style", "bg=colour234");
  focus("Syndcast Backlog", t, transparent); // reveals s1, covers s2
  assert.equal(t.getSessOpt("s2", "status-style"), "bg=colour234,bg=default");
  assert.equal(
    t.getSessOpt("s1", "@herald_bar_saved"),
    "",
    "revealed s1 has no drop",
  );
});

test("arm stamps an animated theme's faster frame interval", () => {
  const t = makeT(freshSession());
  arm("s1", t, { theme: "forge" });
  assert.equal(t.getSessOpt("s1", "@herald_theme"), "forge");
  assert.equal(t.getSessOpt("s1", "@herald_frame_ms"), "500", "2 fps default");
});

test("arm honors a themeBySession glob over the global default", () => {
  const t = makeT(freshSession());
  arm("s1", t, { theme: "classic", themeBySession: { "s*": "forge" } });
  assert.equal(t.getSessOpt("s1", "@herald_theme"), "forge");
});

test("SessionEnd stamps DONE and clears all leases", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "a",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.ok(liveAt(t).subagent >= 1);
  stampFromHook(
    "%9",
    {
      event: "SessionEnd",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1100,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(t.getSessOpt("s1", "@herald_leases"), "");
});

test("Claude Stop with empty background_tasks does not wipe live subagent/shell leases", () => {
  // False-empty Stop (captured live 2026-07-16): background_tasks: [] while
  // monitors/shells still alive. Empty Stop must not wipe; TTL decay retires.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "mon1",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 1,
      shells: 1,
      subagentIds: ["mon1"],
      shellIds: ["sh1"],
    },
    1010,
    t,
  );
  assert.equal(liveAt(t, 1010).subagent, 1);
  assert.equal(liveAt(t, 1010).bg_shell, 1);
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      shellIds: [],
    },
    1020,
    t,
  );
  assert.equal(
    liveAt(t, 1020).subagent,
    1,
    "empty Stop must not wipe subagent",
  );
  assert.equal(liveAt(t, 1020).bg_shell, 1, "empty Stop must not wipe shell");
});

test("Claude Stop with non-empty background_tasks stays authoritative", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 2,
      shells: 0,
      subagentIds: ["mon1", "stale2"],
    },
    1000,
    t,
  );
  assert.equal(liveAt(t, 1000).subagent, 2);
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 1,
      shells: 0,
      subagentIds: ["mon1"],
    },
    1100,
    t,
  );
  assert.equal(liveAt(t, 1100).subagent, 1);
  const leases = parseLeases(t.getSessOpt("s1", "@herald_leases"));
  assert.ok(leases.some((l) => l.kind === "subagent" && l.id === "mon1"));
  assert.equal(
    leases.some((l) => l.kind === "subagent" && l.id === "stale2"),
    false,
  );
});

test("SubagentStop with empty inflight list still reconciles to empty", () => {
  // Last subagent reporting: SubagentStop + empty inflight must not strand WORKING.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 1,
      shells: 0,
      subagentIds: ["mon1"],
    },
    1000,
    t,
  );
  assert.equal(liveAt(t, 1000).subagent, 1);
  stampFromHook(
    "%9",
    {
      event: "SubagentStop",
      agentId: "mon1",
      hasTasks: true,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1100,
    t,
  );
  assert.equal(liveAt(t, 1100).subagent, 0);
});

test("Grok Stop (no tasks) still reconciles subagents to empty", () => {
  // RC1 unchanged: hasTasks false + Stop clears synth subagents.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "g1",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  assert.equal(liveAt(t, 1000).subagent, 1);
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    2000,
    t,
  );
  assert.equal(liveAt(t, 2000).subagent, 0);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("monitor-sandwich lifecycle: heartbeats heal past old TTL; empty Stop keeps fleet; SubagentStop settles", () => {
  // Live repro lock: SubagentStart → quiet gaps beyond old 120s TTL → heartbeat
  // Pre/PostToolUse with agentId re-grants → empty Claude Stop does not wipe →
  // SubagentStop with empty inflight drains → idle_prompt reaches DONE.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const base = {
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
  };
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "mon1",
      ...base,
    },
    0,
    t,
  );
  assert.equal(liveAt(t, 0).subagent, 1);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");

  for (const ts of [200, 400, 600]) {
    stampFromHook(
      "%9",
      {
        event: ts % 400 === 0 ? "PreToolUse" : "PostToolUse",
        agentId: "mon1",
        toolName: "Bash",
        ...base,
      },
      ts,
      t,
    );
    assert.equal(
      liveAt(t, ts).subagent,
      1,
      `heartbeat at t=${ts} must keep 1 subagent (beyond old 120s TTL gaps)`,
    );
  }

  // Empty Claude Stop must not wipe the parked monitor.
  stampFromHook(
    "%9",
    {
      event: "Stop",
      hasTasks: true,
      subagents: 0,
      shells: 0,
      subagentIds: [],
      shellIds: [],
    },
    610,
    t,
  );
  assert.equal(liveAt(t, 610).subagent, 1, "empty Stop keeps mon1");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");

  // Authoritative drain: SubagentStop + empty inflight.
  stampFromHook(
    "%9",
    {
      event: "SubagentStop",
      agentId: "mon1",
      hasTasks: true,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    620,
    t,
  );
  assert.equal(liveAt(t, 620).subagent, 0);
  // task_list host holds WORKING until idle_prompt (Claude settle path).
  assert.equal(t.getSessOpt("s1", "@herald_host_kind"), "task_list");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  stampFromHook(
    "%9",
    {
      event: "Notification",
      notificationType: "idle_prompt",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    630,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("PostToolUse with agentId re-grants an expired subagent lease", () => {
  // Parked monitor whose lease TTL-expired re-earns it on the next heartbeat
  // tool call that carries agent_id (captured live 2026-07-16).
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const ttl = 120;
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "mon1",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    0,
    t,
    { lease: { subagentTtlSec: ttl } },
  );
  assert.equal(liveAt(t, 0).subagent, 1);
  // Quiet past expiry — no events; count decays to 0.
  assert.equal(liveAt(t, ttl + 1).subagent, 0);
  stampFromHook(
    "%9",
    {
      event: "PostToolUse",
      agentId: "mon1",
      toolName: "Bash",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    ttl + 50,
    t,
    { lease: { subagentTtlSec: ttl } },
  );
  assert.equal(liveAt(t, ttl + 50).subagent, 1);
  const leases = parseLeases(t.getSessOpt("s1", "@herald_leases"));
  const mon = leases.find((l) => l.kind === "subagent" && l.id === "mon1");
  assert.ok(mon, "subagent:mon1 lease must exist");
  assert.equal(mon.exp, ttl + 50 + ttl);
});

test("PreToolUse without agentId grants no subagent lease", () => {
  // Main-agent tool call must not invent a subagent.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "PreToolUse",
      agentId: "",
      toolName: "Bash",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  assert.equal(liveAt(t, 1000).subagent, 0);
});

test("SubagentStop does not resurrect the stopping agent", () => {
  // SubagentStop for mon1 (which also carries agentId) must still end with
  // no live subagent:mon1 lease — release wins over any agentId side path.
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampFromHook(
    "%9",
    {
      event: "SubagentStart",
      agentId: "mon1",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1000,
    t,
  );
  assert.equal(liveAt(t, 1000).subagent, 1);
  stampFromHook(
    "%9",
    {
      event: "SubagentStop",
      agentId: "mon1",
      hasTasks: false,
      subagents: 0,
      shells: 0,
      subagentIds: [],
    },
    1100,
    t,
  );
  assert.equal(liveAt(t, 1100).subagent, 0);
  const leases = parseLeases(t.getSessOpt("s1", "@herald_leases"));
  assert.equal(
    leases.some((l) => l.kind === "subagent" && l.id === "mon1"),
    false,
  );
});

test("pid backstop: dead agent process forces DONE despite fresh leases", async () => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt(
    "s1",
    "@herald_leases",
    `subagent:alive:${Math.floor(Date.now() / 1000) + 600}`,
  );
  t.setSessOpt("s1", "@herald_agent_pid", String(child.pid));
  t.setSessOpt("s1", "@herald_last_active", "1000");
  t.setSessOpt("s1", "@herald_since", "900");
  t.setSessOpt("s1", "@herald_host_kind", "synthesis");
  // Still alive → settle should not PID-kill
  assert.equal(applySettle("s1", 1000, t, { settle: {} }), false);
  child.kill("SIGKILL");
  await once(child, "exit");
  const ok = applySettle("s1", 1001, t, { settle: {} });
  assert.equal(ok, true);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(t.getSessOpt("s1", "@herald_leases"), "");
});

// Live bug 2026-07-17 (syndcast session): Claude status bar reports
// "3 shells, 5 monitors" but the curtain showed "1 watcher 8 tasks".
// Root cause: every background_tasks type:"shell" became bg_shell/task,
// while Monitor PreToolUse granted a single placeholder watcher:mon —
// monitors never received their own taskId leases, so 3+5 collapsed to 1+8.
test("Claude 3 shells + 5 monitors do not collapse to 1 watcher + 8 tasks", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  const base = {
    sourceCli: "claude",
    hasTasks: false,
    subagents: 0,
    shells: 0,
    subagentIds: [],
    shellIds: [],
    monitorIds: [],
    toolBackground: false,
    loopPrompt: false,
  };

  // Five Claude Monitor tools: PostToolUse returns tool_response.taskId.
  // Captured live: { taskId: 'bdxck8yos', timeoutMs: 0, persistent: true }.
  const monitors = [
    "bnw2gu5zb",
    "bnl2zel1e",
    "bfqagi33b",
    "bn3692luu",
    "bdxck8yos",
  ];
  let ts = 1000;
  for (const id of monitors) {
    stampFromHook(
      "%9",
      {
        ...base,
        event: "PreToolUse",
        toolName: "Monitor",
      },
      ts++,
      t,
    );
    stampFromHook(
      "%9",
      {
        ...base,
        event: "PostToolUse",
        toolName: "Monitor",
        toolTaskId: id,
      },
      ts++,
      t,
    );
  }

  // Three Bash run_in_background shells: tool_response.backgroundTaskId.
  const shells = ["b1ik7ojoi", "b0luc4n2t", "bc0fpiviv"];
  for (const id of shells) {
    stampFromHook(
      "%9",
      {
        ...base,
        event: "PostToolUse",
        toolName: "Bash",
        toolBackground: true,
        toolTaskId: id,
      },
      ts++,
      t,
    );
  }

  // Authoritative Stop: Claude still types monitors as type:"shell" in
  // background_tasks (measured in hook-debug — only shell|subagent). The
  // lease store must keep the 5 monitor taskIds as watchers and only the
  // 3 pure shells as bg_shell.
  const allShellTyped = [...shells, ...monitors].map((id) => ({
    id,
    type: "shell",
    status: "running",
    description: id,
  }));
  stampFromHook(
    "%9",
    {
      ...base,
      event: "Stop",
      hasTasks: true,
      shells: allShellTyped.length,
      shellIds: allShellTyped.map((x) => x.id),
      // Adapter would set monitorIds from prior knowledge / type; stamp path
      // relies on existing watcher leases for shell-typed monitors.
      monitorIds: [],
      subagents: 0,
      subagentIds: [],
    },
    ts,
    t,
  );

  const live = liveAt(t, ts);
  assert.equal(
    live.bg_shell,
    3,
    "pure Bash background shells must remain shells, not lump monitors",
  );
  assert.equal(
    live.watcher,
    5,
    "each Monitor taskId is its own watcher/monitor lease (not a single mon)",
  );
  assert.equal(live.subagent, 0);
  // Placeholder watcher:mon must not survive once real taskIds are known.
  assert.doesNotMatch(
    t.getSessOpt("s1", "@herald_leases"),
    /watcher:mon:/,
    "provisional mon placeholder must be released after taskId grants",
  );
  for (const id of monitors) {
    assert.match(
      t.getSessOpt("s1", "@herald_leases"),
      new RegExp(`watcher:${id}:`),
    );
  }
  for (const id of shells) {
    assert.match(
      t.getSessOpt("s1", "@herald_leases"),
      new RegExp(`bg_shell:${id}:`),
    );
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TITLE_FMT,
  arm,
  armAll,
  armIfMatch,
  cover,
  disarm,
  focus,
  refreshCards,
  reveal,
  revealAll,
  stampFromHook,
  stampSession,
} from "../lib/curtain/session.mjs";

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
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "2");
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
  assert.equal(t.getSessOpt("s1", "@herald_bg_shells"), "1");
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
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "2");
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
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "3");

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
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "1", "dedup by id");
  stampFromHook("%9", start("a2"), 1002, t);
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "2");
});

test("id-set: a Stop task list reconciles a leaked synthesized count", () => {
  // Grok-style: two SubagentStarts synthesize a count of 2, but their Stops are
  // dropped. A later authoritative Stop carrying an empty running list must
  // overwrite the leak, not add to it -- self-healing the desync.
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
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "2", "leaked to 2");
  // Authoritative Stop, nothing actually running:
  stampFromHook(
    "%9",
    { event: "Stop", hasTasks: true, subagents: 0, shells: 0, subagentIds: [] },
    2000,
    t,
  );
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "0", "reconciled");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
});

test("id-set: Grok Stop without tasks keeps WORKING while subagent ids remain", () => {
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
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "1");
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
  t.setSessOpt("s1", "@herald_bg_subagents", 3);
  t.setSessOpt("s1", "@herald_worked", 999);
  arm("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_bg_subagents"), "0");
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

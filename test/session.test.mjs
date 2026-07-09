import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arm,
  armAll,
  cover,
  disarm,
  focus,
  reveal,
  revealAll,
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

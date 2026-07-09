import assert from "node:assert/strict";
import { test } from "node:test";
import { arm, cover, reveal, revealAll } from "../lib/curtain/session.mjs";

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

test("revealAll reveals every covered armed session", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "done");
  cover("s1", t);
  revealAll(t);
  assert.equal(t._S.s1.active, "@live");
});

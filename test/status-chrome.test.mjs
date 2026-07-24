import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHROME_HINT_SLOT,
  PAUSE_HINT,
  applyPauseChrome,
  clearPauseChrome,
  ensureChromeHintSlot,
  resolveStatusClick,
  statusMenuTmuxArgs,
} from "../lib/curtain/status-chrome.mjs";
import { pause, resume } from "../lib/curtain/session.mjs";

test("resolveStatusClick toggles pause ↔ resume", () => {
  assert.equal(resolveStatusClick({ paused: false, action: "toggle" }), "pause");
  assert.equal(resolveStatusClick({ paused: true, action: "toggle" }), "resume");
  assert.equal(resolveStatusClick({ paused: false, range: "right" }), "pause");
  assert.equal(resolveStatusClick({ paused: true, range: "left" }), "resume");
});

test("resolveStatusClick explicit verbs", () => {
  assert.equal(resolveStatusClick({ paused: true, action: "pause" }), "pause");
  assert.equal(resolveStatusClick({ paused: false, action: "resume" }), "resume");
  assert.equal(resolveStatusClick({ paused: false, action: "pet" }), "pet");
  assert.equal(resolveStatusClick({ paused: false, action: "off" }), "pause");
  assert.equal(resolveStatusClick({ paused: true, action: "on" }), "resume");
});

test("resolveStatusClick menu returns null", () => {
  assert.equal(resolveStatusClick({ action: "menu" }), null);
});

const makeT = (init = {}, globalOpts = {}) => {
  const S = init;
  const G = { ...globalOpts };
  return {
    _S: S,
    getSessOpt: (s, k) => S[s]?.opts?.[k] ?? "",
    getGlobalOpt: (k) => G[k] ?? "",
    setSessOpt: (s, k, v) => {
      S[s] ??= { opts: {}, active: "@live", windows: {} };
      S[s].opts[k] = String(v);
    },
    unsetSessOpt: (s, k) => {
      delete S[s]?.opts?.[k];
    },
    activeWindowId: (s) => S[s]?.active ?? "@live",
    selectWindow: () => {},
    newCardWindow: () => {},
    killWindow: () => {},
    listWindowsInSession: () => [],
    setHook: () => {},
    setDetachOnDestroy: () => {},
  };
};

test("ensureChromeHintSlot injects #{@herald_chrome_hint} once", () => {
  const t = makeT({ s1: { opts: {}, active: "@live", windows: {} } });
  t.setSessOpt("s1", "status-right", "%H:%M");
  ensureChromeHintSlot("s1", t, true);
  assert.equal(
    t.getSessOpt("s1", "status-right"),
    `${CHROME_HINT_SLOT}%H:%M`,
  );
  assert.equal(t.getSessOpt("s1", "@herald_user_status_right"), "%H:%M");
  // second call is no-op (idempotent)
  ensureChromeHintSlot("s1", t, true);
  assert.equal(
    t.getSessOpt("s1", "status-right"),
    `${CHROME_HINT_SLOT}%H:%M`,
  );
});

test("applyPauseChrome sets glyph when paused and clears content when not", () => {
  const t = makeT({ s1: { opts: {}, active: "@live", windows: {} } });
  applyPauseChrome("s1", true, t);
  assert.equal(t.getSessOpt("s1", "@herald_chrome_hint"), PAUSE_HINT);
  assert.match(t.getSessOpt("s1", "status-right"), /@herald_chrome_hint/);
  applyPauseChrome("s1", false, t);
  assert.equal(t.getSessOpt("s1", "@herald_chrome_hint"), "");
  // slot kept for next pause
  assert.match(t.getSessOpt("s1", "status-right"), /@herald_chrome_hint/);
});

test("clearPauseChrome removes slot and restores user status-right", () => {
  const t = makeT({ s1: { opts: {}, active: "@live", windows: {} } });
  t.setSessOpt("s1", "status-right", "clock");
  applyPauseChrome("s1", true, t);
  clearPauseChrome("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_chrome_hint"), "");
  assert.equal(t.getSessOpt("s1", "status-right"), "clock");
});

test("empty session status-right copies global so gauges stay visible", () => {
  const t = makeT(
    { s1: { opts: {}, active: "@live", windows: {} } },
    { "status-right": "%H:%M  #(gauges)" },
  );
  // session has no status-right override
  applyPauseChrome("s1", true, t);
  assert.equal(
    t.getSessOpt("s1", "status-right"),
    `${CHROME_HINT_SLOT}%H:%M  #(gauges)`,
  );
  assert.equal(t.getSessOpt("s1", "@herald_chrome_from_global"), "1");
  clearPauseChrome("s1", t);
  // re-inherit global (unset session override)
  assert.equal(t.getSessOpt("s1", "status-right"), "");
});

test("pause/resume wire chrome glyph via session adapter", () => {
  const t = makeT({
    s1: {
      opts: { "@herald_armed": "1", "@herald_covered": "1" },
      active: "@curtain",
      windows: { "@curtain": "_curtain", "@live": "main" },
    },
  });
  t.setSessOpt("s1", "@herald_live_win", "@live");
  pause("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_paused"), "1");
  assert.equal(t.getSessOpt("s1", "@herald_chrome_hint"), PAUSE_HINT);
  resume("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_paused"), "0");
  assert.equal(t.getSessOpt("s1", "@herald_chrome_hint"), "");
});

test("statusMenuTmuxArgs includes pause resume pet", () => {
  const args = statusMenuTmuxArgs("mysess", "/abs/bin/herald", "/usr/bin/node");
  assert.equal(args[0], "display-menu");
  assert.ok(args.includes("× off (pause)"));
  assert.ok(args.includes("▶ on (resume)"));
  assert.ok(args.includes("↻ pet"));
  const body = args.join(" ");
  assert.match(body, /curtain pause mysess/);
  assert.match(body, /curtain resume mysess/);
  assert.match(body, /curtain pet mysess/);
});

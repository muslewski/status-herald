import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOLDING_WIN,
  cover,
  onEvent,
  onFocusIn,
  onFocusOut,
  reveal,
} from "../lib/curtain/orchestrator.mjs";

// Fake tmux: opts store + window placement + focus flag + recorded swaps.
const fake = (init = {}) => {
  const opts = init.opts ?? {}; // { "%id": { "@herald_peer": "%9", ... } }
  const win = init.win ?? {}; // { "%id": "grid" | "_holding" }
  const focused = init.focused ?? new Set();
  const calls = { swaps: [], selects: [] };
  return {
    calls,
    getOpt: (p, n) => opts[p]?.[n] ?? "",
    setOpt: (p, n, v) => {
      opts[p] ??= {};
      opts[p][n] = String(v);
    },
    windowNameOf: (p) => win[p] ?? "grid",
    swapPanes: (s, d) => {
      const a = win[s];
      win[s] = win[d];
      win[d] = a;
      calls.swaps.push([s, d]);
    },
    selectPane: (p) => calls.selects.push(p),
    isFocused: (p) => focused.has(p),
  };
};

test("cover swaps live→holding when visible", () => {
  const t = fake({
    opts: { "%5": { "@herald_peer": "%9" } },
    win: { "%5": "grid", "%9": "_holding" },
  });
  cover("%5", t);
  assert.deepEqual(t.calls.swaps, [["%5", "%9"]]);
  assert.equal(t.windowNameOf("%5"), "_holding");
});

test("cover is a no-op when live already hidden", () => {
  const t = fake({
    opts: { "%5": { "@herald_peer": "%9" } },
    win: { "%5": "_holding", "%9": "grid" },
  });
  cover("%5", t);
  assert.equal(t.calls.swaps.length, 0);
});

test("reveal swaps live back and selects it", () => {
  const t = fake({
    opts: { "%9": { "@herald_peer": "%5" } },
    win: { "%5": "_holding", "%9": "grid" },
  });
  reveal("%9", t);
  assert.deepEqual(t.calls.swaps, [["%9", "%5"]]);
  assert.deepEqual(t.calls.selects, ["%5"]);
});

test("onEvent working stamps state+since and covers when unfocused", () => {
  const t = fake({
    opts: { "%5": { "@herald_peer": "%9" } },
    win: { "%5": "grid", "%9": "_holding" },
  });
  onEvent("%5", "working", 1000, t);
  assert.equal(t.getOpt("%5", "@herald_state"), "working");
  assert.equal(t.getOpt("%5", "@herald_since"), "1000");
  assert.equal(t.calls.swaps.length, 1);
});

test("onEvent does NOT cover the focused pane", () => {
  const t = fake({
    opts: { "%5": { "@herald_peer": "%9" } },
    win: { "%5": "grid", "%9": "_holding" },
    focused: new Set(["%5"]),
  });
  onEvent("%5", "working", 1000, t);
  assert.equal(t.getOpt("%5", "@herald_state"), "working");
  assert.equal(t.calls.swaps.length, 0);
});

test("onFocusIn reveals only for a curtain pane", () => {
  const t = fake({
    opts: {
      "%9": { "@herald_role": "curtain", "@herald_peer": "%5" },
      "%5": {},
    },
    win: { "%5": "_holding", "%9": "grid" },
  });
  onFocusIn("%9", t);
  assert.equal(t.calls.swaps.length, 1);
  onFocusIn("%5", t); // live pane → nothing
  assert.equal(t.calls.swaps.length, 1);
});

test("onFocusOut re-covers a working live pane", () => {
  const t = fake({
    opts: {
      "%5": {
        "@herald_role": "live",
        "@herald_state": "working",
        "@herald_peer": "%9",
      },
    },
    win: { "%5": "grid", "%9": "_holding" },
  });
  onFocusOut("%5", t);
  assert.equal(t.calls.swaps.length, 1);
});

test("onFocusOut ignores an idle live pane", () => {
  const t = fake({
    opts: {
      "%5": {
        "@herald_role": "live",
        "@herald_state": "idle",
        "@herald_peer": "%9",
      },
    },
    win: { "%5": "grid", "%9": "_holding" },
  });
  onFocusOut("%5", t);
  assert.equal(t.calls.swaps.length, 0);
});

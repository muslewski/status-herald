import assert from "node:assert/strict";
import { test } from "node:test";

import { tmuxColor, visibleWidth } from "../lib/render.mjs";

import {
  ROLES,
  gaugeRole,
  orderSegments,
  renderLine,
  roleColor,
} from "../lib/status/segments.mjs";

test("visibleWidth strips tmux markup (for status engine)", () => {
  assert.equal(visibleWidth("#[fg=colour46]hi#[default]"), 2);
});

test("tmuxColor wraps text with tmux fg and default reset", () => {
  assert.equal(tmuxColor("hi", "colour46"), "#[fg=colour46]hi#[default]");
});

test("roleColor tmux mode uses ROLES tmux color via tmuxColor", () => {
  assert.equal(roleColor("ok", "tmux")("x"), "#[fg=colour46]x#[default]");
});

test("roleColor ansi mode produces SGR via color helper", () => {
  const out = roleColor("dim", "ansi")("x");
  assert.ok(
    out.includes("\x1b[90m"),
    `expected ansi gray, got ${JSON.stringify(out)}`,
  );
});

test("roleColor plain is identity", () => {
  assert.equal(roleColor("ok", "plain")("x"), "x");
});

test("roleColor unknown role is identity (no throw)", () => {
  assert.equal(roleColor("bogus", "tmux")("hi"), "hi");
  assert.equal(roleColor("weird", "ansi")("hi"), "hi");
  assert.equal(roleColor(null, "plain")("hi"), "hi");
});

test("gaugeRole boundaries: <85 ok, [85,100) warn, [100,120) crit, >=120 over; non-finite ok", () => {
  assert.equal(gaugeRole(84), "ok");
  assert.equal(gaugeRole(85), "warn");
  assert.equal(gaugeRole(99), "warn");
  assert.equal(gaugeRole(100), "crit");
  assert.equal(gaugeRole(119), "crit");
  assert.equal(gaugeRole(120), "over");
  assert.equal(gaugeRole(Number.NaN), "ok");
  assert.equal(gaugeRole(Number.POSITIVE_INFINITY), "ok");
  assert.equal(gaugeRole(-5), "ok");
});

test("orderSegments enables via config, reorders by effective order, drops disabled", () => {
  const registry = {
    a: { enabled: true, order: 2 },
    b: { enabled: false, order: 1 },
    c: { enabled: true, order: 0 },
  };
  // flip b on, bump a later
  let out = orderSegments(registry, {
    segments: { b: { enabled: true }, a: { order: 5 } },
  });
  assert.deepEqual(
    out.map((s) => s.id),
    ["c", "b", "a"],
  );

  // config disabling c drops c (a remains enabled in base; b remains disabled)
  out = orderSegments(registry, { segments: { c: { enabled: false } } });
  assert.deepEqual(
    out.map((s) => s.id),
    ["a"],
  );
});

test("orderSegments shallow merges including priority, returns objects with id", () => {
  const registry = {
    x: { enabled: true, order: 10, priority: 3, foo: "bar" },
  };
  const out = orderSegments(registry, {
    segments: { x: { order: 0, priority: 99 } },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "x");
  assert.equal(out[0].enabled, true);
  assert.equal(out[0].order, 0);
  assert.equal(out[0].priority, 99);
  assert.equal(out[0].foo, "bar"); // from base
});

test("renderLine unlimited width returns all full texts joined (plain)", () => {
  const items = [
    { id: "a", text: "longone", role: "ok", priority: 10 },
    { id: "b", text: "short", role: "warn", priority: 5 },
  ];
  const out = renderLine(items, { mode: "plain", width: null, sep: "  " });
  assert.equal(out, "longone  short");
});

test("renderLine when fits within width uses full texts", () => {
  const items = [
    { id: "x", text: "abc", role: "ok", priority: 1 },
    { id: "y", text: "def", role: "ok", priority: 2 },
  ];
  const out = renderLine(items, { mode: "plain", width: 20, sep: "  " });
  assert.equal(out, "abc  def");
  assert.ok(visibleWidth(out) <= 20);
});

test("renderLine shorten uses short of lowest-priority item first", () => {
  const items = [
    { id: "hi", text: "HIGHPRI", short: "HI", role: "ok", priority: 100 },
    {
      id: "lo",
      text: "LOWPRIORITYLONG",
      short: "LO",
      role: "warn",
      priority: 1,
    },
  ];
  // width fits "HIGHPRI  LO" (7+2+2=11) but not full "HIGHPRI  LOWPRIORITYLONG"
  const out = renderLine(items, { mode: "plain", width: 12, sep: "  " });
  assert.equal(out, "HIGHPRI  LO");
});

test("renderLine drops lowest-priority items (rightmost on ties) until fits or 1 left", () => {
  const items = [
    { id: "p1", text: "A", role: "ok", priority: 10 },
    { id: "p2", text: "B", role: "ok", priority: 1 },
    { id: "p3", text: "C", role: "ok", priority: 1 },
  ];
  // very narrow: only highest (p1 prio10) should survive
  const out = renderLine(items, { mode: "plain", width: 1, sep: "  " });
  assert.equal(out, "A");
});

test("renderLine multi-drop tie-breaks rightmost-lowest first (deterministic)", () => {
  const items = [
    { id: "left", text: "X", role: "ok", priority: 5 },
    { id: "mid", text: "Y", role: "ok", priority: 1 },
    { id: "right", text: "Z", role: "ok", priority: 1 },
  ];
  // width fits only one char + margins, will drop lows; rightmost low (right) drops first
  // after drop right, still > , drop next low which is now mid, left "X"
  const out = renderLine(items, { mode: "plain", width: 1, sep: "  " });
  assert.equal(out, "X");
  // also assert order of survivors would preserve relative: if we had width that keeps two highest effective
});

test("renderLine width decisions are on plain text even in tmux mode; result markup width ok", () => {
  const items = [
    { id: "a", text: "foo", short: "f", role: "ok", priority: 10 },
    { id: "b", text: "barbarbar", short: "b", role: "warn", priority: 1 },
  ];
  const plainOut = renderLine(items, { mode: "plain", width: 5, sep: " " });
  const tmuxOut = renderLine(items, { mode: "tmux", width: 5, sep: " " });
  // drop decisions should match: b shortens or drops; here width=5 forces use short on b? "foo b" =5
  assert.equal(plainOut, "foo b");
  // tmux output has markup but its visible width must be <=5 and equal plain decision
  assert.equal(visibleWidth(tmuxOut), visibleWidth(plainOut));
  assert.ok(visibleWidth(tmuxOut) <= 5);
  // and contains the tmux markup for roles
  assert.match(tmuxOut, /#\[fg=colour46\]foo#\[/);
  assert.match(tmuxOut, /#\[fg=colour226\]b#\[/);
});

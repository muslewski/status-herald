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

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

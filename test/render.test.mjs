import assert from "node:assert/strict";
import { test } from "node:test";
import { clearScreen, color, padCenter, visibleWidth } from "../lib/render.mjs";

test("visibleWidth ignores SGR escapes", () => {
  assert.equal(visibleWidth("\x1b[31mabc\x1b[0m"), 3);
});

test("padCenter centers within width", () => {
  assert.equal(padCenter("ab", 6), "  ab  ");
});

test("padCenter returns text unchanged when wider than width", () => {
  assert.equal(padCenter("abcdef", 4), "abcdef");
});

test("color wraps with reset and omits when no codes", () => {
  assert.equal(color("x"), "x");
  assert.equal(color("x", { fg: "red" }), "\x1b[31mx\x1b[0m");
});

test("clearScreen emits CSI 2J and home", () => {
  assert.equal(clearScreen(), "\x1b[2J\x1b[H");
});

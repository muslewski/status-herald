import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearScreen,
  color,
  eraseLine,
  padCenter,
  visibleWidth,
} from "../lib/render.mjs";

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

test("color keeps named colors working", () => {
  assert.equal(color("x", { fg: "brightGreen" }), "\x1b[92mx\x1b[0m");
  assert.equal(color("x", { bg: "black" }), "\x1b[40mx\x1b[0m");
});

test("color accepts a raw numeric SGR code as fg", () => {
  assert.equal(color("x", { fg: 33 }), "\x1b[33mx\x1b[0m");
});

test("color accepts a raw SGR string (256-color) for bg", () => {
  assert.equal(color("x", { bg: "48;5;234" }), "\x1b[48;5;234mx\x1b[0m");
});

test("color ignores an unknown named token instead of throwing", () => {
  assert.equal(color("x", { fg: "chartreuse" }), "x");
});

test("eraseLine is the erase-to-end-of-line CSI", () => {
  assert.equal(eraseLine(), "\x1b[K");
});

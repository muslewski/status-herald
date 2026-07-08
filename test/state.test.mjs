import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, isState, formatElapsed, computeElapsed } from "../lib/curtain/state.mjs";

test("formatElapsed formats m:ss and h:mm:ss", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(42), "0:42");
  assert.equal(formatElapsed(125), "2:05");
  assert.equal(formatElapsed(3661), "1:01:01");
});

test("formatElapsed clamps bad input to 0:00", () => {
  assert.equal(formatElapsed(-5), "0:00");
  assert.equal(formatElapsed(NaN), "0:00");
});

test("computeElapsed subtracts and floors at 0", () => {
  assert.equal(computeElapsed(1100, 1000), 100);
  assert.equal(computeElapsed(1000, 1100), 0);
  assert.equal(computeElapsed(1000, 0), 0);
  assert.equal(computeElapsed(1000, "notnum"), 0);
});

test("isState validates", () => {
  assert.equal(isState("working"), true);
  assert.equal(isState(STATES.DONE), true);
  assert.equal(isState("bogus"), false);
});

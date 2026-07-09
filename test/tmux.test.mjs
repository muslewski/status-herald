import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArgs, parseFocus } from "../lib/curtain/tmux.mjs";

test("buildArgs.setOpt targets the pane", () => {
  assert.deepEqual(buildArgs.setOpt("%5", "@herald_state", "working"), [
    "set",
    "-p",
    "-t",
    "%5",
    "@herald_state",
    "working",
  ]);
});

test("buildArgs.swapPanes swaps source and target", () => {
  assert.deepEqual(buildArgs.swapPanes("%5", "%9"), [
    "swap-pane",
    "-s",
    "%5",
    "-t",
    "%9",
  ]);
});

test("parseFocus requires active pane, active window, attached client", () => {
  assert.equal(parseFocus("1,1,1"), true);
  assert.equal(parseFocus("0,1,1"), false);
  assert.equal(parseFocus("1,1,0"), false);
  assert.equal(parseFocus(""), false);
});

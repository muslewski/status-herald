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

test("buildArgs.getSessOpt reads a session-scoped option (no -p)", () => {
  assert.deepEqual(buildArgs.getSessOpt("syndcast", "@herald_state"), [
    "show",
    "-t",
    "syndcast",
    "-v",
    "@herald_state",
  ]);
});

test("buildArgs.setSessOpt sets a session-scoped option", () => {
  assert.deepEqual(buildArgs.setSessOpt("syndcast", "@herald_armed", 1), [
    "set",
    "-t",
    "syndcast",
    "@herald_armed",
    "1",
  ]);
});

test("buildArgs.activeWindowId reads the active window id", () => {
  assert.deepEqual(buildArgs.activeWindowId("syndcast"), [
    "display",
    "-p",
    "-t",
    "syndcast",
    "#{window_id}",
  ]);
});

test("buildArgs.newCardWindow creates a detached named window", () => {
  assert.deepEqual(
    buildArgs.newCardWindow("syndcast", "_curtain", "/x/loop.sh"),
    [
      "new-window",
      "-d",
      "-n",
      "_curtain",
      "-t",
      "syndcast:",
      "bash",
      "/x/loop.sh",
    ],
  );
});

test("buildArgs.selectWindow / killWindow target a window", () => {
  assert.deepEqual(buildArgs.selectWindow("@3"), ["select-window", "-t", "@3"]);
  assert.deepEqual(buildArgs.killWindow("syndcast:_curtain"), [
    "kill-window",
    "-t",
    "syndcast:_curtain",
  ]);
});

test("buildArgs.unsetSessOpt clears a session option with -u", () => {
  assert.deepEqual(buildArgs.unsetSessOpt("syndcast", "set-titles-string"), [
    "set",
    "-u",
    "-t",
    "syndcast",
    "set-titles-string",
  ]);
});

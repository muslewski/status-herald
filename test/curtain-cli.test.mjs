import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const run = (args, env) => {
  try {
    const stdout = execFileSync("node", ["bin/herald", ...args], { encoding: "utf8", env });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

test("herald curtain (no subcommand) prints usage to stderr, exit 1", () => {
  const { status, stderr } = run(["curtain"]);
  assert.equal(status, 1);
  assert.match(stderr, /usage: herald curtain/);
});

test("herald curtain bogus prints usage to stderr, exit 1", () => {
  const { status, stderr } = run(["curtain", "bogus"]);
  assert.equal(status, 1);
  assert.match(stderr, /usage: herald curtain/);
});

test("herald curtain status with no TMUX_PANE reports not in tmux, exit 0", () => {
  const env = { ...process.env };
  delete env.TMUX_PANE;
  const { status, stdout } = run(["curtain", "status"], env);
  assert.equal(status, 0);
  assert.match(stdout, /not in tmux/);
});

test("herald curtain focus-in with no pane arg is a safe no-op, exit 0", () => {
  const { status } = run(["curtain", "focus-in"]);
  assert.equal(status, 0);
});

test("herald curtain event with no pane/state is a safe no-op, exit 0", () => {
  const env = { ...process.env };
  delete env.TMUX_PANE;
  const { status } = run(["curtain", "event"], env);
  assert.equal(status, 0);
});

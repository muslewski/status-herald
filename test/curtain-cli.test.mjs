import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync as _mk,
  rmSync as _rm,
  writeFileSync as _wf,
} from "node:fs";
import { tmpdir as _td } from "node:os";
import { join as _j } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const run = (args, env) => {
  try {
    const stdout = execFileSync("node", ["bin/herald", ...args], {
      encoding: "utf8",
      env,
    });
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
  // env is a plain object handed to execFileSync's `env` option, which drops
  // undefined-valued keys before building the child environment — equivalent
  // to `delete` here (unlike the real process.env, which coerces to "undefined").
  env.TMUX_PANE = undefined;
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
  // see note above: undefined-valued keys are dropped by execFileSync's env normalization.
  env.TMUX_PANE = undefined;
  const { status } = run(["curtain", "event"], env);
  assert.equal(status, 0);
});

const BIN = fileURLToPath(new URL("../bin/herald", import.meta.url));
const runCli = (args, env = {}) =>
  execFileSync("node", [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, TMUX: "", TMUX_PANE: "", ...env },
  });

test("curtain focus outside tmux is hook-safe (exit 0, no throw)", () => {
  // listArmed returns [] with no tmux; focus is a no-op that must not throw.
  const out = runCli(["curtain", "focus", "Nothing"]);
  assert.equal(typeof out, "string");
});

test("curtain reveal-all outside tmux is hook-safe", () => {
  runCli(["curtain", "reveal-all"]);
});

test("curtain arm outside tmux is hook-safe", () => {
  runCli(["curtain", "arm"]);
});

test("unknown curtain subcommand still prints usage listing new verbs", () => {
  let out = "";
  try {
    execFileSync("node", [BIN, "curtain", "bogus"], { encoding: "utf8" });
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  assert.match(out, /arm/);
  assert.match(out, /focus/);
});

test("curtain arm no-ops (exit 0) when curtain.enabled=false", () => {
  const dir = _mk(_j(_td(), "herald-cfg-"));
  const p = _j(dir, "c.json");
  _wf(p, JSON.stringify({ curtain: { enabled: false } }));
  try {
    runCli(["curtain", "arm", "nope-sess"], { HERALD_CONFIG: p });
  } finally {
    _rm(dir, { recursive: true, force: true });
  }
});

test("curtain focus normalizes a [mosh] prefix before matching (no throw off-tmux)", () => {
  // Off tmux, listArmed() is empty so focus is a no-op; this asserts the
  // normalized path runs without throwing and exits cleanly.
  const out = runCli(["curtain", "focus", "[mosh] Something"]);
  assert.equal(typeof out, "string");
});

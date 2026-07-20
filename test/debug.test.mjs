import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  captureLogPath,
  captureOn,
  captureSentinel,
  debugLog,
  stateDir,
} from "../lib/curtain/debug.mjs";

let prevXdg;
let prevDbg;
let dir;

beforeEach(() => {
  prevXdg = process.env.XDG_STATE_HOME;
  prevDbg = process.env.HERALD_CURTAIN_DEBUG;
  dir = mkdtempSync(join(tmpdir(), "herald-state-"));
  process.env.XDG_STATE_HOME = dir;
  process.env.HERALD_CURTAIN_DEBUG = "";
});

afterEach(() => {
  if (prevXdg === undefined)
    Reflect.deleteProperty(process.env, "XDG_STATE_HOME");
  else process.env.XDG_STATE_HOME = prevXdg;
  if (prevDbg === undefined)
    Reflect.deleteProperty(process.env, "HERALD_CURTAIN_DEBUG");
  else process.env.HERALD_CURTAIN_DEBUG = prevDbg;
});

test("stateDir honors XDG_STATE_HOME", () => {
  assert.equal(stateDir(), join(dir, "status-herald"));
});

test("capture is off by default, and debugLog writes nothing", () => {
  assert.equal(captureOn(), false);
  debugLog({ event: "Stop" });
  assert.throws(() => readFileSync(captureLogPath(), "utf8"));
});

test("HERALD_CURTAIN_DEBUG turns capture on", () => {
  process.env.HERALD_CURTAIN_DEBUG = "1";
  assert.equal(captureOn(), true);
  debugLog({ event: "Stop", subagents: 2 });
  const line = readFileSync(captureLogPath(), "utf8").trim();
  assert.deepEqual(JSON.parse(line), { event: "Stop", subagents: 2 });
});

test("a sentinel file turns capture on for already-running sessions", () => {
  // The env is fixed for a running agent's hooks; a file check is not.
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(captureSentinel(), "");
  assert.equal(captureOn(), true);
});

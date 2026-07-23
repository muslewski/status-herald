import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  commandsForBackends,
  fireSound,
  normalizeSoundCfg,
  notifyOnNeedsEdge,
  patchSoundConfig,
  readSoundStatus,
  shellQuote,
  shouldFireSound,
  soundDoctorLine,
} from "../lib/curtain/sound.mjs";
import { STATES } from "../lib/curtain/state.mjs";

const baseCfg = (over = {}) =>
  normalizeSoundCfg({
    enabled: true,
    mode: "day",
    events: ["needs"],
    onlyWhenCovered: false,
    dedupeSec: 8,
    backends: [{ type: "command", day: "echo day", night: "echo night" }],
    ...over,
  });

test("normalizeSoundCfg defaults and clamps mode", () => {
  const n = normalizeSoundCfg(undefined);
  assert.equal(n.enabled, false);
  assert.equal(n.mode, "day");
  assert.deepEqual(n.events, ["needs"]);
  assert.equal(n.backends.length, 0);
  assert.equal(normalizeSoundCfg({ mode: "NOPE" }).mode, "day");
  assert.equal(normalizeSoundCfg({ mode: "night" }).mode, "night");
});

test("shouldFireSound: disabled / mode off / empty backends", () => {
  assert.equal(
    shouldFireSound(baseCfg({ enabled: false }), {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
    }),
    false,
  );
  assert.equal(
    shouldFireSound(baseCfg({ mode: "off" }), {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
    }),
    false,
  );
  assert.equal(
    shouldFireSound(baseCfg({ backends: [] }), {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
    }),
    false,
  );
});

test("shouldFireSound: only NEEDS edge", () => {
  assert.equal(
    shouldFireSound(baseCfg(), {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
    }),
    true,
  );
  assert.equal(
    shouldFireSound(baseCfg(), {
      prevState: STATES.NEEDS,
      nextState: STATES.NEEDS,
    }),
    false,
  );
  assert.equal(
    shouldFireSound(baseCfg(), {
      prevState: STATES.WORKING,
      nextState: STATES.DONE,
    }),
    false,
  );
  assert.equal(
    shouldFireSound(baseCfg(), {
      prevState: STATES.IDLE,
      nextState: STATES.WORKING,
    }),
    false,
  );
});

test("shouldFireSound: onlyWhenCovered and dedupe", () => {
  assert.equal(
    shouldFireSound(baseCfg({ onlyWhenCovered: true }), {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
      covered: false,
    }),
    false,
  );
  assert.equal(
    shouldFireSound(baseCfg({ onlyWhenCovered: true }), {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
      covered: true,
    }),
    true,
  );
  assert.equal(
    shouldFireSound(baseCfg({ dedupeSec: 10 }), {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
      nowSec: 100,
      lastFireSec: 95,
    }),
    false,
  );
  assert.equal(
    shouldFireSound(baseCfg({ dedupeSec: 10 }), {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
      nowSec: 100,
      lastFireSec: 80,
    }),
    true,
  );
});

test("commandsForBackends: command, local, ssh, ntfy", () => {
  const day = commandsForBackends(
    [
      { type: "command", day: "paplay ding.wav", night: "paplay loud.wav" },
      { type: "local", day: "printf x", night: "" },
      {
        type: "ssh",
        host: "mac-music",
        day: "afplay /System/Library/Sounds/Glass.aiff",
        night: "afplay loud.aiff",
      },
      {
        type: "ntfy",
        topic: "my-topic",
        title: "Herald",
        body: "needs you",
      },
      { type: "ssh", host: "", day: "nope" },
      { type: "command", day: "", night: "only-night" },
    ],
    "day",
  );
  assert.equal(day[0], "paplay ding.wav");
  assert.equal(day[1], "printf x");
  assert.match(day[2], /^ssh -o BatchMode=yes -o ConnectTimeout=3 mac-music -- /);
  assert.match(day[2], /afplay/);
  assert.match(day[3], /ntfy\.sh\/my-topic/);
  assert.equal(day.length, 4);

  const night = commandsForBackends(
    [{ type: "command", day: "d", night: "n" }],
    "night",
  );
  assert.deepEqual(night, ["n"]);
});

test("shellQuote escapes spaces and quotes", () => {
  assert.equal(shellQuote("mac-music"), "mac-music");
  assert.equal(shellQuote("a b"), "'a b'");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("fireSound spawns sh -c per command and records onFired", () => {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  };
  let last = 0;
  const r = fireSound(
    baseCfg(),
    {
      prevState: STATES.WORKING,
      nextState: STATES.NEEDS,
      nowSec: 50,
    },
    { spawn, onFired: (s) => (last = s) },
  );
  assert.equal(r.fired, true);
  assert.equal(r.commands.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "sh");
  assert.deepEqual(calls[0].args, ["-c", "echo day"]);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(last, 50);
});

test("fireSound never throws when spawn throws", () => {
  const r = fireSound(
    baseCfg(),
    { prevState: STATES.IDLE, nextState: STATES.NEEDS, nowSec: 1 },
    {
      spawn: () => {
        throw new Error("boom");
      },
    },
  );
  // spawn threw per-command; still returns fired true if we attempted
  assert.equal(r.fired, true);
});

test("fireSound force (test) skips policy edge but not mode off", () => {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push(args);
    return { unref() {} };
  };
  const r = fireSound(
    baseCfg(),
    { force: true, prevState: STATES.NEEDS, nextState: STATES.NEEDS },
    { spawn },
  );
  assert.equal(r.fired, true);
  assert.equal(calls.length, 1);

  const off = fireSound(
    baseCfg({ mode: "off" }),
    { force: true },
    { spawn },
  );
  assert.equal(off.fired, false);
});

test("notifyOnNeedsEdge sets last fire only when fired", () => {
  let stamped = null;
  const r = notifyOnNeedsEdge({
    soundCfg: baseCfg(),
    prevState: STATES.WORKING,
    nextState: STATES.NEEDS,
    covered: false,
    nowSec: 9,
    lastFireSec: 0,
    setLastFire: (s) => (stamped = s),
    spawn: () => ({ unref() {} }),
  });
  assert.equal(r.fired, true);
  assert.equal(stamped, 9);

  stamped = null;
  const r2 = notifyOnNeedsEdge({
    soundCfg: baseCfg(),
    prevState: STATES.NEEDS,
    nextState: STATES.NEEDS,
    covered: false,
    nowSec: 10,
    lastFireSec: 9,
    setLastFire: (s) => (stamped = s),
    spawn: () => ({ unref() {} }),
  });
  assert.equal(r2.fired, false);
  assert.equal(stamped, null);
});

test("patchSoundConfig creates and merges without clobber", () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-sound-"));
  const p = join(dir, "config.json");
  writeFileSync(
    p,
    JSON.stringify({ curtain: { theme: "forge", sound: { mode: "day" } } }),
  );
  try {
    const r = patchSoundConfig({ enabled: true, mode: "night" }, p);
    assert.equal(r.ok, true);
    const j = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(j.curtain.theme, "forge");
    assert.equal(j.curtain.sound.enabled, true);
    assert.equal(j.curtain.sound.mode, "night");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("patchSoundConfig creates missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-sound-"));
  const p = join(dir, "nested", "config.json");
  try {
    const r = patchSoundConfig({ enabled: false, mode: "off" }, p);
    assert.equal(r.ok, true);
    assert.equal(existsSync(p), true);
    const j = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(j.curtain.sound.mode, "off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readSoundStatus and soundDoctorLine", () => {
  assert.equal(readSoundStatus(baseCfg({ enabled: false })).silent, true);
  assert.equal(readSoundStatus(baseCfg()).silent, false);
  assert.match(soundDoctorLine({ enabled: false }).detail, /off/);
  assert.equal(soundDoctorLine(baseCfg({ backends: [] })).ok, false);
  assert.match(
    soundDoctorLine(
      baseCfg({
        backends: [{ type: "ssh", host: "mac-music", day: "x" }],
      }),
    ).detail,
    /ssh:mac-music/,
  );
});

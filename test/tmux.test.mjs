import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildArgs,
  parseFocus,
  parseSnapshot,
  parseWindowMap,
} from "../lib/curtain/tmux.mjs";

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

test("buildArgs.snapshot lists sessions with the curtain-state format", () => {
  const a = buildArgs.snapshot();
  assert.equal(a[0], "list-sessions");
  assert.equal(a[1], "-F");
  // One tab-joined format carrying everything focus() needs per session.
  for (const f of [
    "#{session_name}",
    "#{@herald_armed}",
    "#{@herald_covered}",
    "#{@herald_state}",
    "#{@herald_live_win}",
    "#{window_id}",
    "#{@herald_paused}",
  ])
    assert.ok(a[2].includes(f), `format missing ${f}`);
  assert.equal(a[2].split("\t").length, 7, "seven tab-separated fields");
});

test("buildArgs.windowMap lists every window id and name across sessions", () => {
  assert.deepEqual(buildArgs.windowMap(), [
    "list-windows",
    "-a",
    "-F",
    "#{window_id}\t#{window_name}",
  ]);
});

test("parseSnapshot keeps only armed sessions and splits their fields", () => {
  const raw = [
    "hermes\t1\t1\tworking\t@22\t@98\t1",
    "token-oracle\t1\t0\tdone\t@41\t@41\t0",
    "legacy\t1\t0\tidle\t@7\t@7", // 6-field back-compat → paused false
    "token-oracle-2\t\t\t\t\t@81", // not armed -> dropped
  ].join("\n");
  assert.deepEqual(parseSnapshot(raw), [
    {
      name: "hermes",
      covered: true,
      state: "working",
      liveWin: "@22",
      activeWin: "@98",
      paused: true,
    },
    {
      name: "token-oracle",
      covered: false,
      state: "done",
      liveWin: "@41",
      activeWin: "@41",
      paused: false,
    },
    {
      name: "legacy",
      covered: false,
      state: "idle",
      liveWin: "@7",
      activeWin: "@7",
      paused: false,
    },
  ]);
});

test("parseSnapshot returns [] for empty or missing input", () => {
  assert.deepEqual(parseSnapshot(""), []);
  assert.deepEqual(parseSnapshot(null), []);
});

test("parseWindowMap builds an id->name map, names may hold spaces", () => {
  const raw =
    "@22\tHermes\n@39\tagentic sage\n@37\tSyndcast ADVISOR PLANS\n@98\t_curtain";
  assert.deepEqual(parseWindowMap(raw), {
    "@22": "Hermes",
    "@39": "agentic sage",
    "@37": "Syndcast ADVISOR PLANS",
    "@98": "_curtain",
  });
});

test("parseWindowMap returns {} for empty or missing input", () => {
  assert.deepEqual(parseWindowMap(""), {});
  assert.deepEqual(parseWindowMap(null), {});
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardRowFromOpts,
  renderMiniCard,
  renderSessionDetail,
  renderStageBoard,
  runInspect,
} from "../lib/curtain/inspect.mjs";

const NOW = 10_000;

const optsWorking = {
  "@herald_state": "working",
  "@herald_covered": "1",
  "@herald_host_kind": "hybrid",
  "@herald_theme": "forge",
  "@herald_since": String(NOW - 125),
  "@herald_last_hook": String(NOW - 12),
  "@herald_last_active": String(NOW - 5),
  // 2 subagents, 1 shell, 1 watcher(monitor), 1 turn
  "@herald_leases": [
    `subagent:a:${NOW + 100}`,
    `subagent:b:${NOW + 100}`,
    `bg_shell:sh1:${NOW + 100}`,
    `watcher:mon1:${NOW + 100}`,
    `turn:t1:${NOW + 50}`,
  ].join(","),
};

const optsDone = {
  "@herald_state": "done",
  "@herald_covered": "0",
  "@herald_host_kind": "synthesis",
  "@herald_theme": "classic",
  "@herald_since": String(NOW - 340),
  "@herald_worked": "90",
  "@herald_last_hook": String(NOW - 40),
  "@herald_last_active": String(NOW - 40),
  "@herald_leases": `watcher:w1:${NOW + 200}`,
};

test("boardRowFromOpts: lease counts by kind (shells/monitors/subagents)", () => {
  const row = boardRowFromOpts("muslewski", optsWorking, NOW);
  assert.equal(row.name, "muslewski");
  assert.equal(row.state, "working");
  assert.equal(row.glyph, "●");
  assert.equal(row.covered, true);
  assert.equal(row.subagents, 2);
  assert.equal(row.shells, 1);
  assert.equal(row.monitors, 1);
  assert.equal(row.turns, 1);
  assert.equal(row.elapsedSec, 125);
  assert.equal(row.hookAgeSec, 12);
});

test("boardRowFromOpts: expired leases do not count", () => {
  const row = boardRowFromOpts(
    "x",
    {
      "@herald_state": "working",
      "@herald_leases": `subagent:dead:${NOW - 1},bg_shell:live:${NOW + 9}`,
    },
    NOW,
  );
  assert.equal(row.subagents, 0);
  assert.equal(row.shells, 1);
  assert.equal(row.monitors, 0);
});

test("boardRowFromOpts: state glyphs for needs/done/idle/compacting", () => {
  assert.equal(boardRowFromOpts("a", { "@herald_state": "needs" }, NOW).glyph, "⚠");
  assert.equal(boardRowFromOpts("a", { "@herald_state": "done" }, NOW).glyph, "✅");
  assert.equal(boardRowFromOpts("a", { "@herald_state": "idle" }, NOW).glyph, "—");
  assert.equal(
    boardRowFromOpts("a", { "@herald_state": "compacting" }, NOW).glyph,
    "⟳",
  );
});

test("renderMiniCard: one line with glyph, kind counts, age", () => {
  const row = boardRowFromOpts("muslewski", optsWorking, NOW);
  const line = renderMiniCard(row);
  assert.match(line, /muslewski/);
  assert.match(line, /●/);
  assert.match(line, /WORKING/i);
  assert.match(line, /2:05/);
  assert.match(line, /shells\s*1/);
  assert.match(line, /monitors\s*1/);
  assert.match(line, /subagents\s*2/);
  assert.match(line, /cover/);
  assert.match(line, /12s/);
});

test("renderStageBoard: banner + mini-card per session (non-TTY plain)", () => {
  const rows = [
    boardRowFromOpts("muslewski", optsWorking, NOW),
    boardRowFromOpts("status-h", optsDone, NOW),
  ];
  const out = renderStageBoard(rows);
  assert.match(out, /HERALD STAGE/);
  assert.match(out, /2 armed/);
  assert.match(out, /1 covered/);
  assert.match(out, /muslewski/);
  assert.match(out, /status-h/);
  assert.match(out, /✅/);
  assert.match(out, /monitors\s*1/); // done still has watcher
  // no dense key=value slab
  assert.doesNotMatch(out, /state=working/);
  assert.doesNotMatch(out, /subs=/);
});

test("renderStageBoard: empty sessions message", () => {
  const out = renderStageBoard([]);
  assert.match(out, /no armed sessions/i);
});

test("renderSessionDetail: full lease + age fields", () => {
  const row = boardRowFromOpts("muslewski", optsWorking, NOW);
  const detail = renderSessionDetail(row, optsWorking, NOW);
  assert.match(detail, /muslewski/);
  assert.match(detail, /state\s+working/);
  assert.match(detail, /host\s+hybrid/);
  assert.match(detail, /shells\s+1/);
  assert.match(detail, /monitors\s+1/);
  assert.match(detail, /subagents\s+2/);
  assert.match(detail, /last-hook/);
  assert.match(detail, /last-active/);
  assert.match(detail, /subagent:a:/);
});

test("runInspect non-TTY: plain stage board only (no fzf)", () => {
  const get = (name, k) => {
    if (name === "a") return optsWorking[k] ?? "";
    if (name === "b") return optsDone[k] ?? "";
    return "";
  };
  const { text, exitCode, picked } = runInspect({
    names: ["a", "b"],
    getSessOpt: get,
    nowSec: NOW,
    tty: false,
    fzfAvailable: true, // must still skip fzf when non-TTY
    fzfPick: () => {
      throw new Error("fzf must not run non-TTY");
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(picked, null);
  assert.match(text, /HERALD STAGE/);
  assert.match(text, /\ba\b/);
  assert.match(text, /\bb\b/);
  assert.match(text, /shells\s*1/);
  assert.match(text, /subagents\s*2/);
});

test("runInspect with named session: detail only", () => {
  const get = (_n, k) => optsWorking[k] ?? "";
  const { text, exitCode } = runInspect({
    names: ["muslewski"],
    getSessOpt: get,
    nowSec: NOW,
    sessionArg: "muslewski",
    tty: false,
    fzfAvailable: false,
  });
  assert.equal(exitCode, 0);
  assert.match(text, /muslewski/);
  assert.match(text, /state\s+working/);
  assert.doesNotMatch(text, /HERALD STAGE/);
});

test("runInspect TTY+fzf: board then drill-in detail for pick", () => {
  const get = (name, k) => {
    if (name === "a") return optsWorking[k] ?? "";
    if (name === "b") return optsDone[k] ?? "";
    return "";
  };
  let offered = null;
  const { text, exitCode, picked } = runInspect({
    names: ["a", "b"],
    getSessOpt: get,
    nowSec: NOW,
    tty: true,
    fzfAvailable: true,
    fzfPick: (lines) => {
      offered = lines;
      return "a";
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(picked, "a");
  assert.ok(Array.isArray(offered));
  assert.ok(offered.some((l) => l.includes("a")));
  // full output includes board + selected detail
  assert.match(text, /HERALD STAGE/);
  assert.match(text, /state\s+working/);
  assert.match(text, /subagents\s+2/);
});

test("runInspect TTY+fzf cancel: board only, exit 0", () => {
  const get = (_n, k) => optsWorking[k] ?? "";
  const { text, exitCode, picked } = runInspect({
    names: ["solo"],
    getSessOpt: get,
    nowSec: NOW,
    tty: true,
    fzfAvailable: true,
    fzfPick: () => "", // cancel
  });
  assert.equal(exitCode, 0);
  assert.equal(picked, null);
  assert.match(text, /HERALD STAGE/);
  assert.doesNotMatch(text, /state\s+working\n/);
});

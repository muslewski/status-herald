import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { onEvent, onFocusIn } from "../lib/curtain/orchestrator.mjs";
import { getOpt, windowNameOf } from "../lib/curtain/tmux.mjs";

const hasTmux = () => {
  try {
    execFileSync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
};
const S = "herald_it";
const tt = (a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();

const buildGrid = () => {
  try {
    tt(["kill-session", "-t", S]);
  } catch {}
  tt(["new-session", "-d", "-s", S, "-n", "grid", "sleep 1000"]);
  tt(["split-window", "-h", "-t", `${S}:grid`, "sleep 1000"]);
  tt(["select-layout", "-t", `${S}:grid`, "even-horizontal"]);
  tt(["new-window", "-d", "-n", "_holding", "-t", `${S}:`, "sleep 1000"]);
  tt(["split-window", "-h", "-t", `${S}:_holding`, "sleep 1000"]);
  tt(["select-layout", "-t", `${S}:_holding`, "even-horizontal"]);
  const live = tt(["list-panes", "-t", `${S}:grid`, "-F", "#{pane_id}"]).split(
    "\n",
  );
  const cur = tt([
    "list-panes",
    "-t",
    `${S}:_holding`,
    "-F",
    "#{pane_id}",
  ]).split("\n");
  tt(["set", "-p", "-t", live[0], "@herald_role", "live"]);
  tt(["set", "-p", "-t", live[0], "@herald_peer", cur[0]]);
  tt(["set", "-p", "-t", cur[0], "@herald_role", "curtain"]);
  tt(["set", "-p", "-t", cur[0], "@herald_peer", live[0]]);
  return { live: live[0], cur: cur[0] };
};

test(
  "event working covers an unfocused live pane; focus-in reveals it",
  { skip: !hasTmux() },
  () => {
    // Without this the whole test drives the developer's real tmux server.
    const origTmpdir = process.env.TMUX_TMPDIR;
    const origTmux = process.env.TMUX;
    const dir = mkdtempSync(join(tmpdir(), "herald-grid-"));
    process.env.TMUX_TMPDIR = dir;
    // biome-ignore lint/performance/noDelete: env must be truly unset; `= undefined` coerces to the string "undefined".
    delete process.env.TMUX;

    try {
      const { live, cur } = buildGrid();
      // detached session → not focused → cover
      onEvent(live, "working", 1000);
      assert.equal(getOpt(live, "@herald_state"), "working");
      assert.equal(windowNameOf(live), "_holding", "live swapped into holding");
      assert.equal(windowNameOf(cur), "grid", "curtain swapped into grid");
      // focusing the curtain pane reveals the live session
      onFocusIn(cur);
      assert.equal(windowNameOf(live), "grid", "live revealed back to grid");
    } finally {
      try {
        execFileSync("tmux", ["kill-server"], { stdio: "ignore" });
      } catch {}
      // biome-ignore lint/performance/noDelete: restore a possibly-unset var.
      if (origTmpdir === undefined) delete process.env.TMUX_TMPDIR;
      else process.env.TMUX_TMPDIR = origTmpdir;
      // biome-ignore lint/performance/noDelete: restore a possibly-unset var.
      if (origTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = origTmux;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

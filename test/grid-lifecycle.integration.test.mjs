import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gridDown, gridUp } from "../lib/curtain/grid.mjs";
import { getOpt } from "../lib/curtain/tmux.mjs";

const hasTmux = () => {
  try {
    execFileSync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
};
const tt = (a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();

test(
  "gridUp/gridDown lifecycle on an isolated tmux server",
  { skip: !hasTmux() },
  () => {
    const origTmpdir = process.env.TMUX_TMPDIR;
    const origTmux = process.env.TMUX;
    const dir = mkdtempSync(join(tmpdir(), "herald-tmux-"));
    process.env.TMUX_TMPDIR = dir;
    // biome-ignore lint/performance/noDelete: process.env coerces `= undefined` to the string "undefined" instead of unsetting it; delete is required to truly simulate "outside tmux".
    delete process.env.TMUX;

    try {
      // --- gridUp: bring up a 2-slot grid, panes run `sleep 1000` (never real claude) ---
      const rc = gridUp({ slots: 2, cmd: "sleep 1000" });
      assert.equal(rc, 0, "gridUp should return 0");

      const live = tt(["list-panes", "-t", "grid:grid", "-F", "#{pane_id}"])
        .split("\n")
        .filter(Boolean);
      const cur = tt(["list-panes", "-t", "grid:_holding", "-F", "#{pane_id}"])
        .split("\n")
        .filter(Boolean);
      assert.equal(live.length, 2, "grid window should have exactly 2 panes");
      assert.equal(
        cur.length,
        2,
        "_holding window should have exactly 2 panes",
      );

      // --- role stamping ---
      assert.equal(getOpt(live[0], "@herald_role"), "live");
      assert.equal(getOpt(live[1], "@herald_role"), "live");
      assert.equal(getOpt(cur[0], "@herald_role"), "curtain");
      assert.equal(getOpt(cur[1], "@herald_role"), "curtain");

      // --- reciprocal pairing (assert at least the first pair) ---
      assert.equal(
        getOpt(live[0], "@herald_peer"),
        cur[0],
        "live0's peer should be cur0",
      );
      assert.equal(
        getOpt(cur[0], "@herald_peer"),
        live[0],
        "cur0's peer should be live0",
      );

      // --- idempotency: calling gridUp again should not add panes ---
      const rc2 = gridUp({ slots: 2, cmd: "sleep 1000" });
      assert.equal(rc2, 0, "second gridUp should return 0");
      const liveAfter = tt([
        "list-panes",
        "-t",
        "grid:grid",
        "-F",
        "#{pane_id}",
      ])
        .split("\n")
        .filter(Boolean);
      const curAfter = tt([
        "list-panes",
        "-t",
        "grid:_holding",
        "-F",
        "#{pane_id}",
      ])
        .split("\n")
        .filter(Boolean);
      assert.equal(
        liveAfter.length,
        2,
        "grid window should still have exactly 2 panes after idempotent gridUp",
      );
      assert.equal(
        curAfter.length,
        2,
        "_holding window should still have exactly 2 panes after idempotent gridUp",
      );

      // --- gridDown: session must be gone ---
      const rcDown = gridDown();
      assert.equal(rcDown, 0, "gridDown should return 0");

      let alive = false;
      try {
        tt(["has-session", "-t", "grid"]);
        alive = true;
      } catch {
        // expected: has-session fails once the session is torn down
      }
      assert.equal(alive, false, "grid session should be gone after gridDown");
    } finally {
      try {
        execFileSync("tmux", ["kill-server"], { stdio: "ignore" });
      } catch {}
      // biome-ignore lint/performance/noDelete: process.env coerces `= undefined` to the string "undefined" instead of unsetting it; delete is required to fully restore an originally-unset var.
      if (origTmpdir === undefined) delete process.env.TMUX_TMPDIR;
      else process.env.TMUX_TMPDIR = origTmpdir;
      // biome-ignore lint/performance/noDelete: same as above — restoring a previously-unset process.env var requires delete, not `= undefined`.
      if (origTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = origTmux;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

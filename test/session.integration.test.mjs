import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  arm,
  cover,
  focus,
  reveal,
  revealAll,
} from "../lib/curtain/session.mjs";
import { getSessOpt, setSessOpt } from "../lib/curtain/tmux.mjs";

const hasTmux = () => {
  try {
    execFileSync("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
};
const tt = (a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();
const activeWin = (s) => tt(["display", "-p", "-t", s, "#{window_name}"]);

test(
  "per-session cover/reveal/focus cycle on an isolated tmux server",
  { skip: !hasTmux() },
  () => {
    const origTmpdir = process.env.TMUX_TMPDIR;
    const origTmux = process.env.TMUX;
    const dir = mkdtempSync(join(tmpdir(), "herald-sess-"));
    process.env.TMUX_TMPDIR = dir;
    // biome-ignore lint/performance/noDelete: env must be truly unset to look "outside tmux".
    delete process.env.TMUX;
    try {
      // Two sessions, each a "live" window named like an agent label.
      tt([
        "new-session",
        "-d",
        "-s",
        "s1",
        "-n",
        "Syndcast Backlog",
        "sleep 1000",
      ]);
      tt(["new-session", "-d", "-s", "s2", "-n", "Sage Run", "sleep 1000"]);

      arm("s1");
      arm("s2");
      assert.equal(getSessOpt("s1", "@herald_armed"), "1");
      assert.equal(
        activeWin("s1"),
        "Syndcast Backlog",
        "arm leaves live window active",
      );

      // cover requires a coverable state
      setSessOpt("s1", "@herald_state", "working");
      setSessOpt("s2", "@herald_state", "working");
      cover("s1");
      assert.equal(activeWin("s1"), "_curtain", "s1 covered");
      reveal("s1");
      assert.equal(activeWin("s1"), "Syndcast Backlog", "s1 revealed");

      // focus s1's label: reveal s1, cover s2
      cover("s1");
      focus("Syndcast Backlog");
      assert.equal(
        activeWin("s1"),
        "Syndcast Backlog",
        "focus revealed the match",
      );
      assert.equal(activeWin("s2"), "_curtain", "focus covered the rest");

      // reveal-all clears everything
      revealAll();
      assert.equal(activeWin("s1"), "Syndcast Backlog");
      assert.equal(activeWin("s2"), "Sage Run");

      // idle session is never covered by focus
      setSessOpt("s2", "@herald_state", "idle");
      focus("Syndcast Backlog");
      assert.equal(activeWin("s2"), "Sage Run", "idle stays live");
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

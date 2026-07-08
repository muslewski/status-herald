import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { onEvent, onFocusIn } from "../lib/curtain/orchestrator.mjs";
import { windowNameOf, getOpt } from "../lib/curtain/tmux.mjs";

const hasTmux = () => { try { execFileSync("tmux", ["-V"]); return true; } catch { return false; } };
const S = "herald_it";
const tt = (a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();

const buildGrid = () => {
  try { tt(["kill-session", "-t", S]); } catch {}
  tt(["new-session", "-d", "-s", S, "-n", "grid", "sleep 1000"]);
  tt(["split-window", "-h", "-t", `${S}:grid`, "sleep 1000"]);
  tt(["select-layout", "-t", `${S}:grid`, "even-horizontal"]);
  tt(["new-window", "-d", "-n", "_holding", "-t", `${S}:`, "sleep 1000"]);
  tt(["split-window", "-h", "-t", `${S}:_holding`, "sleep 1000"]);
  tt(["select-layout", "-t", `${S}:_holding`, "even-horizontal"]);
  const live = tt(["list-panes", "-t", `${S}:grid`, "-F", "#{pane_id}"]).split("\n");
  const cur = tt(["list-panes", "-t", `${S}:_holding`, "-F", "#{pane_id}"]).split("\n");
  tt(["set", "-p", "-t", live[0], "@herald_role", "live"]);
  tt(["set", "-p", "-t", live[0], "@herald_peer", cur[0]]);
  tt(["set", "-p", "-t", cur[0], "@herald_role", "curtain"]);
  tt(["set", "-p", "-t", cur[0], "@herald_peer", live[0]]);
  return { live: live[0], cur: cur[0] };
};

test("event working covers an unfocused live pane; focus-in reveals it", { skip: !hasTmux() }, () => {
  const { live, cur } = buildGrid();
  try {
    // detached session → not focused → cover
    onEvent(live, "working", 1000);
    assert.equal(getOpt(live, "@herald_state"), "working");
    assert.equal(windowNameOf(live), "_holding", "live swapped into holding");
    assert.equal(windowNameOf(cur), "grid", "curtain swapped into grid");
    // focusing the curtain pane reveals the live session
    onFocusIn(cur);
    assert.equal(windowNameOf(live), "grid", "live revealed back to grid");
  } finally {
    tt(["kill-session", "-t", S]);
  }
});

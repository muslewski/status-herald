import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setOpt } from "./tmux.mjs";

const SESSION = "grid";
const HOLDING = "_holding";
const LOOP = fileURLToPath(new URL("../../scripts/curtain-card-loop.sh", import.meta.url));

const t = (args) => {
  try { return execFileSync("tmux", args, { encoding: "utf8" }).trim(); }
  catch { return null; }
};

export const gridUp = ({ slots = 2, cmd = "claude" } = {}) => {
  const n = Number(slots) || 2;
  if (t(["has-session", "-t", SESSION]) !== null) { process.stdout.write("grid already up\n"); return 0; }

  t(["new-session", "-d", "-s", SESSION, "-n", "grid", cmd]);
  for (let i = 1; i < n; i++) t(["split-window", "-h", "-t", `${SESSION}:grid`, cmd]);
  t(["select-layout", "-t", `${SESSION}:grid`, "even-horizontal"]);

  t(["new-window", "-d", "-n", HOLDING, "-t", `${SESSION}:`, "bash", LOOP]);
  for (let i = 1; i < n; i++) t(["split-window", "-h", "-t", `${SESSION}:${HOLDING}`, "bash", LOOP]);
  t(["select-layout", "-t", `${SESSION}:${HOLDING}`, "even-horizontal"]);

  const live = (t(["list-panes", "-t", `${SESSION}:grid`, "-F", "#{pane_id}"]) || "").split("\n").filter(Boolean);
  const cur = (t(["list-panes", "-t", `${SESSION}:${HOLDING}`, "-F", "#{pane_id}"]) || "").split("\n").filter(Boolean);
  const pairs = Math.min(live.length, cur.length);
  for (let i = 0; i < pairs; i++) {
    setOpt(live[i], "@herald_role", "live");
    setOpt(live[i], "@herald_slot", i);
    setOpt(live[i], "@herald_peer", cur[i]);
    setOpt(live[i], "@herald_state", "idle");
    setOpt(cur[i], "@herald_role", "curtain");
    setOpt(cur[i], "@herald_slot", i);
    setOpt(cur[i], "@herald_peer", live[i]);
    setOpt(cur[i], "@herald_state", "idle");
  }

  t(["set", "-g", "mouse", "on"]);
  t(["set", "-g", "focus-events", "on"]);
  t(["set-hook", "-g", "pane-focus-in", 'run-shell "herald curtain focus-in #{pane_id}"']);
  t(["set-hook", "-g", "pane-focus-out", 'run-shell "herald curtain focus-out #{pane_id}"']);

  process.stdout.write(`grid up: ${pairs} slots\n`);
  return 0;
};

export const gridDown = () => { t(["kill-session", "-t", SESSION]); process.stdout.write("grid down\n"); return 0; };

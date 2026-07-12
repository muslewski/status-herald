import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setOpt } from "./tmux.mjs";

const SESSION = "grid";
const HOLDING = "_holding";
const LOOP = fileURLToPath(
  new URL("../../scripts/curtain-card-loop.sh", import.meta.url),
);

const t = (args) => {
  try {
    return execFileSync("tmux", args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

export const gridUp = ({ slots = 2, cmd } = {}) => {
  // Auto-detect a sensible default for the common case (Grok users in tmux
  // often see GROK_*; otherwise stay with "claude" for backward).
  // Always override with explicit --cmd grok or --cmd claude etc.
  const effectiveCmd =
    cmd ||
    (process.env.GROK_SESSION_ID || process.env.GROK_HOOK_EVENT
      ? "grok"
      : "claude");
  const n = Number(slots) || 2;
  if (t(["has-session", "-t", SESSION]) !== null) {
    process.stdout.write("grid already up\n");
    return 0;
  }

  t(["new-session", "-d", "-s", SESSION, "-n", "grid", effectiveCmd]);
  for (let i = 1; i < n; i++)
    t(["split-window", "-h", "-t", `${SESSION}:grid`, effectiveCmd]);
  t(["select-layout", "-t", `${SESSION}:grid`, "even-horizontal"]);

  t(["new-window", "-d", "-n", HOLDING, "-t", `${SESSION}:`, "bash", LOOP]);
  for (let i = 1; i < n; i++)
    t(["split-window", "-h", "-t", `${SESSION}:${HOLDING}`, "bash", LOOP]);
  t(["select-layout", "-t", `${SESSION}:${HOLDING}`, "even-horizontal"]);

  const live = (
    t(["list-panes", "-t", `${SESSION}:grid`, "-F", "#{pane_id}"]) || ""
  )
    .split("\n")
    .filter(Boolean);
  const cur = (
    t(["list-panes", "-t", `${SESSION}:${HOLDING}`, "-F", "#{pane_id}"]) || ""
  )
    .split("\n")
    .filter(Boolean);
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

  // Session-scoped so herald never touches the user's other tmux sessions:
  // these options + hooks live only on `grid` and die with it on gridDown.
  t(["set", "-t", SESSION, "mouse", "on"]);
  t(["set", "-t", SESSION, "focus-events", "on"]);
  t([
    "set-hook",
    "-t",
    SESSION,
    "pane-focus-in",
    'run-shell "herald curtain focus-in #{pane_id}"',
  ]);
  t([
    "set-hook",
    "-t",
    SESSION,
    "pane-focus-out",
    'run-shell "herald curtain focus-out #{pane_id}"',
  ]);

  process.stdout.write(`grid up: ${pairs} slots (cmd: ${effectiveCmd})\n`);
  return 0;
};

export const gridDown = () => {
  t(["kill-session", "-t", SESSION]);
  process.stdout.write("grid down\n");
  return 0;
};

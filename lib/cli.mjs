import { renderCardFrame } from "./surfaces/curtain-card.mjs";
import { computeElapsed } from "./curtain/state.mjs";
import { onEvent, onFocusIn, onFocusOut } from "./curtain/orchestrator.mjs";
import { gridUp, gridDown } from "./curtain/grid.mjs";
import { getOpt } from "./curtain/tmux.mjs";

const parseFlags = (args) => {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) f[args[i].slice(2)] = args[++i];
  }
  return f;
};

const runRender = (args) => {
  const f = parseFlags(args);
  if (f.surface !== "curtain-card") {
    process.stderr.write(`unknown surface: ${f.surface}\n`);
    return 1;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  process.stdout.write(renderCardFrame({
    state: f.state || "idle",
    elapsedSec: computeElapsed(nowSec, f.since),
    cols: Number(f.cols) || 80,
    rows: Number(f.rows) || 24,
  }));
  return 0;
};

// All curtain ops are hook-safe: never throw, always exit 0-ish for hooks.
const runCurtain = (args) => {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case "up": return gridUp(parseFlags(rest));
      case "down": return gridDown();
      case "event": {
        const pane = process.env.TMUX_PANE;
        if (pane && rest[0]) onEvent(pane, rest[0], Math.floor(Date.now() / 1000));
        return 0;
      }
      case "focus-in": if (rest[0]) onFocusIn(rest[0]); return 0;
      case "focus-out": if (rest[0]) onFocusOut(rest[0]); return 0;
      case "status": {
        const pane = process.env.TMUX_PANE;
        process.stdout.write(pane ? `${pane}: ${getOpt(pane, "@herald_state") || "idle"}\n` : "not in tmux\n");
        return 0;
      }
      default:
        process.stderr.write("usage: herald curtain <up|down|event|focus-in|focus-out|status>\n");
        return 1;
    }
  } catch {
    return 0; // hook safety: never break the caller
  }
};

export const main = (argv) => {
  const [verb, ...rest] = argv;
  try {
    if (verb === "--version" || verb === "-v") { process.stdout.write("herald 0.0.0\n"); return; }
    if (verb === "render") { process.exitCode = runRender(rest); return; }
    if (verb === "curtain") { process.exitCode = runCurtain(rest); return; }
    process.stderr.write("usage: herald <render|curtain> ...\n");
    process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exitCode = 1;
  }
};

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gridDown, gridUp } from "./curtain/grid.mjs";
import { hooksInstalled, install, uninstall } from "./curtain/install.mjs";
import { onEvent, onFocusIn, onFocusOut } from "./curtain/orchestrator.mjs";
import { computeElapsed } from "./curtain/state.mjs";
import { getOpt } from "./curtain/tmux.mjs";
import { renderCardFrame } from "./surfaces/curtain-card.mjs";

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
  process.stdout.write(
    renderCardFrame({
      state: f.state || "idle",
      elapsedSec: computeElapsed(nowSec, f.since),
      cols: Number(f.cols) || 80,
      rows: Number(f.rows) || 24,
    }),
  );
  return 0;
};

// All curtain ops are hook-safe: never throw, always exit 0-ish for hooks.
const runCurtain = (args) => {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case "up":
        return gridUp(parseFlags(rest));
      case "down":
        return gridDown();
      case "event": {
        const pane = process.env.TMUX_PANE;
        if (pane && rest[0])
          onEvent(pane, rest[0], Math.floor(Date.now() / 1000));
        return 0;
      }
      case "focus-in":
        if (rest[0]) onFocusIn(rest[0]);
        return 0;
      case "focus-out":
        if (rest[0]) onFocusOut(rest[0]);
        return 0;
      case "status": {
        const pane = process.env.TMUX_PANE;
        process.stdout.write(
          pane
            ? `${pane}: ${getOpt(pane, "@herald_state") || "idle"}\n`
            : "not in tmux\n",
        );
        return 0;
      }
      case "install": {
        const r = install(join(homedir(), ".claude", "settings.json"));
        process.stdout.write(
          r.ok
            ? r.changed
              ? "hooks installed\n"
              : "hooks already present\n"
            : `${r.reason}\n`,
        );
        return r.ok ? 0 : 1;
      }
      case "uninstall": {
        const r = uninstall(join(homedir(), ".claude", "settings.json"));
        process.stdout.write(
          r.ok
            ? r.changed
              ? "hooks removed\n"
              : "no hooks to remove\n"
            : `${r.reason}\n`,
        );
        return r.ok ? 0 : 1;
      }
      case "doctor": {
        const checks = [];
        const settingsPath = join(homedir(), ".claude", "settings.json");
        let installed = false;
        try {
          installed =
            existsSync(settingsPath) &&
            hooksInstalled(JSON.parse(readFileSync(settingsPath, "utf8")));
        } catch {}
        checks.push(["Claude hooks wired", installed]);
        let inTmux = false;
        try {
          inTmux = !!process.env.TMUX;
        } catch {}
        checks.push(["inside tmux", inTmux]);
        let onPath = false;
        try {
          execFileSync("tmux", ["-V"]);
          onPath = true;
        } catch {}
        checks.push(["tmux available", onPath]);
        for (const [name, ok] of checks)
          process.stdout.write(`${ok ? "✓" : "✗"} ${name}\n`);
        return checks.every(([, ok]) => ok) ? 0 : 1;
      }
      default:
        process.stderr.write(
          "usage: herald curtain <up|down|event|focus-in|focus-out|status|install|uninstall|doctor>\n",
        );
        return 1;
    }
  } catch {
    return 0; // hook safety: never break the caller
  }
};

export const main = (argv) => {
  const [verb, ...rest] = argv;
  try {
    if (verb === "--version" || verb === "-v") {
      process.stdout.write("herald 0.0.0\n");
      return;
    }
    if (verb === "render") {
      process.exitCode = runRender(rest);
      return;
    }
    if (verb === "curtain") {
      process.exitCode = runCurtain(rest);
      return;
    }
    process.stderr.write("usage: herald <render|curtain> ...\n");
    process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exitCode = 1;
  }
};

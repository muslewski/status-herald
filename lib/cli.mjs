import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, stripTitle } from "./config.mjs";
import { gridDown, gridUp } from "./curtain/grid.mjs";
import { parseHookPayload } from "./curtain/hook.mjs";
import { hooksInstalled, install, uninstall } from "./curtain/install.mjs";
import { onEvent, onFocusIn, onFocusOut } from "./curtain/orchestrator.mjs";
import {
  arm,
  armAll,
  cover,
  disarm,
  focus,
  reveal,
  revealAll,
  stampFromHook,
  stampSession,
} from "./curtain/session.mjs";
import { computeElapsed } from "./curtain/state.mjs";
import { getOpt, sessionOf } from "./curtain/tmux.mjs";
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
      bg: { subagents: f.subagents, shells: f.shells },
    }),
  );
  return 0;
};

const curSession = () => {
  const pane = process.env.TMUX_PANE;
  return pane ? sessionOf(pane) : "";
};

// All curtain ops are hook-safe: never throw, always exit 0-ish for hooks.
const runCurtain = (args) => {
  const [sub, ...rest] = args;
  const cfg = loadConfig().curtain;
  const GATED = new Set([
    "arm",
    "disarm",
    "cover",
    "reveal",
    "reveal-all",
    "focus",
    "arm-all",
    "hook",
  ]);
  if (!cfg.enabled && GATED.has(sub)) return 0;
  try {
    switch (sub) {
      case "up":
        return gridUp(parseFlags(rest));
      case "down":
        return gridDown();
      case "event": {
        const pane = process.env.TMUX_PANE;
        if (pane && rest[0]) {
          const now = Math.floor(Date.now() / 1000);
          onEvent(pane, rest[0], now);
          stampSession(pane, rest[0], now);
        }
        return 0;
      }
      // Payload-aware hook entry: one command for every Claude Code event. It
      // reads the event's JSON on stdin, so it can tell "turn ended" from
      // "work finished" -- which the event name alone cannot express.
      case "hook": {
        const pane = process.env.TMUX_PANE;
        if (!pane) return 0;
        let raw = "";
        try {
          raw = readFileSync(0, "utf8");
        } catch {}
        const ev = parseHookPayload(raw);
        if (ev) stampFromHook(pane, ev, Math.floor(Date.now() / 1000));
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
      case "arm": {
        const s = rest[0] || curSession();
        if (s) arm(s);
        return 0;
      }
      case "disarm": {
        const s = rest[0] || curSession();
        if (s) disarm(s);
        return 0;
      }
      case "cover":
        if (rest[0]) cover(rest[0]);
        return 0;
      case "reveal":
        if (rest[0]) reveal(rest[0]);
        return 0;
      case "reveal-all":
        revealAll();
        return 0;
      case "focus":
        focus(stripTitle(rest[0] || "", cfg.focus.titleStripPrefixes));
        return 0;
      case "arm-all":
        if (cfg.autoArm.enabled) armAll(cfg.autoArm.sessionGlob);
        return 0;
      default:
        process.stderr.write(
          "usage: herald curtain <up|down|arm|disarm|cover|reveal|reveal-all|focus|arm-all|hook|event|status|install|uninstall|doctor>\n",
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
    if (verb === "config") {
      process.stdout.write(`${JSON.stringify(loadConfig(), null, 2)}\n`);
      return;
    }
    process.stderr.write("usage: herald <render|curtain|config> ...\n");
    process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exitCode = 1;
  }
};

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadConfig, stripTitle } from "./config.mjs";
import { captureLogPath, captureOn, debugLog } from "./curtain/debug.mjs";
import { formatDoctorReport, runDoctor } from "./curtain/doctor.mjs";
import { gridDown, gridUp } from "./curtain/grid.mjs";
import { parseHookPayload } from "./curtain/hook.mjs";
import { runInspect } from "./curtain/inspect.mjs";
import {
  getClaudeSettingsPath,
  getGrokHooksPath,
  install,
  uninstall,
} from "./curtain/install.mjs";
import { countLive, parseLeases } from "./curtain/lease.mjs";
import { onEvent, onFocusIn, onFocusOut } from "./curtain/orchestrator.mjs";
import {
  applySettle,
  applyWash,
  arm,
  armAll,
  armIfMatch,
  cover,
  disarm,
  focus,
  pause,
  pauseAll,
  refreshCards,
  resume,
  resumeAll,
  reveal,
  revealAll,
  stampFromHook,
  stampSession,
} from "./curtain/session.mjs";
import { computeElapsed } from "./curtain/state.mjs";
import { selectEffects } from "./curtain/theatrics.mjs";
import { resolveThemeByName } from "./curtain/themes.mjs";
import { getSessOpt, listArmed, sessionOf } from "./curtain/tmux.mjs";
import { renderClaudeStatusline } from "./status/claude-statusline.mjs";
import { renderTmuxStatus } from "./status/tmux-status.mjs";
import { renderCardFrame } from "./surfaces/curtain-card.mjs";
import { version } from "./version.mjs";

/** True when stdout is a TTY (fzf drill-in only then). */
const isStdoutTty = () => {
  try {
    return !!process.stdout.isTTY;
  } catch {
    return false;
  }
};

/** @returns {boolean} */
const hasFzf = () => {
  try {
    execFileSync("fzf", ["--version"], { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
};

/**
 * Run fzf over label lines; return selected line or "".
 * @param {string[]} lines
 * @returns {string}
 */
const fzfPickLines = (lines) => {
  try {
    return execFileSync(
      "fzf",
      ["--ansi", "--height=40%", "--reverse", "--prompt=session❯ "],
      {
        encoding: "utf8",
        input: `${lines.join("\n")}\n`,
        stdio: ["pipe", "pipe", "inherit"],
      },
    ).trim();
  } catch {
    return "";
  }
};

const parseFlags = (args) => {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) f[args[i].slice(2)] = args[++i];
  }
  return f;
};

const runRender = async (args) => {
  const f = parseFlags(args);
  if (f.surface === "curtain-card") {
    const nowSec = Math.floor(Date.now() / 1000);
    let bg = {
      subagents: f.subagents,
      shells: f.shells,
      watchers: f.watchers,
      worked: f.worked,
    };
    // Live path: counts derived from @herald_leases (truth-lease store).
    if (f.leases != null && f.leases !== "") {
      const c = countLive(parseLeases(f.leases), nowSec);
      bg = {
        subagents: c.subagent,
        shells: c.bg_shell,
        watchers: c.watcher,
        worked: f.worked,
      };
    } else if (f.leases === "") {
      bg = {
        subagents: 0,
        shells: 0,
        watchers: 0,
        worked: f.worked,
      };
    }
    {
      const themeName = f.theme || "classic";
      const cfg = loadConfig();
      const animCfg = cfg.curtain?.animation || {};
      const draw = f.draw || ""; // "shut" | "open" | ""
      const drawFrames = Number(animCfg.drawFrames) || 8;
      const drawTick = Number(f["draw-tick"]);
      const drawProgress = Number.isFinite(drawTick)
        ? Math.min(1, Math.max(0, drawTick / Math.max(1, drawFrames - 1)))
        : f["draw-progress"] != null
          ? Number(f["draw-progress"])
          : 0;
      const theatrics = {
        themeName,
        animCfg,
        effects: selectEffects({
          state: f.state || "idle",
          themeName,
          animCfg,
        }),
        draw: draw === "shut" || draw === "open" ? draw : null,
        drawProgress,
        sparkFrames: 5,
        seed: Number(f.seed) || 0, // per-session seed (real plumbing = P2)
      };
      process.stdout.write(
        renderCardFrame({
          state: f.state || "idle",
          elapsedSec: computeElapsed(nowSec, f.since),
          cols: Number(f.cols) || 80,
          rows: Number(f.rows) || 24,
          bg,
          theme: resolveThemeByName(themeName),
          tick: Number(f.tick) || 0,
          theatrics,
        }),
      );
    }
    return 0;
  }
  if (f.surface === "tmux-status") {
    try {
      const out = await renderTmuxStatus({
        panePid: f["pane-pid"] ? Number(f["pane-pid"]) : undefined,
        skipSideEffects:
          f["no-side-effects"] === "1" || f["no-side-effects"] === "true",
      });
      process.stdout.write(out);
    } catch {
      process.stdout.write("");
    }
    return 0;
  }
  if (f.surface === "claude-statusline") {
    try {
      let raw = "";
      try {
        raw = readFileSync(0, "utf8");
      } catch {}
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      const out = await renderClaudeStatusline(data, {});
      process.stdout.write(out);
    } catch {
      process.stdout.write("");
    }
    return 0;
  }
  process.stderr.write(`unknown surface: ${f.surface}\n`);
  return 1;
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
    "pause",
    "resume",
    "pause-all",
    "resume-all",
    "focus",
    "arm-all",
    "refresh",
    "hook",
    "settle",
    "wash",
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
      // Payload-aware hook entry: one command for every agent event (Claude
      // Code, Grok Build, ...). It reads the event's JSON on stdin (normalizing
      // Claude/Grok shapes), so it can tell "turn ended" from "work finished".
      case "hook": {
        const pane = process.env.TMUX_PANE;
        if (!pane) return 0;
        let raw = "";
        try {
          raw = readFileSync(0, "utf8");
        } catch {}
        const now = Math.floor(Date.now() / 1000);
        const ev = parseHookPayload(raw);
        debugLog({
          ts: now,
          pane,
          session: ev ? sessionOf(pane) : "",
          event: ev?.event || null,
          notificationType: ev?.notificationType || null,
          subagents: ev?.subagents ?? null,
          shells: ev?.shells ?? null,
          raw: raw.slice(0, 4000),
        });
        if (ev) {
          // A new agent session self-arms: no periodic arm-all can miss a tab
          // that opens between its runs. Config-gated so autoArm=off disables it.
          if (ev.event === "SessionStart" && cfg.autoArm.enabled)
            armIfMatch(sessionOf(pane), cfg.autoArm.sessionGlob);
          stampFromHook(pane, ev, now);
        }
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
        if (!pane) {
          process.stdout.write("not in tmux\n");
          return 0;
        }
        const sess = sessionOf(pane);
        const state = sess
          ? getSessOpt(sess, "@herald_state") || "idle"
          : "idle";
        const paused =
          sess && getSessOpt(sess, "@herald_paused") === "1" ? " paused" : "";
        process.stdout.write(`${pane}: ${state}${paused}\n`);
        return 0;
      }
      case "install": {
        const wantGrok = rest[0] === "grok" || rest.includes("--grok");
        const path = wantGrok ? getGrokHooksPath() : getClaudeSettingsPath();
        const label = wantGrok ? "grok" : "claude";
        const r = install(path);
        process.stdout.write(
          r.ok
            ? r.changed
              ? `hooks installed (${label})\n`
              : `hooks already present (${label})\n`
            : `${r.reason}\n`,
        );
        return r.ok ? 0 : 1;
      }
      case "uninstall": {
        const wantGrok = rest[0] === "grok" || rest.includes("--grok");
        const path = wantGrok ? getGrokHooksPath() : getClaudeSettingsPath();
        const label = wantGrok ? "grok" : "claude";
        const r = uninstall(path);
        process.stdout.write(
          r.ok
            ? r.changed
              ? `hooks removed (${label})\n`
              : `no hooks to remove (${label})\n`
            : `${r.reason}\n`,
        );
        return r.ok ? 0 : 1;
      }
      case "doctor": {
        // Unified with top-level `herald doctor` (banner + checklist + fix hints).
        const result = runDoctor({
          t: { listArmed, getSessOpt },
          nowSec: Math.floor(Date.now() / 1000),
        });
        process.stdout.write(formatDoctorReport(result));
        return result.ok ? 0 : 1;
      }
      case "inspect": {
        const now = Math.floor(Date.now() / 1000);
        const sessionArg = rest[0] || "";
        const names = sessionArg
          ? [sessionArg]
          : listArmed().map((s) => s.name);
        const tty = isStdoutTty();
        const fzfOk = tty && hasFzf();
        const { text, exitCode } = runInspect({
          names,
          getSessOpt: (name, k) => getSessOpt(name, k) || "",
          nowSec: now,
          sessionArg: sessionArg || undefined,
          tty,
          fzfAvailable: fzfOk,
          fzfPick: fzfOk ? fzfPickLines : undefined,
        });
        process.stdout.write(text);
        if (captureOn())
          process.stdout.write(`capture: ON -> ${captureLogPath()}\n`);
        return exitCode;
      }
      // Card-loop / operator: apply quiet/leak settle policy for stuck states.
      // Fail-open: never throws; no-op when nothing is stale.
      case "settle": {
        const now = Math.floor(Date.now() / 1000);
        const s = rest[0] || curSession();
        if (s) applySettle(s, now, undefined, cfg);
        return 0;
      }
      // Card-loop: whole-bar breathing wash from @herald_state.
      case "wash": {
        const now = Math.floor(Date.now() / 1000);
        const s = rest[0] || curSession();
        if (s) applyWash(s, now, undefined, cfg);
        return 0;
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
      // Hold curtain open (no auto-cover) so you can copy from the live pane.
      case "pause": {
        const s = rest[0] || curSession();
        if (s) pause(s);
        return 0;
      }
      case "resume": {
        const s = rest[0] || curSession();
        if (s) resume(s);
        return 0;
      }
      case "pause-all":
        pauseAll();
        return 0;
      case "resume-all":
        resumeAll();
        return 0;
      case "focus":
        focus(stripTitle(rest[0] || "", cfg.focus.titleStripPrefixes));
        return 0;
      case "arm-all":
        if (cfg.autoArm.enabled) armAll(cfg.autoArm.sessionGlob);
        return 0;
      // Respawn card loops in place so a card-script change reaches sessions
      // that are already armed, without resetting their state.
      case "refresh":
        refreshCards();
        return 0;
      default:
        process.stderr.write(
          "usage: herald curtain <up|down|arm|disarm|cover|reveal|reveal-all|pause|resume|pause-all|resume-all|focus|arm-all|refresh|hook|event|status|install|uninstall|doctor|inspect>\n" +
            "  install [grok|--grok]  # default wires ~/.claude/settings.json (Grok reads via compat); use grok for ~/.grok/hooks/herald.json native\n" +
            "  inspect [session]      # stage board (TTY+fzf drill-in); detail when named\n" +
            "  pause [session]        # hold curtain open (copy text); resume to re-enable\n" +
            "  pause-all / resume-all # same for every armed session\n",
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
    if (verb === "--version" || verb === "-v" || verb === "version") {
      process.stdout.write(`herald ${version()}\n`);
      return;
    }
    if (verb === "render") {
      // Surfaces may be async (tmux-status / claude-statusline).
      Promise.resolve(runRender(rest))
        .then((code) => {
          process.exitCode = code || 0;
        })
        .catch(() => {
          process.exitCode = 0; // fail-open on render paths
        });
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
    if (verb === "doctor") {
      const result = runDoctor({
        t: {
          listArmed,
          getSessOpt,
        },
        nowSec: Math.floor(Date.now() / 1000),
      });
      process.stdout.write(formatDoctorReport(result));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    process.stderr.write(
      "usage: herald <render|curtain|config|doctor|version> ...\n" +
        "  render --surface curtain-card|tmux-status|claude-statusline\n" +
        "  doctor  # unified health: hooks, card-loop, tmux, settle RC\n" +
        "  version / -v / --version\n",
    );
    process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exitCode = 1;
  }
};

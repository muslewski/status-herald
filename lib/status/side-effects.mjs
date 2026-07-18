// Idempotent tmux side-effects for status bars (port of session-sync sync_windows).
// All writes best-effort, never throw. Injectable runner for hermetic tests.
// @ctxbar is written at BOTH window and session scope (covered _curtain case).

import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateHue } from "../curtain/wash.mjs";

const TMUX = process.env.HERALD_TMUX || "tmux";

/** Default real runner — LC_ALL=C.UTF-8 so ▶/⏸ round-trip. */
export function realTmuxExec(args, { timeout = 3000 } = {}) {
  try {
    return execFileSync(TMUX, args, {
      encoding: "utf8",
      timeout,
      env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" },
    }).trim();
  } catch {
    return "";
  }
}

export function getTmux(target, fmt, exec = realTmuxExec) {
  if (!target) return "";
  return exec(["display-message", "-p", "-t", target, fmt]) || "";
}

export function setWindow(target, opt, val, exec = realTmuxExec) {
  if (!target || opt == null) return;
  exec(["set-option", "-w", "-t", target, opt, String(val ?? "")]);
}

export function setSession(sess, opt, val, exec = realTmuxExec) {
  if (!sess || opt == null) return;
  exec(["set-option", "-t", sess, opt, String(val ?? "")]);
}

export function renameWindow(target, name, exec = realTmuxExec) {
  if (!target || !name) return;
  exec(["rename-window", "-t", target, name]);
}

export function getSessionOpt(sess, opt, exec = realTmuxExec) {
  if (!sess) return "";
  return exec(["show-options", "-t", sess, "-v", opt]) || "";
}

/** List panes: Map pid -> [session:winIndex, window_id] */
export function listTmuxPanes(exec = realTmuxExec) {
  const raw =
    exec([
      "list-panes",
      "-a",
      "-F",
      "#{pane_pid}\t#{session_name}:#{window_index}\t#{window_id}",
    ]) || "";
  const out = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [pidS, target, wid] = line.split("\t");
    const pid = Number(pidS);
    if (!Number.isFinite(pid) || !target) continue;
    out.set(pid, [target, wid || ""]);
  }
  return out;
}

/**
 * Climb ≤4 parents from ppid through panes map (Python window_for).
 * panes: Map|Record pid -> [target, wid]
 * ppidOf: (pid) => parent pid | null — injectable for tests.
 */
export function windowFor(ppid, panes, ppidOf, maxClimb = 4) {
  if (ppid == null) return null;
  const get = (pid) =>
    panes instanceof Map
      ? panes.get(pid)
      : (panes?.[pid] ?? panes?.[String(pid)]);
  let pid = Number(ppid);
  for (let i = 0; i < maxClimb; i++) {
    const hit = get(pid);
    if (hit) return hit;
    if (typeof ppidOf !== "function") break;
    const nxt = ppidOf(pid);
    if (nxt == null || nxt === pid) break;
    pid = Number(nxt);
  }
  return null;
}

/** ctx_bucket tmux color for @ctx (Python claude_sessions.ctx_bucket). */
export function ctxBucketTmux(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 30) return "green";
  if (p <= 50) return "orange";
  if (p <= 80) return "red";
  return "colour201";
}

// Soft WORKING breathe (one cycle per stateHue.working period). ● full → ○ empty
// → ● — a luminance pulse, never a strobe. Dot family unifies with card/Claude ●.
const WORKING_PULSE = ["●", "◐", "○", "◑"];

export function stateGlyph(status, t) {
  const s = String(status || "").toLowerCase();
  const isWork =
    s === "busy" || s === "shell" || s === "working" || s === "compacting";
  if (isWork) {
    if (t == null || !Number.isFinite(Number(t))) return "▶"; // back-compat static
    const period = stateHue("working").periodSec || 5;
    const frac = period > 0 ? (((Number(t) / period) % 1) + 1) % 1 : 0;
    const idx = Math.min(
      WORKING_PULSE.length - 1,
      Math.floor(frac * WORKING_PULSE.length),
    );
    return WORKING_PULSE[idx];
  }
  if (s === "needs") return "⚠";
  if (s === "unknown" || s === "") return "·";
  // idle / done / paused
  return "⏸";
}

/**
 * Write @ctxbar at window scope and, when sessName given, session scope too
 * (covered _curtain windows fall through to session option).
 * Idempotent: skip when current value already matches.
 */
export function writeCtxbar(target, bar, sessName, exec = realTmuxExec) {
  const b = bar ?? "";
  if (target) {
    const cur = getTmux(target, "#{@ctxbar}", exec);
    if (cur !== b) setWindow(target, "@ctxbar", b, exec);
  }
  if (sessName) {
    const curS = getSessionOpt(sessName, "@ctxbar", exec);
    if (curS !== b) setSession(sessName, "@ctxbar", b, exec);
  }
}

export function writeModelAndState(
  target,
  { modelBadge = "", glyph = "", color = "" } = {},
  exec = realTmuxExec,
) {
  if (!target) return;
  if (getTmux(target, "#{@model}", exec) !== modelBadge)
    setWindow(target, "@model", modelBadge, exec);
  if (getTmux(target, "#{@state}", exec) !== glyph)
    setWindow(target, "@state", glyph, exec);
  if (color && getTmux(target, "#{@ctx}", exec) !== color)
    setWindow(target, "@ctx", color, exec);
}

/**
 * Sync live sessions into tmux window/session options.
 * Never throws.
 */
export function syncWindows(
  liveSessions,
  { getDataFor, panes, ppidOf, exec = realTmuxExec, modelEnabled = true } = {},
) {
  try {
    const paneMap = panes || listTmuxPanes(exec);
    const list = Array.isArray(liveSessions) ? liveSessions : [];
    for (const s of list) {
      try {
        const win = windowFor(s.ppid, paneMap, ppidOf);
        if (!win) continue;
        const [target] = win;
        const data = getDataFor ? getDataFor(s) : null;
        if (!data) continue;
        const sessName =
          getTmux(target, "#{session_name}", exec) || s.name || "";
        const wantName = sessName || data.windowName || s.name || "";
        if (wantName && getTmux(target, "#{window_name}", exec) !== wantName)
          renameWindow(target, wantName, exec);

        const color = data.color || ctxBucketTmux(data.context?.pct ?? 0);
        const glyph = data.stateGlyph || stateGlyph(s.status);
        const badge = modelEnabled ? data.modelBadge || "" : "";

        writeModelAndState(target, { modelBadge: badge, glyph, color }, exec);
        writeCtxbar(target, data.ctxbarText || "", sessName, exec);
      } catch {
        /* one session failure must not skip the rest */
      }
    }
  } catch {
    /* never throw */
  }
}

/** Atomic effort sidecar write (Python write_session_meta). Best-effort. */
export function writeSessionMeta(
  sessionId,
  modelDisplay,
  effortLevel,
  metaDir,
) {
  if (!sessionId || !metaDir) return;
  try {
    mkdirSync(metaDir, { recursive: true });
    const dest = join(metaDir, `${sessionId}.json`);
    const tmp = `${dest}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({
        model: modelDisplay || "",
        effort: effortLevel || "",
      }),
      "utf8",
    );
    renameSync(tmp, dest);
  } catch {
    /* best-effort */
  }
}

// Grok process detection via /proc tree walk (PPid from status file, cmdline argv)
// + live session discovery from ~/.grok/active_sessions.json + signals.json.
// Zero side effects beyond reads. Graceful on any error / non-linux.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_GROK_HOME = path.join(os.homedir(), ".grok");

export function readProcStatusPpid(pid) {
  if (!pid) return null;
  try {
    const txt = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const m = txt.match(/^PPid:\s*(\d+)/m);
    return m ? Number.parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

export function climbProcTree(startPid, maxDepth = 4) {
  const pids = [startPid];
  let cur = startPid;
  for (let i = 0; i < maxDepth; i++) {
    const pp = readProcStatusPpid(cur);
    if (pp == null || pp === cur || pp <= 0) break;
    pids.push(pp);
    cur = pp;
  }
  return pids;
}

function readCmdline(pid) {
  try {
    const buf = fs.readFileSync(`/proc/${pid}/cmdline`);
    return buf.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function _alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isGrokProcess(pid) {
  const argv = readCmdline(pid);
  if (!argv.length) return false;
  const joined = argv.join(" ").toLowerCase();
  return joined.includes("grok") || argv[0].toLowerCase().endsWith("grok");
}

function extractEffort(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--effort" || argv[i] === "-e") {
      return (argv[i + 1] || "").trim() || null;
    }
    const m = argv[i].match(/^--effort[=:](.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

export function detectGrok(panePid) {
  if (!panePid) return { isGrok: false };
  const tree = climbProcTree(panePid, 4);
  for (const pid of tree) {
    if (isGrokProcess(pid)) {
      const argv = readCmdline(pid);
      const effort = extractEffort(argv) || "";
      const label = effort ? `Grok ${effort}` : "Grok";
      return { isGrok: true, effort: effort || undefined, label };
    }
  }
  return { isGrok: false };
}

/** Grok stores sessions under sessions/<encodeURIComponent(cwd)>/<sessionId>/. */
export function grokSessionDir(sessionId, cwd, grokHome = DEFAULT_GROK_HOME) {
  if (!sessionId || !cwd) return null;
  return path.join(grokHome, "sessions", encodeURIComponent(cwd), sessionId);
}

export function readJsonFile(p) {
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Context + user message count from Grok signals.json.
 * userMessageCount is the "messages sent" counter (Claude 💬 parity).
 * context window defaults to 500k when signals omit it.
 *
 * IMPORTANT: signals.contextTokensUsed is often STALE mid-turn (Grok rewrites
 * signals.json mainly around turn boundaries). Prefer liveUsed from
 * updates.jsonl `_meta.totalTokens` when provided — that is what the Grok CLI
 * chrome tracks. Never use turn_completed.usage.totalTokens (cumulative API).
 */
export function contextFromGrokSignals(signals = {}, liveUsed = null) {
  const win = Number(signals.contextWindowTokens) || 500_000;
  const fromSignals = Number(signals.contextTokensUsed) || 0;
  const live = Number(liveUsed);
  // Live stream wins when present and finite; otherwise signals snapshot.
  // Take max so a briefly-lagging live read never regresses past signals.
  let used = fromSignals;
  if (Number.isFinite(live) && live >= 0) {
    used = Math.max(fromSignals, live);
  }
  // Always recompute pct from used/win — signals.contextWindowUsage is equally stale.
  const pct = win ? Math.floor((used * 100) / win) : 0;
  const messages = Number(signals.userMessageCount) || 0;
  return { used, win, pct, messages };
}

/**
 * Tail-scan updates.jsonl for the latest params._meta.totalTokens (live context).
 * Skips turn_completed.usage.totalTokens (cumulative API, often millions).
 * Best-effort; returns null on any error / no match.
 */
export function latestGrokMetaTotalTokens(
  sessionDir,
  { maxBytes = 512_000 } = {},
) {
  if (!sessionDir) return null;
  const p = path.join(sessionDir, "updates.jsonl");
  let fd;
  try {
    const st = fs.statSync(p);
    const size = st.size || 0;
    if (size <= 0) return null;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString("utf8");
    // If we started mid-line, drop the partial first line.
    if (start > 0) {
      const nl = text.indexOf("\n");
      text = nl >= 0 ? text.slice(nl + 1) : text;
    }
    let last = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes("totalTokens")) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const meta = o?.params?._meta;
      const tt = meta?.totalTokens;
      if (typeof tt === "number" && Number.isFinite(tt) && tt >= 0) {
        last = tt;
      }
    }
    return last;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Live Grok sessions from active_sessions.json + per-session signals.json.
 * Shape mirrors Claude discovery so syncWindows can consume both.
 * opts: { grokHome?, activePath?, alive? } — injectable for hermetic tests.
 */
export function discoverLiveGrokSessions(opts = {}) {
  const grokHome = opts.grokHome || DEFAULT_GROK_HOME;
  const activePath =
    opts.activePath || path.join(grokHome, "active_sessions.json");
  const aliveFn = typeof opts.alive === "function" ? opts.alive : _alive;
  const active = readJsonFile(activePath);
  if (!Array.isArray(active)) return [];
  const out = [];
  for (const a of active) {
    try {
      const pid = a?.pid;
      if (!aliveFn(pid)) continue;
      const sessionId = a.session_id || a.sessionId || "";
      const cwd = a.cwd || "";
      const dir = grokSessionDir(sessionId, cwd, grokHome);
      const signals = dir
        ? readJsonFile(path.join(dir, "signals.json")) || {}
        : {};
      const summary = dir
        ? readJsonFile(path.join(dir, "summary.json")) || {}
        : {};
      // Live context from updates stream (what Grok CLI shows mid-turn).
      const liveUsed = dir ? latestGrokMetaTotalTokens(dir) : null;
      const context = contextFromGrokSignals(signals, liveUsed);
      const modelId =
        summary.current_model_id || signals.primaryModelId || "grok-4.5";
      const effort =
        summary.reasoning_effort || extractEffort(readCmdline(pid)) || "";
      const fam = /grok/i.test(modelId) ? "Grok" : modelId;
      const modelBadge = effort ? `${fam} 🧠${effort}` : fam;
      out.push({
        pid,
        ppid: readProcStatusPpid(pid),
        sessionId,
        cwd,
        name: path.basename(cwd.replace(/\/+$/, "")) || "grok",
        status: "busy",
        isGrok: true,
        context,
        messages: context.messages,
        modelBadge,
        modelId,
      });
    } catch {
      /* one bad entry must not skip the rest */
    }
  }
  return out;
}

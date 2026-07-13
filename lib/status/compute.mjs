// Status compute layer: ports of claude_sessions transcript math + discovery +
// effort meta + account usage facade. Thin fs/child only in adapters.
// Exports are pure or return promises for I/O; never throw to callers.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readAccountUsage } from "./bridge-token-forecast.mjs";
import { detectGrok, readProcStatusPpid } from "./grok-adapter.mjs";

// --- pure transcript math (ported verbatim from claude_sessions.py) ---

function _parse(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _isHuman(obj) {
  if (!obj || obj.type !== "user" || obj.isMeta) return false;
  const content = obj.message?.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some((b) => b && b.type === "text");
  }
  return false;
}

export function latestUsed(lines = []) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = _parse(lines[i]);
    if (!obj) continue;
    const usage = obj.message?.usage;
    if (!usage) continue;
    const total =
      (usage.input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0);
    if (total > 0) return total;
  }
  return 0;
}

export function countMessages(lines = []) {
  let n = 0;
  for (const raw of lines) {
    const obj = _parse(raw);
    if (!obj) continue;
    if (obj.type === "system" && obj.subtype === "compact_boundary") {
      n = 0;
      continue;
    }
    if (_isHuman(obj)) n += 1;
  }
  return n;
}

export function modelWindow(modelId) {
  const mid = (modelId || "").toLowerCase();
  const oneM = [
    "opus-4-8",
    "opus-4-7",
    "opus-4-6",
    "sonnet-4-6",
    "sonnet-4-5",
    "sonnet-4",
    "1m",
  ];
  return oneM.some((t) => mid.includes(t)) ? 1_000_000 : 200_000;
}

export function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.floor(n / 1000)}k`;
}

export function computeContext(lines = []) {
  const used = latestUsed(lines);
  const win = modelWindow(modelFromTranscript(lines));
  const pct = win ? Math.floor((used * 100) / win) : 0;
  const messages = countMessages(lines);
  return { used, win, pct, messages };
}

export function modelFromTranscript(lines = []) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = _parse(lines[i]);
    if (obj && obj.type === "assistant") {
      const m = obj.message?.model;
      if (m) return m;
    }
  }
  return "";
}

// --- I/O thin wrappers (for test injection too) ---

export async function readLines(p) {
  if (!p) return [];
  try {
    const buf = await fs.readFile(p);
    return buf.toString("utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

const HOME = os.homedir();
const DEFAULT_SESSIONS_DIR = path.join(HOME, ".claude", "sessions");
const DEFAULT_PROJECTS_DIR = path.join(HOME, ".claude", "projects");
const DEFAULT_META_DIR = path.join(HOME, ".claude", "session-meta");

export async function readSessionMeta(sessionId, metaDir = DEFAULT_META_DIR) {
  if (!sessionId) return {};
  const p = path.join(metaDir, `${sessionId}.json`);
  try {
    const txt = await fs.readFile(p, "utf8");
    return JSON.parse(txt);
  } catch {
    return {};
  }
}

export function shortModelBadge(display, effort) {
  const name = display || "";
  const low = name.toLowerCase();
  let fam = "";
  for (const f of ["opus", "fable", "sonnet", "haiku", "grok"]) {
    if (low.includes(f)) {
      fam = f.charAt(0).toUpperCase() + f.slice(1);
      break;
    }
  }
  if (!fam) {
    const parts = name.trim().split(/\s+/);
    fam = parts[0] || "";
  }
  if (!fam) return "";
  return effort ? `${fam} 🧠${effort}` : fam;
}

// --- discovery (best effort, never throw) ---

function _alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function discoverLiveClaudeSessions(opts = {}) {
  const sessionsDir = opts.sessionsDir || DEFAULT_SESSIONS_DIR;
  const out = [];
  try {
    const files = await fs.readdir(sessionsDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const txt = await fs.readFile(path.join(sessionsDir, f), "utf8");
        const d = JSON.parse(txt);
        if (_alive(d.pid)) {
          out.push({
            pid: d.pid,
            sessionId: d.sessionId,
            cwd: d.cwd || "",
            name: d.name || "",
            status: d.status || "idle",
            lastActivity: d.statusUpdatedAt || d.updatedAt || 0,
            ppid: readProcStatusPpid(d.pid),
          });
        }
      } catch {
        /* ignore bad file */
      }
    }
  } catch {
    /* dir missing or unreadable */
  }
  return out;
}

async function transcriptPathFor(
  sessionId,
  projectsDir = DEFAULT_PROJECTS_DIR,
) {
  if (!sessionId) return null;
  // simple recursive glob simulation (Node 20+ fs has no built-in; keep cheap walk limited)
  async function find(dir) {
    try {
      const ents = await fs.readdir(dir, { withFileTypes: true });
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          const hit = await find(p);
          if (hit) return hit;
        } else if (e.name === `${sessionId}.jsonl`) {
          return p;
        }
      }
    } catch {}
    return null;
  }
  return find(projectsDir);
}

export async function buildPerSessionData(
  sessionId,
  panePidForGrok,
  opts = {},
) {
  // Always return a shape, degrade gracefully
  const projectsDir = opts.projectsDir || DEFAULT_PROJECTS_DIR;
  const metaDir = opts.metaDir || DEFAULT_META_DIR;
  let lines = [];
  try {
    const tp = await transcriptPathFor(sessionId, projectsDir);
    if (tp) lines = await readLines(tp);
  } catch {}
  const context = computeContext(lines);
  const meta = await readSessionMeta(sessionId, metaDir);
  let modelBadge = shortModelBadge(
    meta.model || modelFromTranscript(lines),
    meta.effort || "",
  );
  if (!modelBadge && panePidForGrok != null) {
    const g = detectGrok(panePidForGrok);
    if (g.isGrok) modelBadge = g.label || "Grok";
  }
  // status not known without full session object; surfaces will enrich
  return {
    sessionId: sessionId || "",
    context,
    modelBadge,
    status: "idle", // default; 020/ side-effects supply live glyph
    messages: context.messages,
  };
}

export async function getAccountGauges() {
  try {
    return await readAccountUsage();
  } catch {
    return { fiveHour: null, weekly: null, caps: {} };
  }
}

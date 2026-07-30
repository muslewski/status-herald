// Grok Build host inventory — read-only chrome parity for subagent/shell counts.
// Source of truth: sessions/<encoded-cwd>/<sessionId>/subagents/*/meta.json
// (status: running | completed), same registry the CLI maintains.
// Soft-fail everywhere; injectable I/O for hermetic tests.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { grokSessionDir, readJsonFile } from "./grok-adapter.mjs";

const DEFAULT_GROK = path.join(os.homedir(), ".grok");
const PROFILES_DIR = path.join(os.homedir(), ".grok-profiles");

/**
 * Grok homes to scan: ~/.grok plus each ~/.grok-profiles/<name> that looks live.
 * @param {string} [homedir]
 * @param {{ existsSync?: (p: string) => boolean, readdirSync?: (p: string) => string[] }} [io]
 * @returns {string[]}
 */
export function listGrokHomes(homedir = os.homedir(), io = {}) {
  const exists = io.existsSync || ((p) => fs.existsSync(p));
  const readdir = io.readdirSync || ((p) => fs.readdirSync(p));
  const out = [];
  const base = path.join(homedir, ".grok");
  if (exists(base)) out.push(base);
  const profiles = path.join(homedir, ".grok-profiles");
  if (!exists(profiles)) return out;
  let names = [];
  try {
    names = readdir(profiles);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name || name.startsWith(".")) continue;
    const home = path.join(profiles, name);
    // Profile dir is a grok home when it has active_sessions or sessions/.
    if (
      exists(path.join(home, "active_sessions.json")) ||
      exists(path.join(home, "sessions"))
    ) {
      out.push(home);
    }
  }
  return out;
}

/**
 * @param {number|string} pid
 * @param {{ homes?: string[], readJson?: (p: string) => unknown, alive?: (pid: number) => boolean }} [opts]
 * @returns {{ home: string, sessionId: string, cwd: string, pid: number } | null}
 */
export function findActiveByPid(pid, opts = {}) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return null;
  const homes = opts.homes || listGrokHomes();
  const readJson = opts.readJson || readJsonFile;
  const alive =
    typeof opts.alive === "function"
      ? opts.alive
      : (p) => {
          try {
            process.kill(p, 0);
            return true;
          } catch (e) {
            if (e && (e.code === "EPERM" || e.errno === -1)) return true;
            return false;
          }
        };
  if (!alive(n)) return null;
  for (const home of homes) {
    const active = readJson(path.join(home, "active_sessions.json"));
    if (!Array.isArray(active)) continue;
    for (const a of active) {
      const ap = Number(a?.pid);
      if (ap !== n) continue;
      const sessionId = a.session_id || a.sessionId || "";
      const cwd = a.cwd || "";
      if (!sessionId || !cwd) continue;
      return { home, sessionId, cwd, pid: n };
    }
  }
  return null;
}

/**
 * @param {string} sessionDir
 * @param {{ readdir?: (p: string) => string[], readJson?: (p: string) => unknown }} [io]
 * @returns {{ id: string, status: string, type: string, description: string }[]}
 */
export function listSubagentMetas(sessionDir, io = {}) {
  if (!sessionDir) return [];
  const readdir = io.readdir || ((p) => fs.readdirSync(p));
  const readJson = io.readJson || readJsonFile;
  const root = path.join(sessionDir, "subagents");
  let names = [];
  try {
    names = readdir(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name || name.startsWith(".")) continue;
    const meta = readJson(path.join(root, name, "meta.json"));
    if (!meta || typeof meta !== "object") continue;
    const id = String(
      meta.subagent_id || meta.child_session_id || name || "",
    ).trim();
    if (!id) continue;
    out.push({
      id,
      status: String(meta.status || "").toLowerCase(),
      type: String(meta.subagent_type || meta.type || ""),
      description: String(meta.description || ""),
    });
  }
  return out;
}

/**
 * Ids the Grok chrome treats as still running.
 * @param {string} sessionDir
 * @param {object} [io]
 * @returns {string[]}
 */
export function runningSubagentIds(sessionDir, io = {}) {
  return listSubagentMetas(sessionDir, io)
    .filter((m) => m.status === "running")
    .map((m) => m.id);
}

/**
 * Best-effort open background shell/task ids from updates.jsonl.
 * Looks for task_backgrounded / in_progress bg tools; drops completed.
 * Soft-fail → [].
 * @param {string} sessionDir
 * @param {{ maxBytes?: number, readFileSync?: typeof fs.readFileSync, statSync?: typeof fs.statSync }} [opts]
 * @returns {string[]}
 */
export function openBgShellIds(sessionDir, opts = {}) {
  if (!sessionDir) return [];
  const maxBytes = opts.maxBytes ?? 512_000;
  const readFile = opts.readFileSync || ((p, enc) => fs.readFileSync(p, enc));
  const stat = opts.statSync || ((p) => fs.statSync(p));
  const p = path.join(sessionDir, "updates.jsonl");
  let text = "";
  try {
    const st = stat(p);
    const size = st.size || 0;
    if (size <= 0) return [];
    const start = Math.max(0, size - maxBytes);
    // Read tail without loading whole multi-MB files into huge buffers when possible.
    if (start === 0) {
      text = String(readFile(p, "utf8"));
    } else {
      const fd = fs.openSync(p, "r");
      try {
        const len = size - start;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, start);
        text = buf.toString("utf8");
        const nl = text.indexOf("\n");
        if (nl >= 0) text = text.slice(nl + 1);
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    return [];
  }
  /** @type {Map<string, string>} */
  const statusById = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const upd = o?.params?.update;
    if (!upd || typeof upd !== "object") continue;
    const kind = upd.sessionUpdate || "";
    const tcid = upd.toolCallId || upd.tool_call_id || "";
    if (kind === "task_backgrounded") {
      const id = String(upd.taskId || upd.task_id || tcid || "").trim();
      if (id) statusById.set(id, "open");
      continue;
    }
    if (kind === "task_completed") {
      const id = String(upd.taskId || upd.task_id || tcid || "").trim();
      if (id) statusById.set(id, "done");
      continue;
    }
    // Background shell tool calls often appear as tool_call with title [bg] …
    if (kind === "tool_call" || kind === "tool_call_update") {
      const title = String(upd.title || upd.name || "");
      const isBg =
        title.startsWith("[bg]") ||
        upd.background === true ||
        upd.isBackground === true;
      if (!isBg || !tcid) continue;
      const st = String(upd.status || "").toLowerCase();
      if (st === "completed" || st === "failed" || st === "cancelled") {
        statusById.set(String(tcid), "done");
      } else if (st === "in_progress" || st === "pending" || !st) {
        if (statusById.get(String(tcid)) !== "done") {
          statusById.set(String(tcid), "open");
        }
      }
    }
  }
  return [...statusById.entries()]
    .filter(([, st]) => st === "open")
    .map(([id]) => id);
}

/**
 * Full chrome-parity inventory for a Grok agent process.
 * @param {number|string} pid
 * @param {object} [opts]
 * @returns {{ subagentIds: string[], shellIds: string[], sessionDir: string, source: "grok-meta", sessionId: string, cwd: string } | null}
 */
export function inventoryForPid(pid, opts = {}) {
  try {
    const hit = findActiveByPid(pid, opts);
    if (!hit) return null;
    const sessionDir =
      opts.sessionDir ||
      grokSessionDir(hit.sessionId, hit.cwd, hit.home) ||
      null;
    if (!sessionDir) return null;
    const subagentIds = runningSubagentIds(sessionDir, opts);
    const shellIds =
      typeof opts.openBgShellIds === "function"
        ? opts.openBgShellIds(sessionDir, opts)
        : openBgShellIds(sessionDir, opts);
    return {
      subagentIds,
      shellIds: Array.isArray(shellIds) ? shellIds : [],
      sessionDir,
      source: "grok-meta",
      sessionId: hit.sessionId,
      cwd: hit.cwd,
    };
  } catch {
    return null;
  }
}

// Re-export for callers that only import inventory.
export { grokSessionDir, DEFAULT_GROK, PROFILES_DIR };

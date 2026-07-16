// Agent-status providers convention reader (schema 1). Soft-fail everywhere.
// No caching — callers cache. Zero runtime deps.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPidAlive } from "../curtain/session.mjs";

/**
 * Resolve the agent-status directory.
 * 1. AGENT_STATUS_DIR  2. XDG_RUNTIME_DIR/agent-status  3. ~/.local/state/agent-status
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export const resolveStatusDir = (env = process.env) => {
  try {
    if (env.AGENT_STATUS_DIR) return String(env.AGENT_STATUS_DIR);
    if (env.XDG_RUNTIME_DIR)
      return path.join(String(env.XDG_RUNTIME_DIR), "agent-status");
    return path.join(os.homedir(), ".local", "state", "agent-status");
  } catch {
    return path.join(os.homedir(), ".local", "state", "agent-status");
  }
};

/**
 * Read a JSON file if its lease is still valid.
 * Lease: nowMs - ts < ttl_ms. Corrupt/absent/expired → null.
 * @param {string} file
 * @param {number} nowMs
 * @returns {object|null}
 */
export const readFreshJson = (file, nowMs) => {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const ts = Number(obj.ts ?? obj.updated_at ?? obj.started_at);
    const ttl = Number(obj.ttl_ms);
    if (!Number.isFinite(ts) || !Number.isFinite(ttl) || ttl <= 0) return null;
    const now = Number(nowMs) || 0;
    if (now - ts >= ttl) return null;
    return obj;
  } catch {
    return null;
  }
};

const listJsonDir = (dir, nowMs) => {
  try {
    if (!dir || !fs.existsSync(dir)) return [];
    const names = fs.readdirSync(dir);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const obj = readFreshJson(path.join(dir, name), nowMs);
      if (obj) out.push(obj);
    }
    return out;
  } catch {
    return [];
  }
};

/**
 * @param {string} dir agent-status root
 * @param {number} nowMs
 * @returns {object[]}
 */
export const listProviderHeartbeats = (dir, nowMs) =>
  listJsonDir(path.join(dir || "", "providers"), nowMs);

/**
 * @param {string} dir agent-status root
 * @param {number} nowMs
 * @returns {object[]}
 */
export const listSessionRecords = (dir, nowMs) =>
  listJsonDir(path.join(dir || "", "sessions"), nowMs);

/** Re-export / wrap isPidAlive for armory long-TTL launch records. */
export const isPidAliveOpt = (pid) => {
  try {
    return isPidAlive(pid);
  } catch {
    return false;
  }
};

const WRITER_RANK = Object.freeze({
  "token-oracle": 2,
  "llm-armory": 1,
});

/**
 * Pick best model record for a session.
 * Precedence written_by: token-oracle > llm-armory; among equals, freshest
 * updated_at. llm-armory records require isPidAliveOpt(pid).
 * @param {object[]} records
 * @param {{ sourceCli?: string, pid?: number, cwd?: string }} filter
 * @returns {{ model: string, effort: string, written_by: string } | null}
 */
export const bestModelRecord = (records, { sourceCli, pid, cwd } = {}) => {
  try {
    const list = Array.isArray(records) ? records : [];
    const candidates = [];
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      if (sourceCli && r.source_cli !== sourceCli) continue;
      if (pid != null && Number(pid) > 0 && Number(r.pid) !== Number(pid)) {
        // pid filter optional strictness: if given, prefer matching but allow cwd
        if (cwd && r.cwd === cwd) {
          /* keep */
        } else if (Number(r.pid) !== Number(pid)) continue;
      }
      if (cwd && !pid && r.cwd !== cwd) continue;
      if (r.written_by === "llm-armory") {
        if (!isPidAliveOpt(r.pid)) continue;
      }
      if (!r.model) continue;
      candidates.push(r);
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const ra = WRITER_RANK[a.written_by] || 0;
      const rb = WRITER_RANK[b.written_by] || 0;
      if (rb !== ra) return rb - ra;
      return (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0);
    });
    const best = candidates[0];
    return {
      model: String(best.model),
      effort: String(best.effort || ""),
      written_by: String(best.written_by || ""),
    };
  } catch {
    return null;
  }
};

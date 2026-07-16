// Cached `sage fleet --json` reader. Soft-fail law: every failure → null.
// Contract is CLI JSON only — never raw sage files (spec §4.5).

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE = path.join(os.tmpdir(), "herald-sage-fleet.json");
const CACHE_TTL_MS = 15_000;
const EXEC_TIMEOUT_MS = 400;

/**
 * @param {{ nowMs?: number, cachePath?: string, execFn?: Function }} opts
 * @returns {Promise<object|null>}
 */
export const readSageFleet = async (opts = {}) => {
  try {
    const nowMs = Number(opts.nowMs) || Date.now();
    const cachePath = opts.cachePath || DEFAULT_CACHE;
    const execFn =
      typeof opts.execFn === "function"
        ? opts.execFn
        : async () => {
            const { stdout } = await execFileAsync(
              "sage",
              ["fleet", "--json"],
              {
                timeout: EXEC_TIMEOUT_MS,
                maxBuffer: 256 * 1024,
                encoding: "utf8",
              },
            );
            return stdout;
          };

    // Fresh cache? Use payload._herald_cached_at so tests can inject nowMs
    // without fighting wall-clock mtime.
    try {
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, "utf8");
        const wrap = JSON.parse(raw);
        const cachedAt = Number(wrap?._herald_cached_at);
        const payload = wrap?._herald_payload ?? wrap;
        if (
          Number.isFinite(cachedAt) &&
          nowMs - cachedAt < CACHE_TTL_MS &&
          payload &&
          typeof payload === "object"
        ) {
          return payload;
        }
      }
    } catch {
      /* fall through to exec */
    }

    let stdout;
    try {
      stdout = await execFn();
    } catch {
      return null;
    }
    if (stdout == null || stdout === "") return null;
    let obj;
    try {
      obj = typeof stdout === "string" ? JSON.parse(stdout) : stdout;
    } catch {
      return null;
    }
    if (!obj || typeof obj !== "object") return null;

    try {
      const dir = path.dirname(cachePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({ _herald_cached_at: nowMs, _herald_payload: obj }),
      );
      fs.renameSync(tmp, cachePath);
    } catch {
      /* cache write best-effort */
    }
    return obj;
  } catch {
    return null;
  }
};

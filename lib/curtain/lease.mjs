// Pure truth-lease algebra. No I/O.
// Every WORKING hold is a lease {kind, id, exp}; expired leases stop counting.

/** @typedef {{ kind: string, id: string, exp: number }} Lease */

export const LEASE_KINDS = Object.freeze([
  "subagent",
  "watcher",
  "bg_shell",
  "turn",
]);

/** Defaults merged under curtain.lease. */
export const LEASE_DEFAULTS = Object.freeze({
  subagentTtlSec: 120,
  watcherTtlSec: 900,
  bgShellTtlSec: 120,
  turnTtlSec: 120,
});

const TTL_KEYS = Object.freeze({
  subagent: "subagentTtlSec",
  watcher: "watcherTtlSec",
  bg_shell: "bgShellTtlSec",
  turn: "turnTtlSec",
});

/**
 * @param {string} kind
 * @param {object} [cfg]
 * @returns {number}
 */
export const ttlSecFor = (kind, cfg = {}) => {
  const key = TTL_KEYS[kind] || "subagentTtlSec";
  const merged = { ...LEASE_DEFAULTS, ...cfg };
  const n = Number(merged[key]);
  return Number.isFinite(n) && n > 0 ? n : LEASE_DEFAULTS[key] || 120;
};

/**
 * @param {unknown} id
 * @param {string} kind
 * @returns {string}
 */
const sanitizeId = (id, kind) => {
  const s = String(id ?? "")
    .replace(/[,:]/g, "_")
    .trim();
  return s || `anon-${kind}`;
};

/**
 * @param {string} [str]
 * @returns {Lease[]}
 */
export const parseLeases = (str) => {
  if (!str || typeof str !== "string") return [];
  const out = [];
  for (const part of str.split(",")) {
    if (!part) continue;
    const segs = part.split(":");
    if (segs.length !== 3) continue;
    const [kind, id, expRaw] = segs;
    if (!kind || !id) continue;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp)) continue;
    out.push({ kind, id, exp });
  }
  return out;
};

/**
 * @param {Lease[]} leases
 * @returns {string}
 */
export const serializeLeases = (leases) => {
  if (!Array.isArray(leases) || leases.length === 0) return "";
  return leases.map((l) => `${l.kind}:${l.id}:${l.exp}`).join(",");
};

/**
 * @param {Lease[]} leases
 * @param {number} nowSec
 * @returns {Lease[]}
 */
export const pruneExpired = (leases, nowSec) => {
  const now = Number(nowSec) || 0;
  if (!Array.isArray(leases)) return [];
  return leases.filter((l) => l && Number(l.exp) > now);
};

/**
 * @param {Lease[]} leases
 * @param {string} kind
 * @param {unknown} id
 * @param {number} nowSec
 * @param {object} [cfg]
 * @returns {Lease[]}
 */
export const grant = (leases, kind, id, nowSec, cfg = {}) => {
  const now = Number(nowSec) || 0;
  const sid = sanitizeId(id, kind);
  const exp = now + ttlSecFor(kind, cfg);
  const base = Array.isArray(leases) ? leases : [];
  let found = false;
  const out = base.map((l) => {
    if (l.kind === kind && l.id === sid) {
      found = true;
      return { kind, id: sid, exp };
    }
    return { ...l };
  });
  if (!found) out.push({ kind, id: sid, exp });
  return out;
};

/**
 * @param {Lease[]} leases
 * @param {string} kind
 * @param {unknown} id
 * @returns {Lease[]}
 */
export const release = (leases, kind, id) => {
  const sid = sanitizeId(id, kind);
  if (!Array.isArray(leases)) return [];
  return leases.filter((l) => !(l.kind === kind && l.id === sid));
};

/**
 * Exact live set for kind: keep/create listed ids with fresh exp; drop others of kind.
 * @param {Lease[]} leases
 * @param {string} kind
 * @param {unknown[]} ids
 * @param {number} nowSec
 * @param {object} [cfg]
 * @returns {Lease[]}
 */
export const reconcile = (leases, kind, ids, nowSec, cfg = {}) => {
  const now = Number(nowSec) || 0;
  const want = new Set(
    (Array.isArray(ids) ? ids : []).map((id) => sanitizeId(id, kind)),
  );
  const base = Array.isArray(leases) ? leases : [];
  const others = base.filter((l) => l.kind !== kind).map((l) => ({ ...l }));
  const out = [...others];
  for (const id of want) {
    out.push({ kind, id, exp: now + ttlSecFor(kind, cfg) });
  }
  return out;
};

/**
 * Re-arm every non-expired lease. Expired leases are NOT resurrected.
 * @param {Lease[]} leases
 * @param {number} nowSec
 * @param {object} [cfg]
 * @returns {Lease[]}
 */
export const touch = (leases, nowSec, cfg = {}) => {
  const now = Number(nowSec) || 0;
  if (!Array.isArray(leases)) return [];
  return leases
    .filter((l) => l && Number(l.exp) > now)
    .map((l) => ({
      kind: l.kind,
      id: l.id,
      exp: now + ttlSecFor(l.kind, cfg),
    }));
};

/**
 * @param {Lease[]} leases
 * @param {number} nowSec
 * @returns {{ subagent: number, watcher: number, bg_shell: number, turn: number }}
 */
export const countLive = (leases, nowSec) => {
  const counts = { subagent: 0, watcher: 0, bg_shell: 0, turn: 0 };
  for (const l of pruneExpired(leases, nowSec)) {
    if (l.kind in counts) counts[l.kind] += 1;
  }
  return counts;
};

/**
 * @param {Lease[]} leases
 * @param {number} nowSec
 * @returns {boolean}
 */
export const hasLive = (leases, nowSec) => {
  const c = countLive(leases, nowSec);
  return c.subagent + c.watcher + c.bg_shell + c.turn > 0;
};

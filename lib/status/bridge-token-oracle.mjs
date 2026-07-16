// Thin bridge to token-oracle published forecast.json (read) + ingest feed hook.
// Default path: ~/.local/share/token-oracle/forecast.json
// Never throws; best-effort only. TOKEN_FORECAST_* paths removed (D3).

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_DATA = path.join(
  os.homedir(),
  ".local",
  "share",
  "token-oracle",
  "forecast.json",
);

// Defaults match live usage_limits / operator max20 plan (57M / 270M).
const DEFAULT_CAPS = { fiveHourCap: 57000000, weeklyCap: 270000000 };

function loadJsonSafe(p) {
  return fs
    .readFile(p, "utf8")
    .then((t) => JSON.parse(t))
    .catch(() => ({}));
}

/** Match a window entry by name (oracle windows[] or legacy keys). */
function pickWindow(snap, which) {
  if (!snap || typeof snap !== "object") return null;
  // Legacy flat shape (pre-oracle) kept only if present in injectable fixtures.
  if (which === "five_hour" && snap.five_hour)
    return { legacy: snap.five_hour };
  if (which === "seven_day" && snap.seven_day)
    return { legacy: snap.seven_day };
  const list = Array.isArray(snap.windows) ? snap.windows : [];
  const re =
    which === "five_hour" ? /five|5[_\s-]?h|5h/i : /seven|week|7[_\s-]?d|7d/i;
  const w = list.find((x) => re.test(String(x?.window || x?.name || "")));
  return w ? { oracle: w } : null;
}

function windowView(which, snap, now = Date.now() / 1000) {
  const picked = pickWindow(snap, which);
  if (!picked) return null;

  if (picked.legacy) {
    const r = picked.legacy;
    if (!r || typeof r.resets_at !== "number") return null;
    const secs = which === "five_hour" ? 5 * 3600 : 7 * 24 * 3600;
    let reset = r.resets_at;
    let stale = false;
    while (reset <= now) {
      reset += secs;
      stale = true;
    }
    const usedPct = stale
      ? null
      : typeof r.used_percentage === "number"
        ? r.used_percentage
        : null;
    return {
      usedPercentage: usedPct,
      resetsAt: reset,
      secsToReset: reset - now,
      observedAt: r.observed_at || null,
      stale,
      used: null,
      cap: null,
    };
  }

  const w = picked.oracle;
  const resetIn = Number(w.reset_in_secs);
  const resetsAt = Number.isFinite(resetIn) ? now + resetIn : null;
  const usedPct =
    typeof w.projected_pct === "number"
      ? w.projected_pct
      : typeof w.used_percentage === "number"
        ? w.used_percentage
        : null;
  const used = Number.isFinite(Number(w.used)) ? Number(w.used) : null;
  const cap = Number.isFinite(Number(w.cap)) ? Number(w.cap) : null;
  return {
    usedPercentage: usedPct,
    resetsAt,
    secsToReset: Number.isFinite(resetIn) ? resetIn : null,
    observedAt: w.observed_at || snap.generated_at || null,
    stale: false,
    used,
    cap,
  };
}

export async function readAccountUsage(opts = {}) {
  try {
    const snapPath = opts.snapshotPath || DEFAULT_DATA;
    const snap = await loadJsonSafe(snapPath);
    const now = opts.now ?? Date.now() / 1000;
    const five = windowView("five_hour", snap, now);
    const weekly = windowView("seven_day", snap, now);
    const caps = { ...DEFAULT_CAPS };
    if (five?.cap) caps.fiveHourCap = five.cap;
    if (weekly?.cap) caps.weeklyCap = weekly.cap;
    return {
      fiveHour: five,
      weekly,
      caps,
    };
  } catch {
    return {
      fiveHour: null,
      weekly: null,
      caps: { ...DEFAULT_CAPS },
    };
  }
}

export async function feedSnapshot(data, opts = {}) {
  const cmd = opts.command || process.env.HERALD_TOKEN_FEED || "";
  if (!cmd) return;
  try {
    const payload = JSON.stringify(data || {});
    await new Promise((resolve) => {
      const p = execFile(cmd, [], { timeout: 1500, maxBuffer: 64 * 1024 }, () =>
        resolve(),
      );
      try {
        p.stdin.write(payload);
        p.stdin.end();
      } catch {
        resolve();
      }
    });
  } catch {
    // best effort
  }
}

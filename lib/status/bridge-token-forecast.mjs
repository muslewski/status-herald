// Thin bridge to token-forecast published snapshot (read) + ingest hook (feed).
// Mirrors the read path of usage_blocks + RL.* ; feed delegates to external tiny python.
// Never throws; best-effort only.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_DATA = path.join(
  os.homedir(),
  ".local",
  "share",
  "token-forecast",
  "snapshot.json",
);

// Defaults match usage_limits.py + herald interim
const DEFAULT_CAPS = { fiveHourCap: 220000, weeklyCap: 8000000 };

function loadJsonSafe(p) {
  return fs
    .readFile(p, "utf8")
    .then((t) => JSON.parse(t))
    .catch(() => ({}));
}

function windowView(win, snap, now = Date.now() / 1000) {
  const r = snap?.[win === "five_hour" ? "five_hour" : "seven_day"] || null;
  if (!r || typeof r.resets_at !== "number") return null;
  const secs = win === "five_hour" ? 5 * 3600 : 7 * 24 * 3600;
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
  };
}

export async function readAccountUsage(opts = {}) {
  const snapPath =
    opts.snapshotPath || process.env.TOKEN_FORECAST_SNAPSHOT || DEFAULT_DATA;
  const snap = await loadJsonSafe(snapPath);
  const now = opts.now ?? Date.now() / 1000;
  const five = windowView("five_hour", snap, now);
  const weekly = windowView("seven_day", snap, now);
  // caps: best effort, no hard dep on usage_limits
  const caps = { ...DEFAULT_CAPS };
  try {
    // optional: could read ~/.claude/usage-limits.json but keep simple for 019
  } catch {}
  return {
    fiveHour: five,
    weekly,
    caps,
  };
}

export async function feedSnapshot(data, opts = {}) {
  const cmd = opts.command || process.env.HERALD_TOKEN_FEED || "";
  if (!cmd) return;
  try {
    const payload = JSON.stringify(data || {});
    // fire and forget, short timeout
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

// Claude Code statusline surface: capture effort sidecar + optional snapshot
// feed, then render (or blank) the bar. Fail-open → "".

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.mjs";
import { feedSnapshot } from "./bridge-token-oracle.mjs";
import { getAccountGauges } from "./compute.mjs";
import { writeSessionMeta } from "./side-effects.mjs";

const GREY = "\x1b[38;5;244m";
const CHIP_FG = "\x1b[1;38;5;231m";
// Dark ink for the amber WORKING chip: white-on-amber(214) fails WCAG (~1.9:1),
// so this chip alone uses near-black on amber for readable contrast (RECONCILE R2).
const WORK_FG = "\x1b[1;38;5;232m";
const WAIT_BG = "\x1b[48;5;94m";
const WORK_BG = "\x1b[48;5;214m"; // amber (Flow) — matches wash comet + curtain card
const RESET = "\x1b[0m";
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is intentional for ANSI strip
const _ANSI = /\x1b\[[0-9;]*m/g;

const DEFAULT_META_DIR = join(homedir(), ".claude", "session-meta");
const DEFAULT_NOTIFY_CONF = join(
  homedir(),
  ".claude",
  "hooks",
  "notify-mode.conf",
);

function stripAnsi(s) {
  return String(s || "").replace(_ANSI, "");
}

function fmtDur(secs) {
  if (secs == null || !Number.isFinite(secs)) return "";
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (s < 600) return `${m}m${r}s`;
  if (s < 3600) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h${String(mm).padStart(2, "0")}m`;
}

function fmtWindow(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1000000) {
    const m = n / 1000000;
    return m === Math.floor(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  return `${Math.floor(n / 1000)}k`;
}

/** Claude statusline model badge: "Opus 4.8 (1M) 🧠xhigh" style. */
export function modelBadgeLong(model, contextWindow, effort) {
  const m = model || {};
  let name = m.display_name || m.id || "?";
  let size = contextWindow?.context_window_size;
  if (!size && m.id) {
    const id = String(m.id).toLowerCase();
    size = /opus-4|sonnet-4|1m/.test(id) ? 1000000 : 200000;
  }
  const win = fmtWindow(size);
  if (
    win &&
    !String(name).toLowerCase().includes("context") &&
    !/\d+\s*[kKmM]\b/.test(name)
  ) {
    name = `${name} (${win})`;
  }
  const level = effort?.level;
  if (level) name = `${name} 🧠${level}`;
  return name;
}

export function notifyModeIcon(confPath = DEFAULT_NOTIFY_CONF) {
  let mode = "night";
  try {
    const txt = readFileSync(confPath, "utf8");
    for (const line of txt.split("\n")) {
      if (line.startsWith("MODE=")) mode = line.slice(5).trim();
    }
  } catch {
    /* default */
  }
  return { night: "🌙", day: "☀️", off: "🔕" }[mode] || "❓";
}

/** Pure assemble of the Claude statusline string. */
export function renderClaudeBarString({
  status = "",
  elapsedSecs = null,
  modelNm = "?",
  notifyIcon = "❓",
  columns = 0,
  resetNote = null,
  forecastParts = [],
} = {}) {
  const dur = fmtDur(elapsedSecs);
  let bg = null;
  let chip;
  if (status === "idle") {
    bg = WAIT_BG;
    chip = `${CHIP_FG}⌨️ your turn${dur ? ` · ${dur}` : ""}${RESET}`;
  } else if (status === "busy" || status === "shell" || status === "working") {
    bg = WORK_BG;
    chip = `${WORK_FG}● working${dur ? ` · ${dur}` : ""}${RESET}`;
  } else {
    chip = `${GREY}▶${dur ? ` ${dur}` : ""}${RESET}`;
  }
  const parts = [chip];
  if (resetNote) parts.push(resetNote);
  for (const p of forecastParts || []) {
    if (p) parts.push(p);
  }
  parts.push(`· ${modelNm}`);
  parts.push(notifyIcon);
  const s = parts.join("  ");
  if (!bg) return s;
  const body = s.replaceAll(RESET, RESET + bg);
  const width = [...stripAnsi(s)].reduce(
    (w, ch) => w + (ch.codePointAt(0) < 128 ? 1 : 2),
    0,
  );
  const pad = Math.max(0, (Number(columns) || 0) - width);
  return `${bg}${body}${" ".repeat(pad)}${RESET}`;
}

/**
 * Full Claude statusline entry: parse stdin JSON, write sidecar, feed snapshot,
 * optionally render. Always fail-open to "".
 */
export async function renderClaudeStatusline(jsonFromStdin, opts = {}) {
  try {
    const data =
      jsonFromStdin && typeof jsonFromStdin === "object" ? jsonFromStdin : {};
    const fullCfg = opts.config || loadConfig();
    const bars = fullCfg.bars || {};
    const silent =
      opts.silent === true ||
      bars.claude?.enabled === false ||
      bars.claude?.silentCapture === true;

    const model = data.model || {};
    const effort = data.effort || {};
    const modelDisplay = model.display_name || model.id || "";
    const effortLevel = effort.level || "";
    const sessionId = data.session_id || "";

    const metaDir = opts.metaDir || DEFAULT_META_DIR;
    writeSessionMeta(sessionId, modelDisplay, effortLevel, metaDir);

    try {
      await feedSnapshot(data, { command: opts.feedCommand || "" });
    } catch {
      /* ignore */
    }

    if (silent) return "";

    const modelNm = modelBadgeLong(model, data.context_window, effort);
    let status = "";
    let elapsed = null;
    if (typeof opts.findSession === "function") {
      try {
        const me = await opts.findSession(sessionId);
        if (me) {
          status = me.status || "";
          const la = me.lastActivity || me.last_activity;
          if (la) {
            const nowSec = opts.now ?? Date.now() / 1000;
            const laSec = la > 1e12 ? la / 1000 : la;
            elapsed = nowSec - laSec;
          }
        }
      } catch {
        /* neutral */
      }
    }

    const forecastParts = opts.forecastParts ? [...opts.forecastParts] : [];
    if (!forecastParts.length && opts.includeSnapshotForecast) {
      try {
        const account = await getAccountGauges({
          snapshotPath: opts.snapshotPath,
          now: opts.now,
        });
        if (account.fiveHour?.usedPercentage != null) {
          forecastParts.push(
            `${GREY}🕐 →${Math.round(account.fiveHour.usedPercentage)}%${RESET}`,
          );
        }
        if (account.weekly?.usedPercentage != null) {
          forecastParts.push(
            `${GREY}📅 →${Math.round(account.weekly.usedPercentage)}%${RESET}`,
          );
        }
      } catch {
        /* ignore */
      }
    }

    let columns = opts.columns;
    if (columns == null) {
      columns = Number(process.env.COLUMNS) || 0;
    }

    const notifyIcon =
      opts.notifyIcon ||
      notifyModeIcon(opts.notifyConfPath || DEFAULT_NOTIFY_CONF);

    return renderClaudeBarString({
      status,
      elapsedSecs: elapsed,
      modelNm,
      notifyIcon,
      columns,
      resetNote: opts.resetNote || null,
      forecastParts,
    });
  } catch {
    return "";
  }
}

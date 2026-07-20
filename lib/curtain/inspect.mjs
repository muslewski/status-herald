// Stage-manager: `herald curtain inspect` — fleet stage board + session detail.
// Pure row/render helpers are unit-testable; I/O (tmux opts, fzf) is injected.

import { countLive, parseLeases } from "./lease.mjs";
import { formatElapsed } from "./state.mjs";

/** @type {Record<string, string>} */
const STATE_GLYPH = Object.freeze({
  working: "●",
  compacting: "⟳",
  done: "✅",
  needs: "⚠",
  idle: "—",
});

/** @type {Record<string, string>} */
const STATE_LABEL = Object.freeze({
  working: "WORKING",
  compacting: "COMPACTING",
  done: "DONE",
  needs: "NEEDS",
  idle: "IDLE",
});

/**
 * @param {string} name
 * @param {Record<string, string>|((k: string) => string)} opts
 * @param {number} nowSec
 */
export const boardRowFromOpts = (name, opts, nowSec) => {
  const g = typeof opts === "function" ? opts : (k) => opts?.[k] ?? "";
  const now = Number(nowSec) || 0;
  const state = String(g("@herald_state") || "idle").toLowerCase() || "idle";
  const leases = parseLeases(g("@herald_leases"));
  const c = countLive(leases, now);
  const since = Number(g("@herald_since")) || 0;
  const lastHook = Number(g("@herald_last_hook")) || 0;
  const lastActive = Number(g("@herald_last_active")) || 0;
  const covered = g("@herald_covered") === "1";
  const paused = g("@herald_paused") === "1";
  return {
    name: String(name || ""),
    state,
    glyph: STATE_GLYPH[state] || STATE_GLYPH.idle,
    label: STATE_LABEL[state] || state.toUpperCase(),
    covered,
    paused,
    host: g("@herald_host_kind") || "synthesis",
    theme: g("@herald_theme") || "",
    subagents: c.subagent,
    shells: c.bg_shell,
    monitors: c.watcher,
    turns: c.turn,
    elapsedSec: since > 0 ? Math.max(0, now - since) : 0,
    hookAgeSec: lastHook > 0 ? Math.max(0, now - lastHook) : null,
    activeAgeSec: lastActive > 0 ? Math.max(0, now - lastActive) : null,
    worked: Number(g("@herald_worked")) || 0,
    leasesRaw: g("@herald_leases") || "",
  };
};

/**
 * One mini-card line for the stage board.
 * @param {ReturnType<typeof boardRowFromOpts>} row
 * @returns {string}
 */
export const renderMiniCard = (row) => {
  const age = row.hookAgeSec == null ? "no hook" : `${row.hookAgeSec}s`;
  const cover = row.paused ? "paused" : row.covered ? "cover" : "reveal";
  const clock = formatElapsed(row.elapsedSec);
  // Fixed-ish columns so non-TTY boards scan as a grid.
  const name = String(row.name).padEnd(12).slice(0, 12);
  const st = `${row.glyph} ${row.label}`.padEnd(14);
  const kinds = `shells ${row.shells} · monitors ${row.monitors} · subagents ${row.subagents}`;
  return `  ${name}  ${st}  ${clock.padStart(5)}  ${kinds}  ${cover}  age ${age}`;
};

/**
 * @param {ReturnType<typeof boardRowFromOpts>[]} rows
 * @returns {string}
 */
export const renderStageBoard = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "no armed sessions\n";
  const armed = list.length;
  const covered = list.filter((r) => r.covered).length;
  const lines = [
    `╔ HERALD STAGE · ${armed} armed · ${covered} covered ╗`,
    ...list.map(renderMiniCard),
  ];
  return `${lines.join("\n")}\n`;
};

/**
 * Full drill-in detail for one session.
 * @param {ReturnType<typeof boardRowFromOpts>} row
 * @param {Record<string, string>|((k: string) => string)} [opts]
 * @param {number} [nowSec]
 * @returns {string}
 */
export const renderSessionDetail = (row, opts, nowSec) => {
  // Prefer the already-built row; opts re-read only for extra keys.
  const g =
    typeof opts === "function" ? opts : opts ? (k) => opts[k] ?? "" : () => "";
  const settle = g("@herald_settle_ts") || "";
  const pid = g("@herald_agent_pid") || "";
  const model = g("@herald_model_hint") || "";
  const lines = [
    `session  ${row.name}`,
    `  state      ${row.state}  ${row.glyph} ${row.label}`,
    `  covered    ${row.covered ? "1" : "0"}`,
    `  host       ${row.host}`,
    `  theme      ${row.theme || "—"}`,
    `  elapsed    ${formatElapsed(row.elapsedSec)}`,
    `  shells     ${row.shells}`,
    `  monitors   ${row.monitors}`,
    `  subagents  ${row.subagents}`,
    `  turns      ${row.turns}`,
    `  last-hook  ${row.hookAgeSec == null ? "never" : `${row.hookAgeSec}s ago`}`,
    `  last-active${row.activeAgeSec == null ? " never" : ` ${row.activeAgeSec}s ago`}`,
  ];
  if (row.worked) lines.push(`  worked     ${formatElapsed(row.worked)}`);
  if (settle) {
    const now = Number(nowSec) || 0;
    const ts = Number(settle) || 0;
    const age = ts && now ? `${now - ts}s ago` : settle;
    lines.push(`  settle_ts  ${age}`);
  }
  if (pid) lines.push(`  agent_pid  ${pid}`);
  if (model) lines.push(`  model      ${model}`);
  if (row.leasesRaw) lines.push(`  leases     ${row.leasesRaw}`);
  else lines.push("  leases     (none)");
  return `${lines.join("\n")}\n`;
};

/**
 * fzf label line (one session).
 * @param {ReturnType<typeof boardRowFromOpts>} row
 */
export const fzfLabel = (row) =>
  `${row.name}\t${row.glyph} ${row.label}\t${formatElapsed(row.elapsedSec)}\tshells ${row.shells} monitors ${row.monitors} subagents ${row.subagents}`;

/**
 * Orchestrate board / detail / optional fzf drill-in.
 * Pure when fzfPick is injected; no process I/O here.
 *
 * @param {{
 *   names: string[],
 *   getSessOpt: (name: string, key: string) => string,
 *   nowSec: number,
 *   sessionArg?: string,
 *   tty?: boolean,
 *   fzfAvailable?: boolean,
 *   fzfPick?: (lines: string[]) => string,
 * }} p
 * @returns {{ text: string, exitCode: number, picked: string|null }}
 */
export const runInspect = (p) => {
  const now = Number(p.nowSec) || 0;
  const get = p.getSessOpt;
  const names = Array.isArray(p.names) ? p.names.filter(Boolean) : [];
  const sessionArg = p.sessionArg ? String(p.sessionArg) : "";

  if (sessionArg) {
    const row = boardRowFromOpts(
      sessionArg,
      (k) => get(sessionArg, k) || "",
      now,
    );
    const detail = renderSessionDetail(
      row,
      (k) => get(sessionArg, k) || "",
      now,
    );
    return { text: detail, exitCode: 0, picked: sessionArg };
  }

  if (!names.length) {
    return { text: "no armed sessions\n", exitCode: 0, picked: null };
  }

  const rows = names.map((n) =>
    boardRowFromOpts(n, (k) => get(n, k) || "", now),
  );
  const board = renderStageBoard(rows);

  const wantFzf =
    p.tty &&
    p.fzfAvailable &&
    typeof p.fzfPick === "function" &&
    names.length > 0;

  if (!wantFzf) {
    return { text: board, exitCode: 0, picked: null };
  }

  const labels = rows.map(fzfLabel);
  let pick = "";
  try {
    pick = String(p.fzfPick(labels) || "").trim();
  } catch {
    pick = "";
  }
  // fzf may return the full label line; take the session name (first field).
  const pickedName = pick ? pick.split(/\t|\s+/)[0] : "";
  if (!pickedName || !names.includes(pickedName)) {
    return { text: board, exitCode: 0, picked: null };
  }
  const row = rows.find((r) => r.name === pickedName) || rows[0];
  const detail = renderSessionDetail(row, (k) => get(pickedName, k) || "", now);
  return {
    text: `${board}\n${detail}`,
    exitCode: 0,
    picked: pickedName,
  };
};

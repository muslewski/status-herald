// Pure status-bar engine: segment registry, role→color mapping for render
// modes (tmux/ansi/plain), gauge thresholds, priority-based width drop.
// Zero runtime deps. All inputs via args; fully hermetic for unit tests.
// No fs, child_process, process, Date, tmux.

import { color, tmuxColor } from "../render.mjs";

export const ROLES = {
  ok: { ansi: 32, tmux: "colour46" },
  notice: { ansi: 36, tmux: "colour51" },
  warn: { ansi: 33, tmux: "colour226" },
  crit: { ansi: 31, tmux: "colour196" },
  over: { ansi: 91, tmux: "colour201" },
  accent: { ansi: 93, tmux: "colour214" },
  dim: { ansi: 90, tmux: "colour244" },
};

export const roleColor = (role, mode) => {
  const r = ROLES[role];
  if (!r) return (text) => text;
  if (mode === "plain") return (text) => text;
  if (mode === "ansi") return (text) => color(text, { fg: r.ansi });
  if (mode === "tmux") return (text) => tmuxColor(text, r.tmux);
  return (text) => text;
};

export const gaugeRole = (pct) => {
  if (!Number.isFinite(pct)) return "ok";
  if (pct < 85) return "ok";
  if (pct < 100) return "warn";
  if (pct < 120) return "crit";
  return "over";
};

export const orderSegments = (registry = {}, config = {}) => {
  const segCfg = config.segments || {};
  const list = Object.entries(registry).map(([id, base]) => {
    const over = segCfg[id] || {};
    const merged = { ...base, ...over, id };
    return merged;
  });
  const enabled = list.filter((s) => s.enabled !== false);
  // stable sort by order (ascending); modern Array#sort is stable so same-order
  // items retain their relative order from Object.entries (definition order).
  enabled.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return enabled;
};

export const renderLine = (items, { mode, width, sep } = {}) => "";

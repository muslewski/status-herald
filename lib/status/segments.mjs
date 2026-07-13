// Pure status-bar engine: segment registry, role→color mapping for render
// modes (tmux/ansi/plain), gauge thresholds, priority-based width drop.
// Zero runtime deps. All inputs via args; fully hermetic for unit tests.
// No fs, child_process, process, Date, tmux.

import { color, tmuxColor, visibleWidth } from "../render.mjs";

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

export const renderLine = (
  items = [],
  { mode = "plain", width, sep = "  " } = {},
) => {
  if (!Array.isArray(items) || items.length === 0) return "";

  const isUnlimited = width == null || width <= 0;

  // working copies carry choice state; do not mutate caller items
  let working = items.map((it) => ({
    ...it,
    _usingShort: false,
  }));

  const getPlain = (w) =>
    w._usingShort && w.short != null ? w.short : (w.text ?? "");

  const joinPlain = (list) => list.map(getPlain).join(sep);

  const measure = (list) => visibleWidth(joinPlain(list));

  if (!isUnlimited) {
    // Phase A: shorten lowest-pri first (rightmost on prio tie)
    while (measure(working) > width) {
      const cands = working
        .map((w, i) => ({ w, i }))
        .filter(
          ({ w }) =>
            !w._usingShort &&
            w.short != null &&
            visibleWidth(w.short) < visibleWidth(w.text ?? ""),
        );
      if (cands.length === 0) break;
      const minP = Math.min(...cands.map((c) => c.w.priority ?? 0));
      const tied = cands.filter((c) => (c.w.priority ?? 0) === minP);
      // rightmost-lowest: highest original display index
      const chosen = tied.reduce((best, cur) => (cur.i > best.i ? cur : best));
      chosen.w._usingShort = true;
    }

    // Phase B: drop lowest-pri (rightmost on tie) until fits or 1 remains
    while (measure(working) > width && working.length > 1) {
      const minP = Math.min(...working.map((w) => w.priority ?? 0));
      const tied = working
        .map((w, i) => ({ w, i }))
        .filter((c) => (c.w.priority ?? 0) === minP);
      const chosen = tied.reduce((best, cur) => (cur.i > best.i ? cur : best));
      working = working.filter((_, idx) => idx !== chosen.i);
    }
  }

  // color the survivors (in kept relative order) and join
  const colored = working.map((w) => {
    const txt = getPlain(w);
    const colorFn = roleColor(w.role, mode);
    return colorFn(txt);
  });
  return colored.join(sep);
};

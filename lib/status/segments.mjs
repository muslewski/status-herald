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

// --- Slice 2 segment builders (produce {id, text, short?, role, priority} for renderLine) ---

const _CTX_EMOJI = ["😴", "😌", "🙂", "😐", "😬", "😅", "😰", "😨", "😱", "💀"];
const _BAR_W = 8;

function _ctxEmoji(used) {
  const idx = Math.min(
    _CTX_EMOJI.length - 1,
    Math.max(0, Math.floor(used / 100000)),
  );
  return _CTX_EMOJI[idx];
}

function _barColorRole(pct) {
  if (pct >= 120) return "over";
  if (pct >= 100) return "crit";
  if (pct >= 85) return "warn";
  if (pct >= 50) return "ok";
  return "notice";
}

function fmtTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.floor(n / 1000)}k`;
}

export function buildContextItem(data = {}) {
  const { used = 0, win = 1000000, pct = 0, messages = 0 } = data;
  const emoji = _ctxEmoji(used);
  const filled = Math.max(
    0,
    Math.min(_BAR_W, Math.round((pct / 100) * _BAR_W)),
  );
  const bar = "█".repeat(filled) + "░".repeat(_BAR_W - filled);
  const wl = win >= 1000000 ? "1M" : `${Math.floor(win / 1000)}k`;
  const text = `${emoji} ${bar} ${pct}% ${Math.floor(used / 1000)}k/${wl} 💬 ${messages}`;
  return {
    id: "context",
    text,
    role: _barColorRole(pct),
    priority: 100,
  };
}

export function buildAccountSliderItem(which, data = {}) {
  // which: 'account5h' | 'accountWeekly'
  // data: { used, projected_pct or similar, cap? } or from usage block
  const is5h = which === "account5h";
  const emoji = is5h ? "🕐" : "📅";
  const used = data.used || 0;
  const cap = data.cap || (is5h ? 220000 : 8000000);
  const pct = cap ? (used / cap) * 100 : 0;
  const filled = Math.max(
    0,
    Math.min(_BAR_W, Math.round((pct / 100) * _BAR_W)),
  );
  const bar = "█".repeat(filled) + "░".repeat(_BAR_W - filled);
  const role = _barColorRole(pct);
  const text = `${emoji} ${bar} ${fmtTokens(used)}/${fmtTokens(cap)}`;
  return { id: which, text, role, priority: is5h ? 30 : 20 };
}

export function buildModelItem(badge = "") {
  if (!badge) return null;
  return { id: "model", text: badge, role: "accent", priority: 60 };
}

export function buildStateItem(glyph = "") {
  if (!glyph) return null;
  return { id: "state", text: glyph, role: "dim", priority: 90 };
}

// Concrete registry for use by surfaces. Each entry has render(ctx) -> Item|null
// ctx will contain compute data from 019 (e.g. ctx.session, ctx.account etc.)
export const REGISTRY = {
  context: {
    enabled: true,
    priority: 100,
    order: 10,
    render(ctx) {
      if (!ctx || !ctx.session || !ctx.session.context) return null;
      return buildContextItem(ctx.session.context);
    },
  },
  model: {
    enabled: false,
    priority: 60,
    order: 20,
    render(ctx) {
      const badge = ctx?.session?.modelBadge;
      return badge ? buildModelItem(badge) : null;
    },
  },
  state: {
    enabled: true,
    priority: 90,
    order: 15,
    render(ctx) {
      const g = ctx?.session?.stateGlyph;
      return g ? buildStateItem(g) : null;
    },
  },
  account5h: {
    enabled: true,
    priority: 30,
    order: 50,
    render(ctx) {
      if (!ctx || !ctx.account || !ctx.account.fiveHour) return null;
      return buildAccountSliderItem("account5h", {
        used: ctx.account.fiveHour.used || 0,
        cap: ctx.caps?.fiveHourCap || 220000,
      });
    },
  },
  accountWeekly: {
    enabled: true,
    priority: 20,
    order: 60,
    render(ctx) {
      if (!ctx || !ctx.account || !ctx.account.weekly) return null;
      return buildAccountSliderItem("accountWeekly", {
        used: ctx.account.weekly.used || 0,
        cap: ctx.caps?.weeklyCap || 8000000,
      });
    },
  },
  // clock and notify can be added later as pure time-based or from other ctx
};

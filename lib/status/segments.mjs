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

// --- Slice 2 segment builders (parity strings for tmux/claude bars) ---
// Python embeds #[fg=…] in the string; herald keeps plain text + semantic role
// and lets renderLine apply mode-specific color (tmux/ansi/plain).

const _CTX_EMOJI = ["😴", "😌", "🙂", "😐", "😬", "😅", "😰", "😨", "😱", "💀"];
const _BAR_W = 8;

function _ctxEmoji(used) {
  const idx = Math.min(
    _CTX_EMOJI.length - 1,
    Math.max(0, Math.floor(Number(used) / 100000) || 0),
  );
  return _CTX_EMOJI[idx];
}

// Account slider color bands (Python session-sync._bar_color): 50/85/100/120.
// Mapped onto 018 ROLES (notice=cyan, ok=green, warn=yellow, crit≈orange/red, over).
function _accountRole(pct) {
  if (!Number.isFinite(pct)) return "notice";
  if (pct >= 120) return "over";
  if (pct >= 100) return "crit";
  if (pct >= 85) return "warn";
  if (pct >= 50) return "ok";
  return "notice";
}

function _fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  return `${Math.floor(v / 1000)}k`;
}

function _bar8(pct) {
  const filled = Math.max(
    0,
    Math.min(_BAR_W, Math.round((Number(pct) / 100) * _BAR_W) || 0),
  );
  return "█".repeat(filled) + "░".repeat(_BAR_W - filled);
}

/** Window label: 500000 → 500k, 1000000 → 1M. */
function _winLabel(win) {
  const w = Number(win) || 0;
  if (w >= 1_000_000 && w % 1_000_000 === 0) return `${w / 1_000_000}M`;
  if (w >= 1000) return `${Math.round(w / 1000)}k`;
  return String(w);
}

/**
 * Per-session context gauge item (Python _ctx_segment plain core).
 * Example plain: "😐 ███░░░░░ 35% 351k/1M 💬 5"
 * Always includes 💬 message count (user messages sent in this session).
 */
export function buildContextItem(data = {}) {
  const used = Number(data.used) || 0;
  const win = Number(data.win) || 200000;
  const pct = Number.isFinite(data.pct) ? data.pct : 0;
  const messages = Number(data.messages) || 0;
  const emoji = _ctxEmoji(used);
  const bar = _bar8(pct);
  const wl = _winLabel(win);
  const text = `${emoji} ${bar} ${pct}% ${Math.floor(used / 1000)}k/${wl} 💬 ${messages}`;
  const short = `${emoji} ${pct}%`;
  return {
    id: "context",
    text,
    short,
    role: gaugeRole(pct),
    priority: 100,
  };
}

/**
 * tmux @ctxbar string matching Python session-sync._ctx_segment:
 *   😬 #[fg=orange]████░░░░ 35% 351k/1M 💬 5#[default]
 * Color bands follow claude_sessions.ctx_bucket (not account slider bands).
 */
export function formatCtxbarForTmux(data = {}) {
  const used = Number(data.used) || 0;
  const win = Number(data.win) || 200000;
  const pct = Number.isFinite(data.pct) ? data.pct : 0;
  const messages = Number(data.messages) || 0;
  const emoji = _ctxEmoji(used);
  const bar = _bar8(pct);
  const wl = _winLabel(win);
  // ctx_bucket: ≤30 green, ≤50 orange, ≤80 red, else colour201
  let color = "green";
  if (pct > 80) color = "colour201";
  else if (pct > 50) color = "red";
  else if (pct > 30) color = "orange";
  return `${emoji} #[fg=${color}]${bar} ${pct}% ${Math.floor(used / 1000)}k/${wl} 💬 ${messages}#[default]`;
}

/**
 * Account usage slider item (Python _slider plain core).
 * which: 'account5h' | 'accountWeekly'
 * data: { used?, usedPercentage?, cap? }
 */
export function buildAccountSliderItem(which, data = {}) {
  const is5h = which === "account5h";
  const emoji = is5h ? "🕐" : "📅";
  const cap =
    Number(data.cap) ||
    (is5h ? data.fiveHourCap || 57000000 : data.weeklyCap || 270000000);
  let used = Number(data.used);
  let pct = Number(data.usedPercentage ?? data.projected_pct);
  if (!Number.isFinite(used) || used < 0) {
    if (Number.isFinite(pct) && cap > 0) used = Math.round((pct / 100) * cap);
    else used = 0;
  }
  if (!Number.isFinite(pct)) {
    pct = cap > 0 ? (used / cap) * 100 : 0;
  }
  const bar = _bar8(pct);
  const text = `${emoji} ${bar} ${_fmtTokens(used)}/${_fmtTokens(cap)}`;
  const short = `${emoji} ${_fmtTokens(used)}`;
  return {
    id: which,
    text,
    short,
    role: _accountRole(pct),
    priority: is5h ? 30 : 20,
  };
}

export function buildModelItem(badge = "") {
  if (!badge) return null;
  return { id: "model", text: String(badge), role: "accent", priority: 60 };
}

export function buildStateItem(glyph = "") {
  if (!glyph) return null;
  return { id: "state", text: String(glyph), role: "dim", priority: 90 };
}

/** Optional sage zone segment (default off). Soft-fail: null when absent. */
export function buildSageItem(zone = "") {
  if (!zone) return null;
  return {
    id: "sage",
    text: `zone ${zone}`,
    short: String(zone),
    role: "dim",
    priority: 25,
  };
}

// Concrete registry for surfaces. orderSegments merges bars.segments config.
// Each render(ctx) returns Item|null. ctx: { session, account, caps, ... }.
export const REGISTRY = {
  context: {
    enabled: true,
    priority: 100,
    order: 10,
    render(ctx) {
      const c = ctx?.session?.context;
      if (!c) return null;
      return buildContextItem(c);
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
  sage: {
    enabled: false,
    priority: 25,
    order: 45,
    render(ctx) {
      const z = ctx?.session?.sageZone || ctx?.sageZone;
      return z ? buildSageItem(z) : null;
    },
  },
  account5h: {
    enabled: true,
    priority: 30,
    order: 50,
    render(ctx) {
      const block = ctx?.account?.fiveHour;
      if (!block || block.usedPercentage == null) return null;
      return buildAccountSliderItem("account5h", {
        usedPercentage: block.usedPercentage,
        used: block.used,
        cap: ctx?.account?.caps?.fiveHourCap || ctx?.caps?.fiveHourCap,
      });
    },
  },
  accountWeekly: {
    enabled: true,
    priority: 20,
    order: 60,
    render(ctx) {
      const block = ctx?.account?.weekly;
      if (!block || block.usedPercentage == null) return null;
      return buildAccountSliderItem("accountWeekly", {
        usedPercentage: block.usedPercentage,
        used: block.used,
        cap: ctx?.account?.caps?.weeklyCap || ctx?.caps?.weeklyCap,
      });
    },
  },
  clock: {
    enabled: true,
    priority: 10,
    order: 70,
    render(ctx) {
      // Pure: surfaces must supply clockText (no Date in this module).
      if (ctx?.clockText == null || ctx.clockText === "") return null;
      return {
        id: "clock",
        text: String(ctx.clockText),
        role: "dim",
        priority: 10,
      };
    },
  },
  notify: {
    enabled: true,
    priority: 40,
    order: 40,
    render(ctx) {
      const icon = ctx?.notifyIcon;
      if (!icon) return null;
      return { id: "notify", text: String(icon), role: "dim", priority: 40 };
    },
  },
};

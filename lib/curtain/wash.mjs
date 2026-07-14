// Pure sliding-line bar animation. No I/O.
// Whole-bar solid bg wash was rejected: looks like the background "strobes".
// Instead: keep the bar transparent and slide a short bright segment horizontally.

import { STATES } from "./state.mjs";

// Track width in cells; bright "comet" length. Tuned for status-left.
export const TRACK = 14;
export const COMET = 3;

const FG = {
  [STATES.WORKING]: { dim: "colour240", hot: "colour214" }, // amber comet
  [STATES.DONE]: { dim: "colour238", hot: "colour70" }, // soft green
  [STATES.NEEDS]: { dim: "colour238", hot: "colour167" }, // rose
  [STATES.COMPACTING]: { dim: "colour238", hot: "colour67" }, // steel
};

const PERIOD = {
  [STATES.WORKING]: 5, // seconds for one sweep
  [STATES.DONE]: 3,
  [STATES.NEEDS]: 3,
  [STATES.COMPACTING]: 4,
  [STATES.IDLE]: 0,
};

/** Triangle-wave position 0..maxPos (inclusive), periodSec one-way. */
export const slidePos = (nowSec, periodSec, maxPos) => {
  if (maxPos <= 0 || periodSec <= 0) return 0;
  const cycle = periodSec * 2;
  const t = Math.max(0, Number(nowSec) || 0) % cycle;
  const u = t <= periodSec ? t / periodSec : (cycle - t) / periodSec;
  return Math.min(maxPos, Math.floor(u * (maxPos + 1e-9)));
};

/**
 * Build a transparent-bg sliding line as tmux status markup.
 * Example (working): dim trail + bright ━━━ comet, no full-bar bg fill.
 */
export const formatSlideLine = ({
  pos,
  dimFg,
  hotFg,
  track = TRACK,
  comet = COMET,
}) => {
  const maxPos = Math.max(0, track - comet);
  const p = Math.max(0, Math.min(maxPos, Number(pos) || 0));
  const left = "─".repeat(p);
  const mid = "━".repeat(comet);
  const right = "─".repeat(Math.max(0, track - p - comet));
  // bg=default keeps the bar glass; only the line glyphs are painted.
  return `#[fg=${dimFg},bg=default]${left}#[fg=${hotFg},bg=default]${mid}#[fg=${dimFg},bg=default]${right}#[default]`;
};

/**
 * @returns {{
 *   barBg: "default",
 *   line: string,           // tmux markup for status-left strip ("" when idle)
 *   mode: "static"|"loop"|"settle",
 *   settled: boolean,
 *   pos: number
 * }}
 */
export const sampleWash = ({
  state,
  sinceSec = 0,
  nowSec = 0,
  doneFlashSec = 3,
} = {}) => {
  const st = state || STATES.IDLE;
  const idle = {
    barBg: "default",
    line: "",
    mode: "static",
    settled: true,
    pos: 0,
  };
  if (st === STATES.IDLE || !FG[st]) return idle;

  const colors = FG[st];
  const period = PERIOD[st] ?? 5;
  const maxPos = TRACK - COMET;

  if (st === STATES.DONE) {
    const flash =
      Number.isFinite(doneFlashSec) && doneFlashSec >= 0 ? doneFlashSec : 3;
    const elapsed = Math.max(
      0,
      (Number(nowSec) || 0) - (Number(sinceSec) || 0),
    );
    if (elapsed >= flash) return idle;
    // One calm sweep then hold at end, then clear (settled above).
    const pos = Math.min(maxPos, Math.floor((elapsed / flash) * (maxPos + 1)));
    return {
      barBg: "default",
      line: formatSlideLine({
        pos,
        dimFg: colors.dim,
        hotFg: colors.hot,
      }),
      mode: "settle",
      settled: false,
      pos,
    };
  }

  const pos = slidePos(nowSec, period, maxPos);
  return {
    barBg: "default",
    line: formatSlideLine({
      pos,
      dimFg: colors.dim,
      hotFg: colors.hot,
    }),
    mode: "loop",
    settled: false,
    pos,
  };
};

/**
 * Status-style for wash mode: always transparent bg (never solid colour flood).
 * Preserves user fg/attrs from userBase when present.
 */
export const composeWashStyle = ({ userBase = "" } = {}) => {
  // Strip any prior solid wash colours we may have written historically.
  const base = String(userBase || "")
    .replace(/(?:,|^)bg=colour\d+/gi, "")
    .replace(/(?:,|^)bg=#[0-9a-fA-F]+/g, "")
    .replace(/^,|,$/g, "")
    .replace(/,,+/g, ",");
  // Always force transparent bar background in wash mode (no full-bar flood).
  if (!base) return "bg=default";
  if (/(?:^|,)bg=default(?:$|,)/.test(base)) return base;
  return `${base},bg=default`;
};

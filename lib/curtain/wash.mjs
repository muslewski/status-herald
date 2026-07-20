// Pure sliding-line bar animation. No I/O.
// Whole-bar solid bg wash was rejected: looks like the background "strobes".
// Instead: keep the bar transparent and slide a short bright segment horizontally.
// Act I: DONE gets one soft green flash (hotter comet, still transparent bg);
// NEEDS reuses this machinery for a slow crimson breathe (dim⇄hot), no strobe.

import { STATES } from "./state.mjs";
import { breatheAmp } from "./theatrics.mjs";

// Track width in cells; bright "comet" length. Tuned for status-left.
export const TRACK = 14;
export const COMET = 3;

// THE single hue + period source. Every surface (card, tmux tab, wash comet,
// Claude bar) resolves a state's colour/period from here. working=amber(Flow),
// done=green(Settle), needs=rose(Attention), compacting=steel(Pressure).
const STATE_HUE = {
  [STATES.WORKING]: { ansi: 214, tmux: "colour214", periodSec: 5 },
  [STATES.DONE]: { ansi: 70, tmux: "colour70", periodSec: 3 },
  [STATES.NEEDS]: { ansi: 167, tmux: "colour167", periodSec: 3 },
  [STATES.COMPACTING]: { ansi: 67, tmux: "colour67", periodSec: 4 },
  [STATES.IDLE]: { ansi: 244, tmux: "colour244", periodSec: 0 },
};

/** Resolve a state's canonical hue + period. Unknown → idle (no throw). */
export const stateHue = (state) => STATE_HUE[state] || STATE_HUE[STATES.IDLE];

const FG = {
  [STATES.WORKING]: { dim: "colour240", hot: STATE_HUE[STATES.WORKING].tmux }, // amber comet
  [STATES.DONE]: {
    dim: "colour238",
    hot: STATE_HUE[STATES.DONE].tmux, // soft green
    flash: "colour82", // one-beat brighter green (still soft, not pure 46)
  },
  [STATES.NEEDS]: {
    dim: "colour52", // deep crimson (dim phase)
    hot: STATE_HUE[STATES.NEEDS].tmux, // rose (bright phase) — not pure red
  },
  [STATES.COMPACTING]: {
    dim: "colour238",
    hot: STATE_HUE[STATES.COMPACTING].tmux,
  }, // steel
};

const PERIOD = {
  [STATES.WORKING]: STATE_HUE[STATES.WORKING].periodSec, // seconds for one sweep
  [STATES.DONE]: STATE_HUE[STATES.DONE].periodSec,
  [STATES.NEEDS]: STATE_HUE[STATES.NEEDS].periodSec, // slow breathe (a11y: ≪ 3 Hz)
  [STATES.COMPACTING]: STATE_HUE[STATES.COMPACTING].periodSec,
  [STATES.IDLE]: STATE_HUE[STATES.IDLE].periodSec,
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
 * NEEDS crimson breathe: full track of ─/━ whose hot fraction follows amp.
 * Soft luminance pulse — never a hard on/off strobe of solid bar bg.
 */
export const formatBreatheLine = ({
  amp,
  dimFg,
  hotFg,
  track = TRACK,
} = {}) => {
  const a = Math.min(1, Math.max(0, Number(amp) || 0));
  const hotCells = Math.max(1, Math.round(a * track));
  const dimCells = Math.max(0, track - hotCells);
  // Hot block centered for a calm "pulse" rather than a chase.
  const leftDim = Math.floor(dimCells / 2);
  const rightDim = dimCells - leftDim;
  const left = "─".repeat(leftDim);
  const mid = "━".repeat(hotCells);
  const right = "─".repeat(rightDim);
  return `#[fg=${dimFg},bg=default]${left}#[fg=${hotFg},bg=default]${mid}#[fg=${dimFg},bg=default]${right}#[default]`;
};

/**
 * @returns {{
 *   barBg: "default",
 *   line: string,           // tmux markup for status-left strip ("" when idle)
 *   mode: "static"|"loop"|"settle",
 *   settled: boolean,
 *   pos: number,
 *   amp?: number
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
    // ONE soft green flash: first ~1/3 of the settle window uses the brighter
    // flash colour on a full-track breathe peak, then a calm comet sweep.
    const flashWindow = flash / 3;
    if (elapsed < flashWindow) {
      const amp = 1 - elapsed / Math.max(flashWindow, 1e-6); // soft decay
      return {
        barBg: "default",
        line: formatBreatheLine({
          amp: 0.55 + 0.45 * amp,
          dimFg: colors.dim,
          hotFg: colors.flash || colors.hot,
        }),
        mode: "settle",
        settled: false,
        pos: 0,
        amp,
        flash: true,
      };
    }
    // Calm sweep for the remainder, then clear.
    const tail = flash - flashWindow;
    const u = Math.min(1, (elapsed - flashWindow) / Math.max(tail, 1e-6));
    const pos = Math.min(maxPos, Math.floor(u * (maxPos + 1)));
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
      flash: false,
    };
  }

  if (st === STATES.NEEDS) {
    // Slow crimson breathe (period ~3s) — dim⇄bright, no hard strobe.
    const amp = breatheAmp(nowSec, period);
    return {
      barBg: "default",
      line: formatBreatheLine({
        amp,
        dimFg: colors.dim,
        hotFg: colors.hot,
      }),
      mode: "loop",
      settled: false,
      pos: 0,
      amp,
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

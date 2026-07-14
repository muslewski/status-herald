// Pure whole-bar breathing wash. Phase from wall clock + state; no I/O.
// Applied as session status-style bg (tmux 1 Hz–ish via card loop / hooks).

import { STATES } from "./state.mjs";

// Soft mid-dark ramps (256-colour). Small luminance steps, WCAG-safer than strobe.
const PALETTES = {
  [STATES.WORKING]: [
    "colour233",
    "colour234",
    "colour235",
    "colour236",
    "colour94",
    "colour236",
    "colour235",
    "colour234",
  ],
  [STATES.DONE]: [
    "colour233",
    "colour235",
    "colour22",
    "colour28",
    "colour22",
    "colour235",
    "colour233",
    "colour232",
  ],
  [STATES.NEEDS]: [
    "colour52",
    "colour88",
    "colour52",
    "colour236",
    "colour52",
    "colour88",
    "colour52",
    "colour236",
  ],
  [STATES.COMPACTING]: [
    "colour233",
    "colour234",
    "colour60",
    "colour234",
    "colour233",
    "colour232",
    "colour233",
    "colour234",
  ],
};

const PERIOD = {
  [STATES.WORKING]: 8,
  [STATES.DONE]: 3,
  [STATES.NEEDS]: 3,
  [STATES.COMPACTING]: 5,
  [STATES.IDLE]: 0,
};

const stepIndex = (t, periodSec, n) => {
  if (!periodSec || n <= 0) return 0;
  const u = Math.max(0, Number(t) || 0) % periodSec;
  return Math.min(n - 1, Math.floor((u / periodSec) * n));
};

/**
 * @param {{ state: string, sinceSec?: number, nowSec: number, doneFlashSec?: number }} p
 * @returns {{ barBg: "default" | string, mode: "static"|"loop"|"settle", settled: boolean }}
 */
export const sampleWash = ({
  state,
  sinceSec = 0,
  nowSec = 0,
  doneFlashSec = 3,
} = {}) => {
  const st = state || STATES.IDLE;
  if (st === STATES.IDLE || !PALETTES[st]) {
    return { barBg: "default", mode: "static", settled: true };
  }
  const palette = PALETTES[st];
  const period = PERIOD[st] ?? 8;

  if (st === STATES.DONE) {
    const flash =
      Number.isFinite(doneFlashSec) && doneFlashSec >= 0 ? doneFlashSec : 3;
    const elapsed = Math.max(
      0,
      (Number(nowSec) || 0) - (Number(sinceSec) || 0),
    );
    if (elapsed >= flash) {
      return {
        barBg: "default",
        mode: "static",
        settled: true,
      };
    }
    const idx = stepIndex(elapsed, flash, palette.length);
    return {
      barBg: palette[idx],
      mode: "settle",
      settled: false,
    };
  }

  const idx = stepIndex(nowSec, period, palette.length);
  return {
    barBg: palette[idx],
    mode: "loop",
    settled: false,
  };
};

/**
 * Compose a status-style string.
 * coverTransparent wins only when wash is off or barBg is default.
 */
export const composeWashStyle = ({
  userBase = "",
  barBg = "default",
  coverTransparent = false,
} = {}) => {
  if (coverTransparent && (barBg === "default" || !barBg)) {
    return userBase ? `${userBase},bg=default` : "bg=default";
  }
  if (barBg && barBg !== "default") {
    return userBase ? `${userBase},bg=${barBg}` : `bg=${barBg}`;
  }
  return userBase || "";
};

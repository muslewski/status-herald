// Pure curtain theatrics (Act I). No I/O, no Date.now — callers inject t.
// Frame generators: (cols, rows, t) → lines. Timing rides the existing card
// tick loop (scripts/curtain-card-session.sh); this module only paints.

const DENSITY = ["░", "▒", "▓", "█"];
const SPARK_GLYPHS = ["*", ".", "+", "·"];

/** Motion off when explicitly disabled or reduced-motion a11y is set. */
export const motionDisabled = (anim = {}) =>
  anim.enabled === false || anim.reducedMotion === true;

/**
 * Which theatrics fire for this paint. classic is the static regression
 * baseline (always none). Motion knobs gate everything else.
 *
 * @returns {{
 *   stageDraw: boolean,
 *   sparkRain: boolean,
 *   barFlash: boolean,
 *   breathe: boolean
 * }}
 */
export const selectEffects = ({
  state,
  themeName = "classic",
  animCfg = {},
} = {}) => {
  const none = {
    stageDraw: false,
    sparkRain: false,
    barFlash: false,
    breathe: false,
  };
  if (motionDisabled(animCfg)) return none;
  if (!themeName || themeName === "classic") return none;
  const st = state || "idle";
  if (st === "idle") return none;
  return {
    stageDraw: true,
    sparkRain: st === "done",
    barFlash: st === "done",
    breathe: st === "needs",
  };
};

/** Per-frame sleep (ms) so drawFrames complete within drawMs (~600ms). */
export const drawFrameMs = (anim = {}) => {
  const frames = Number(anim.drawFrames);
  const ms = Number(anim.drawMs);
  // Non-positive / invalid frame count → static 1s pace (no draw burst).
  if (Number.isFinite(frames) && frames <= 0) return 1000;
  const n = Number.isFinite(frames) && frames > 0 ? frames : 8;
  const budget = Number.isFinite(ms) && ms > 0 ? ms : 600;
  return Math.max(1, Math.round(budget / n));
};

/**
 * Fraction of cells that carry curtain fabric (░▒▓█). Used by tests and
 * draw progress checks. Strips SGR if present.
 */
export const coverageRatio = (lines) => {
  if (!lines?.length) return 0;
  let solid = 0;
  let total = 0;
  for (const raw of lines) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip SGR for geometry
    const s = String(raw).replace(/\x1b\[[0-9;]*m/g, "");
    for (const ch of s) {
      total++;
      if (ch === "░" || ch === "▒" || ch === "▓" || ch === "█") solid++;
    }
  }
  return total ? solid / total : 0;
};

/**
 * Stage-curtain panels closing from both edges (shut) or parting (open).
 * t ∈ [0,1]. shut: 0 = open (empty), 1 = closed. open: 0 = closed, 1 = open.
 * Density ramps ░→▒→▓→█ toward the outer edges. Pure, deterministic.
 *
 * @returns {string[]} exactly `rows` lines, each `cols` cells (plain glyphs)
 */
export const stageCurtain = (cols, rows, t, direction = "shut") => {
  const c = Math.max(0, Math.floor(Number(cols) || 0));
  const r = Math.max(0, Math.floor(Number(rows) || 0));
  let u = Number(t);
  if (!Number.isFinite(u)) u = 0;
  u = Math.min(1, Math.max(0, u));
  // open is shut played in reverse
  if (direction === "open") u = 1 - u;

  // How many columns each panel covers (from its outer edge toward center).
  const half = c / 2;
  const reach = half * u; // continuous; cells use floor

  const out = [];
  for (let row = 0; row < r; row++) {
    let line = "";
    for (let col = 0; col < c; col++) {
      const fromLeft = col + 0.5;
      const fromRight = c - col - 0.5;
      let depth = 0; // 0 = open cell, >0 = inside a panel (toward outer edge)
      if (fromLeft <= reach) depth = reach - fromLeft + 1;
      else if (fromRight <= reach) depth = reach - fromRight + 1;

      if (depth <= 0) {
        line += " ";
        continue;
      }
      // Density: deeper into the panel (outer edge) = denser. Leading edge = light.
      // Normalize depth against reach so the ramp tracks the moving panel.
      const norm = reach > 0 ? Math.min(1, depth / Math.max(reach, 1)) : 1;
      const idx = Math.min(
        DENSITY.length - 1,
        Math.floor(norm * DENSITY.length),
      );
      line += DENSITY[idx];
    }
    out.push(line);
  }
  return out;
};

/**
 * Soft golden/green spark rain over 3–5 visual frames (t ∈ [0,1]).
 * Sparse deterministic PRNG from (col,row,frame) — no Math.random.
 *
 * @returns {string[]} exactly `rows` lines of width `cols` (plain; spaces + sparks)
 */
export const sparkRain = (cols, rows, t, { palette: _palette } = {}) => {
  const c = Math.max(0, Math.floor(Number(cols) || 0));
  const r = Math.max(0, Math.floor(Number(rows) || 0));
  let u = Number(t);
  if (!Number.isFinite(u)) u = 0;
  u = Math.min(1, Math.max(0, u));
  // Quantize into 5 rain phases so unit tests see discrete frames.
  const phase = Math.min(4, Math.floor(u * 5));
  const fall = Math.floor(u * r); // vertical drift of the rain field

  const out = [];
  for (let row = 0; row < r; row++) {
    let line = "";
    for (let col = 0; col < c; col++) {
      // Deterministic hash; density ~1/11 of cells at peak mid-rain.
      const h =
        ((col * 73856093) ^ ((row + fall) * 19349663) ^ (phase * 83492791)) >>>
        0;
      const hit = h % 11 === 0 && phase < 4; // last frame clears
      if (!hit) {
        line += " ";
        continue;
      }
      line += SPARK_GLYPHS[h % SPARK_GLYPHS.length];
    }
    out.push(line);
  }
  return out;
};

/**
 * Soft luminance amplitude for NEEDS crimson breathe.
 * Cosine in [0,1], periodSec cycle. Adjacent samples change gently (no strobe).
 */
export const breatheAmp = (nowSec, periodSec = 3) => {
  const p = Number(periodSec);
  const period = Number.isFinite(p) && p > 0 ? p : 3;
  const t = Math.max(0, Number(nowSec) || 0);
  // 0.5 + 0.5*cos → [0,1]; slow period keeps visual ≤ ~0.33 Hz for period=3.
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * t) / period);
};

/**
 * Composite: paint curtain fabric over base lines where fabric is non-space.
 * Base art under open gaps stays visible. Lengths coerced to base geometry.
 */
export const overlayCurtain = (baseLines, fabricLines) => {
  const rows = baseLines?.length || 0;
  const out = [];
  for (let i = 0; i < rows; i++) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip for cell walk
    const base = String(baseLines[i] ?? "");
    const fabric = String(fabricLines?.[i] ?? "");
    // Prefer plain fabric cells; keep base (may include SGR) when fabric is space.
    // Simple path: if fabric row is all spaces, keep base; if fabric has ink,
    // build plain overlay (theatrics layer is uncolored density; caller may color).
    let hasInk = false;
    for (const ch of fabric) {
      if (ch !== " ") {
        hasInk = true;
        break;
      }
    }
    if (!hasInk) {
      out.push(base);
      continue;
    }
    // Cell-wise: fabric non-space wins. Base may have SGR — for overlay during
    // draw we replace the whole line with fabric when any ink (stage draw is
    // the visual focus). Spark rain uses mergeSparks instead.
    out.push(fabric);
  }
  return out;
};

/**
 * Merge sparse sparks into base lines without clobbering non-space base ink.
 * Preserves glyph ART (sacred): only paints into whitespace cells.
 */
export const mergeSparks = (baseLines, sparkLines) => {
  const rows = baseLines?.length || 0;
  const out = [];
  for (let i = 0; i < rows; i++) {
    const base = String(baseLines[i] ?? "");
    const sparks = String(sparkLines?.[i] ?? "");
    // If base has SGR, only overlay when base is empty/blank after strip —
    // otherwise walk plain and rebuild without trying to splice into SGR.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip SGR
    const basePlain = base.replace(/\x1b\[[0-9;]*m/g, "");
    if (base !== basePlain) {
      // Colored base: only add sparks if the plain line is nearly empty.
      if (basePlain.trim() === "") {
        out.push(sparks.length >= basePlain.length ? sparks : base);
      } else {
        out.push(base);
      }
      continue;
    }
    const n = Math.max(base.length, sparks.length);
    let line = "";
    for (let c = 0; c < n; c++) {
      const b = base[c] ?? " ";
      const s = sparks[c] ?? " ";
      line += b !== " " ? b : s;
    }
    out.push(line);
  }
  return out;
};

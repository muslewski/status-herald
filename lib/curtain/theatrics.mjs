// Pure curtain theatrics (Act I). No I/O, no Date.now — callers inject t.
// Frame generators: (cols, rows, t) → lines. Timing rides the existing card
// tick loop (scripts/curtain-card-session.sh); this module only paints.

const DENSITY = ["░", "▒", "▓", "█"];
const SPARK_GLYPHS = ["*", ".", "+", "·"];

// Age ramp: light → faint → gone. A mote fades OUT across its lifetime, then
// respawns (age wraps). Last entry is a space so "gone" paints nothing.
const DRIFT_GLYPHS_DEFAULT = ["·", "˙", "ʼ", " "];
export const DRIFT_GLYPHS = DRIFT_GLYPHS_DEFAULT;

/** Motion off when explicitly disabled or reduced-motion a11y is set. */
export const motionDisabled = (anim = {}) =>
  anim.enabled === false || anim.reducedMotion === true;

/**
 * Which theatrics fire for this paint. classic is the static regression
 * baseline (always none). Motion knobs gate everything else.
 *
 * @returns {{
 *   stageDraw: boolean,
 *   burst: boolean,
 *   motes: boolean,
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
    burst: false,
    motes: false,
    barFlash: false,
    breathe: false,
  };
  if (motionDisabled(animCfg)) return none;
  if (!themeName || themeName === "classic") return none;
  const st = state || "idle";
  if (st === "idle") return none;
  return {
    stageDraw: true,
    burst: st === "done",
    motes: st === "working",
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

// 32-bit hash of LATTICE coordinates ONLY. This is the flicker fix: a mote's
// identity is fixed by (col,row,seed) and never varies with the frame/phase.
const coordHash = (col, row, seed) => {
  let h =
    (Math.imul(col | 0, 73856093) ^
      Math.imul(row | 0, 19349663) ^
      Math.imul(seed | 0, 83492791)) >>>
    0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 2654435761) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

// Stable fraction in [0,1) from a 32-bit hash.
const hash01 = (h) => (h >>> 8) / 0x01000000;

/**
 * Coherent particle field. A mote at a lattice point is the SAME mote across
 * frames (identity = coordHash(col,row,seed), no phase term). Its drawn cell =
 * base + drift(t); its brightness rides an age ramp so it fades in/out. Pure,
 * no buffer, no RNG state, no Date.now.
 *
 * @returns {string[]} exactly `rows` strings, each `cols` wide; space = no mote.
 */
export const driftField = (
  cols,
  rows,
  t,
  { seed = 0, dir = "lateral", density = 0.09, glyphs, fade = true } = {},
) => {
  const c = Math.max(0, Math.floor(Number(cols) || 0));
  const r = Math.max(0, Math.floor(Number(rows) || 0));
  const time = Number.isFinite(Number(t)) ? Number(t) : 0;
  const ramp =
    Array.isArray(glyphs) && glyphs.length ? glyphs : DRIFT_GLYPHS_DEFAULT;
  const dens = Number.isFinite(Number(density)) ? Number(density) : 0.09;
  const grid = Array.from({ length: r }, () => new Array(c).fill(" "));
  if (c === 0 || r === 0) return grid.map((g) => g.join(""));

  const DRIFT = 0.35; // baseline cells/second a mote slides along `dir`
  for (let by = 0; by < r; by++) {
    for (let bx = 0; bx < c; bx++) {
      const h = coordHash(bx, by, seed);
      // density fraction of lattice points ARE motes — decided by coords only.
      if (hash01(h) >= dens) continue;
      // Per-mote params come from a SECOND, decorrelated hash. Selection keeps
      // only low-h cells, so h itself is clustered near 0 for motes; deriving
      // speed/life/phase from h would make every mote twinkle in lockstep.
      // Swapping (row,col) + mixing the seed gives an independent value.
      const h2 = coordHash(by, bx, (seed | 0) ^ 0x5bd1e995);
      // Continuous sub-cell POSITION: base + drift(t). Per-mote speed variance.
      const speed = 0.5 + hash01(h2);
      const travel = DRIFT * speed * time;
      let dx = bx;
      let dy = by;
      if (dir === "lateral") dx = bx + travel;
      else if (dir === "up") dy = by - travel;
      else if (dir === "down") dy = by + travel;
      const cx = ((Math.round(dx) % c) + c) % c;
      const cy = ((Math.round(dy) % r) + r) % r;
      // LIFE: age in [0,1) from a per-mote phase + t. glyph rides the ramp so
      // the mote fades OUT then respawns. No binary hit, no hard clear.
      const lifePeriod = 3 + 4 * hash01(h2 ^ 0x51ed270b); // 3..7 s
      const phase0 = hash01(h2 ^ 0x27d4eb2f);
      const age = fade ? (phase0 + time / lifePeriod) % 1 : 0;
      const gi = Math.min(ramp.length - 1, Math.floor(age * ramp.length));
      const glyph = ramp[gi];
      if (glyph && glyph !== " ") grid[cy][cx] = glyph;
    }
  }
  return grid.map((g) => g.join(""));
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip SGR for cell geometry
const stripSgr = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");

/**
 * Cell-wise: fabric non-space wins; open gaps keep base. Works on plain lines
 * (callers strip SGR before merge, recolor after). Preserves center-stage card
 * under parting panels.
 */
export const overlayCurtain = (baseLines, fabricLines) => {
  const rows = baseLines?.length || 0;
  const out = [];
  for (let i = 0; i < rows; i++) {
    const base = stripSgr(baseLines[i] ?? "");
    const fabric = stripSgr(fabricLines?.[i] ?? "");
    const n = Math.max(base.length, fabric.length);
    let line = "";
    for (let c = 0; c < n; c++) {
      const f = fabric[c] ?? " ";
      const b = base[c] ?? " ";
      line += f !== " " ? f : b;
    }
    out.push(line);
  }
  return out;
};

/**
 * Merge sparse sparks into base lines without clobbering non-space base ink.
 * Preserves glyph ART (sacred): only paints into whitespace cells.
 * Input/output plain (no SGR).
 */
export const mergeSparks = (baseLines, sparkLines) => {
  const rows = baseLines?.length || 0;
  const out = [];
  for (let i = 0; i < rows; i++) {
    const base = stripSgr(baseLines[i] ?? "");
    const sparks = stripSgr(sparkLines?.[i] ?? "");
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

/**
 * Apply Act I theatrics onto already-rendered plain card lines.
 * Does not mutate theme art data — only composites over the painted grid.
 *
 * @param {string[]} plainLines - rows plain text (no SGR), length = rows
 * @param {{
 *   cols: number,
 *   rows: number,
 *   effects: ReturnType<selectEffects>,
 *   draw?: "shut"|"open"|null,
 *   drawProgress?: number,  // 0..1
 *   tick?: number,
 *   sparkFrames?: number,
 * }} opts
 * @returns {string[]} plain lines
 */
export const applyTheatrics = (plainLines, opts = {}) => {
  const {
    cols,
    rows,
    effects = {},
    draw = null,
    drawProgress = 0,
    tick = 0,
    sparkFrames = 5,
  } = opts;
  let lines = plainLines.map((l) => stripSgr(l));

  const seed = Number(opts.seed) || 0;

  // Ambient WORKING motes: coherent lateral drift, whitespace-only.
  if (effects.motes) {
    const mt = opts.motesT != null ? Number(opts.motesT) : tick * 0.5;
    const motes = driftField(cols, rows, mt, {
      seed,
      dir: "lateral",
      density: 0.06,
      glyphs: DRIFT_GLYPHS,
      fade: true,
    });
    lines = mergeSparks(lines, motes);
  }

  // DONE burst: rising, denser, with a decay tail (replaces the old hard clear).
  if (effects.burst && tick < sparkFrames) {
    const life = sparkFrames <= 1 ? 0 : tick / (sparkFrames - 1); // 0..1
    const density = Math.max(0, 0.18 * (1 - life)); // fades to ~0, never clears hard
    const burst = driftField(cols, rows, tick, {
      seed,
      dir: "up",
      density,
      glyphs: SPARK_GLYPHS,
      fade: true,
    });
    lines = mergeSparks(lines, burst);
  }

  if (effects.stageDraw && (draw === "shut" || draw === "open")) {
    const fabric = stageCurtain(cols, rows, drawProgress, draw);
    lines = overlayCurtain(lines, fabric);
  }

  // Ensure exact geometry
  return lines.map((l) => {
    if (l.length === cols) return l;
    if (l.length > cols) return [...l].slice(0, cols).join("");
    return l + " ".repeat(cols - l.length);
  });
};

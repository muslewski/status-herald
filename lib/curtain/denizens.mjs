// Pure denizen logic (Act II). No I/O, no Date.now/Math.random. Art lives in
// denizens-data.mjs (authored content), separated from selection logic.
//
// RECONCILE R1 governs tier geometry + tierFor thresholds.
import { DENIZENS } from "./denizens-data.mjs";

/** 32-bit FNV-1a over a string → uint32. Deterministic, stable across runs. */
export const hashStr = (s) => {
  let h = 2166136261 >>> 0; // FNV offset basis
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0; // FNV prime, kept in uint32
  }
  return h >>> 0;
};

/** All species that ship art, in a stable order. */
export const ROSTER = Object.keys(DENIZENS);

/** Denizen config block, tolerant of absent P3 config (defaults on/auto). */
const denCfg = (cfg = {}) => cfg?.animation?.denizens || cfg?.denizens || {};

/** Species names that are both authored and enabled. */
const enabledRoster = () => ROSTER.filter((name) => DENIZENS[name]);

/**
 * Deterministic species for a session. Same name → same animal (mirrors the
 * (sessionName, cfg) shape of themeNameFor, but hash-based so a fleet spreads
 * across the roster). Explicit species override wins.
 */
export const speciesFor = (sessionName, cfg = {}) => {
  const roster = enabledRoster();
  if (!roster.length) return "";
  const pick = denCfg(cfg).species;
  if (pick && pick !== "auto" && roster.includes(pick)) return pick;
  return roster[hashStr(sessionName) % roster.length];
};

/** Stable per-tab seed (uint32). Phase-offsets co-launched tabs. */
export const seedFor = (sessionName) => hashStr(sessionName);

/** Next species in roster after `current` (wraps). Empty current → first. */
export const nextSpecies = (current) => {
  const roster = enabledRoster();
  if (!roster.length) return "";
  const i = roster.indexOf(String(current || ""));
  if (i < 0) return roster[0];
  return roster[(i + 1) % roster.length];
};

/**
 * Ink bounding box of a cel (non-space glyphs). Used to center asymmetric art
 * (e.g. cat with trailing padding) so the silhouette — not the pad box — sits
 * on the card's horizontal midline.
 *
 * @returns {{ minC: number, maxC: number, minR: number, maxR: number, inkW: number, inkH: number } | null}
 */
export const inkBounds = (cel) => {
  if (!Array.isArray(cel) || !cel.length) return null;
  let minC = Infinity;
  let maxC = -1;
  let minR = Infinity;
  let maxR = -1;
  for (let r = 0; r < cel.length; r++) {
    const line = String(cel[r] ?? "");
    for (let c = 0; c < line.length; c++) {
      if (line[c] === " ") continue;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
  if (maxC < 0) return null;
  return {
    minC,
    maxC,
    minR,
    maxR,
    inkW: maxC - minC + 1,
    inkH: maxR - minR + 1,
  };
};

/**
 * Place a denizen cel on a cols×rows card so its *ink* is centered.
 * - Horizontal: center of non-space silhouette (not padded frame width).
 * - Vertical: center within the upper stage band (above ~mid card), so the
 *   creature floats over empty stage, not over WORKING/label ink.
 *
 * @returns {{ top: number, left: number, cel: string[] }}
 */
export const placeDenizen = (cel, cols, rows) => {
  const c = Math.max(0, Math.floor(Number(cols) || 0));
  const r = Math.max(0, Math.floor(Number(rows) || 0));
  const src = Array.isArray(cel) ? cel.map((l) => String(l ?? "")) : [];
  if (!src.length || c === 0 || r === 0) {
    return { top: 0, left: 0, cel: src };
  }
  const bounds = inkBounds(src);
  if (!bounds) {
    const w = Math.max(0, ...src.map((l) => l.length));
    return {
      top: Math.max(0, Math.floor((Math.floor(r * 0.4) - src.length) / 2)),
      left: Math.max(0, Math.floor((c - w) / 2)),
      cel: src,
    };
  }
  // Crop to ink bbox so paint origin is the silhouette, not pad.
  const cropped = [];
  for (let row = bounds.minR; row <= bounds.maxR; row++) {
    const line = src[row] ?? "";
    cropped.push(line.slice(bounds.minC, bounds.maxC + 1));
  }
  const left = Math.max(0, Math.floor((c - bounds.inkW) / 2));
  // Upper stage: leave a little air under the top edge; keep creature above
  // the vertically-centered theme block (~rows/2).
  const stageH = Math.max(bounds.inkH, Math.floor(r * 0.45));
  const top = Math.max(0, Math.floor((stageH - bounds.inkH) / 2));
  return { top, left, cel: cropped };
};

/**
 * Responsive tier from the card's inner rows × cols.
 * RECONCILE R1: none if r<5||c<11; compact if r<12||c<26; else full.
 */
export const tierFor = (rows, cols) => {
  const r = Math.max(0, Math.floor(Number(rows) || 0));
  const c = Math.max(0, Math.floor(Number(cols) || 0));
  if (r < 5 || c < 11) return "none";
  if (r < 12 || c < 26) return "compact";
  return "full";
};

/**
 * The raw art cel for this frame. Pure: frame index folds the injected seed
 * so co-launched tabs animate out of phase. Fail-open: [] for anything absent.
 */
export const denizenCel = ({
  species,
  state,
  tier,
  tick = 0,
  seed = 0,
} = {}) => {
  if (tier === "none" || !species) return [];
  const rec = DENIZENS[species];
  if (!rec) return [];
  const pose = rec.poses?.[state] || rec.poses?.idle;
  const frames = pose?.[tier];
  if (!Array.isArray(frames) || !frames.length) return [];
  const n = frames.length;
  const off = (((Number(seed) || 0) % n) + n) % n;
  const idx = (((Number(tick) || 0) % n) + off) % n;
  return frames[idx].slice(); // copy the rows array (callers may mutate)
};

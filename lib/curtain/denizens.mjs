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

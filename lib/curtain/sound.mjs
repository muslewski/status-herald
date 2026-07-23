// Curtain attention sound — default-off, pluggable backends, NEEDS-edge only.
// Spec: status-herald-mind/specs/2026-07-23-curtain-sound-design.md
//
// Herald owns *when* (edge into needs). Backends own *how* (local/ssh/ntfy).
// Fail-open: never throw into the hook path; never block hooks.

import { spawn as realSpawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { getConfigPath, merge } from "../config.mjs";
import { STATES } from "./state.mjs";

export const SOUND_MODES = new Set(["day", "night", "off"]);

const DEFAULT_SOUND = {
  enabled: false,
  mode: "day",
  events: ["needs"],
  onlyWhenCovered: false,
  dedupeSec: 8,
  backends: [],
};

/**
 * @param {unknown} raw
 * @returns {{
 *   enabled: boolean,
 *   mode: string,
 *   events: string[],
 *   onlyWhenCovered: boolean,
 *   dedupeSec: number,
 *   backends: object[],
 * }}
 */
export const normalizeSoundCfg = (raw) => {
  const r = raw && typeof raw === "object" ? raw : {};
  const mode = String(r.mode || DEFAULT_SOUND.mode).toLowerCase();
  const events = Array.isArray(r.events)
    ? r.events.map((e) => String(e).toLowerCase())
    : [...DEFAULT_SOUND.events];
  const backends = Array.isArray(r.backends) ? r.backends.filter(Boolean) : [];
  const dedupeSec = Number(r.dedupeSec);
  return {
    enabled: r.enabled === true,
    mode: SOUND_MODES.has(mode) ? mode : "day",
    events: events.length ? events : ["needs"],
    onlyWhenCovered: r.onlyWhenCovered === true,
    dedupeSec:
      Number.isFinite(dedupeSec) && dedupeSec >= 0
        ? dedupeSec
        : DEFAULT_SOUND.dedupeSec,
    backends,
  };
};

/**
 * Which attention event (if any) does this state edge represent?
 * - needs: blocked on approval / permission (closed-eyes "accept")
 * - done: turn finished, waiting on a human prompt (common for Grok always-approve)
 * @param {string} prev
 * @param {string} next
 * @returns {"needs"|"done"|null}
 */
export const soundEdgeKind = (prev, next) => {
  const p = String(prev || "");
  const n = String(next || "");
  if (n === STATES.NEEDS && p !== STATES.NEEDS) return "needs";
  // Your-turn: leave active work into done (not needs→done churn, not idle→done).
  if (
    n === STATES.DONE &&
    p !== STATES.DONE &&
    (p === STATES.WORKING ||
      p === STATES.COMPACTING ||
      p === STATES.NEEDS)
  ) {
    return "done";
  }
  return null;
};

/**
 * @param {ReturnType<typeof normalizeSoundCfg>} cfg
 * @param {{
 *   prevState?: string,
 *   nextState?: string,
 *   covered?: boolean,
 *   nowSec?: number,
 *   lastFireSec?: number,
 * }} ctx
 * @returns {boolean}
 */
export const shouldFireSound = (cfg, ctx = {}) => {
  const c = normalizeSoundCfg(cfg);
  if (!c.enabled) return false;
  if (c.mode === "off") return false;
  if (!c.backends.length) return false;

  const kind = soundEdgeKind(ctx.prevState, ctx.nextState);
  if (!kind || !c.events.includes(kind)) return false;

  if (c.onlyWhenCovered && !ctx.covered) return false;

  const now = Number(ctx.nowSec) || 0;
  const last = Number(ctx.lastFireSec) || 0;
  if (c.dedupeSec > 0 && last > 0 && now > 0 && now - last < c.dedupeSec) {
    return false;
  }
  return true;
};

/**
 * Build local shell command lines for the given mode.
 * Each string is suitable for `sh -c <cmd>`.
 * @param {object[]} backends
 * @param {string} mode day|night
 * @returns {string[]}
 */
export const commandsForBackends = (backends, mode) => {
  const m = mode === "night" ? "night" : "day";
  const out = [];
  for (const b of backends || []) {
    if (!b || typeof b !== "object") continue;
    const type = String(b.type || "command").toLowerCase();
    if (type === "ntfy") {
      const topic = String(b.topic || "").trim();
      if (!topic) continue;
      // ntfy is typically a day-mode push; allow night too if configured.
      if (m === "night" && b.night === false) continue;
      if (m === "day" && b.day === false) continue;
      const url = /^https?:\/\//i.test(topic)
        ? topic
        : `https://ntfy.sh/${encodeURIComponent(topic)}`;
      const title = String(b.title || "Herald — needs you").replace(
        /"/g,
        '\\"',
      );
      const body = String(
        b.body || "Agent waiting on approval / decision.",
      ).replace(/"/g, '\\"');
      const tags = String(b.tags || "bell").replace(/"/g, '\\"');
      out.push(
        `curl -sS -m 6 -H "Title: ${title}" -H "Tags: ${tags}" -d "${body}" "${url}"`,
      );
      continue;
    }
    const script = String(b[m] || "").trim();
    if (!script) continue;
    if (type === "ssh") {
      const host = String(b.host || "").trim();
      if (!host) continue;
      const timeout = Number(b.connectTimeout);
      const ct =
        Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 3;
      // Remote command via ssh; BatchMode so we never hang on password prompts.
      out.push(
        `ssh -o BatchMode=yes -o ConnectTimeout=${ct} ${shellQuote(host)} -- ${shellQuote(script)}`,
      );
      continue;
    }
    // command | local
    if (type === "command" || type === "local" || !b.type) {
      out.push(script);
    }
  }
  return out;
};

/** Minimal single-arg shell quoting for POSIX sh. */
export const shellQuote = (s) => {
  const str = String(s);
  if (str === "") return "''";
  if (/^[a-zA-Z0-9_./:=@%+-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, `'\\''`)}'`;
};

/**
 * Fire-and-forget sound backends. Never throws.
 * @param {object} cfg sound config
 * @param {{
 *   prevState?: string,
 *   nextState?: string,
 *   covered?: boolean,
 *   nowSec?: number,
 *   lastFireSec?: number,
 *   force?: boolean,
 * }} ctx
 * @param {{
 *   spawn?: typeof realSpawn,
 *   onFired?: (nowSec: number) => void,
 * }} [deps]
 * @returns {{ fired: boolean, commands: string[] }}
 */
export const fireSound = (cfg, ctx = {}, deps = {}) => {
  try {
    const c = normalizeSoundCfg(cfg);
    const force = ctx.force === true;
    // force (CLI test): skip edge/enabled; still silent if mode off or no backends
    if (force) {
      if (c.mode === "off" || !c.backends.length) {
        return { fired: false, commands: [] };
      }
    } else if (!shouldFireSound(c, ctx)) {
      return { fired: false, commands: [] };
    }
    const mode = c.mode === "night" ? "night" : "day";
    const commands = commandsForBackends(c.backends, mode);
    if (!commands.length) return { fired: false, commands: [] };

    const spawn = deps.spawn || realSpawn;
    for (const cmd of commands) {
      try {
        const child = spawn("sh", ["-c", cmd], {
          detached: true,
          stdio: "ignore",
        });
        if (child && typeof child.unref === "function") child.unref();
      } catch {
        /* per-command fail-open */
      }
    }
    const now = Number(ctx.nowSec) || Math.floor(Date.now() / 1000);
    if (typeof deps.onFired === "function") {
      try {
        deps.onFired(now);
      } catch {
        /* ignore */
      }
    }
    return { fired: true, commands };
  } catch {
    return { fired: false, commands: [] };
  }
};

/**
 * Hook-path helper: evaluate + fire + record last-fire on session opts.
 * @param {{
 *   soundCfg: object,
 *   prevState: string,
 *   nextState: string,
 *   covered: boolean,
 *   nowSec: number,
 *   lastFireSec: number,
 *   setLastFire?: (sec: number) => void,
 *   spawn?: typeof realSpawn,
 * }} args
 */
export const notifyOnNeedsEdge = (args) => {
  try {
    const result = fireSound(
      args.soundCfg,
      {
        prevState: args.prevState,
        nextState: args.nextState,
        covered: args.covered,
        nowSec: args.nowSec,
        lastFireSec: args.lastFireSec,
      },
      {
        spawn: args.spawn,
        onFired: (sec) => {
          if (typeof args.setLastFire === "function") args.setLastFire(sec);
        },
      },
    );
    return result;
  } catch {
    return { fired: false, commands: [] };
  }
};

/**
 * @param {object} cfg full or sound-only
 */
export const readSoundStatus = (cfg) => {
  const sound = normalizeSoundCfg(cfg?.sound ?? cfg);
  return {
    enabled: sound.enabled,
    mode: sound.mode,
    backendCount: sound.backends.length,
    onlyWhenCovered: sound.onlyWhenCovered,
    events: sound.events,
    silent:
      !sound.enabled ||
      sound.mode === "off" ||
      sound.backends.length === 0,
  };
};

/**
 * Deep-merge a patch into curtain.sound in the user config file.
 * Creates parent dirs and file if missing. Never clobbers unrelated keys.
 * @param {object} patch e.g. { mode: "off" } or { enabled: true }
 * @param {string} [path]
 * @returns {{ ok: boolean, path: string, reason?: string }}
 */
export const patchSoundConfig = (patch, path = getConfigPath()) => {
  try {
    let existing = {};
    if (existsSync(path)) {
      try {
        existing = JSON.parse(readFileSync(path, "utf8"));
        if (!existing || typeof existing !== "object") existing = {};
      } catch {
        existing = {};
      }
    }
    const next = merge(existing, {
      curtain: {
        sound: patch && typeof patch === "object" ? patch : {},
      },
    });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return { ok: true, path };
  } catch (e) {
    return {
      ok: false,
      path,
      reason: e?.message || String(e),
    };
  }
};

/**
 * One-line doctor detail for sound.
 * @param {object} soundCfg
 * @returns {{ ok: boolean, detail: string, fixHint: string }}
 */
export const soundDoctorLine = (soundCfg) => {
  const s = normalizeSoundCfg(soundCfg);
  if (!s.enabled) {
    return {
      ok: true,
      detail: "sound off (default silent)",
      fixHint: "",
    };
  }
  if (s.mode === "off") {
    return {
      ok: true,
      detail: "sound enabled but mode=off (silent)",
      fixHint: "",
    };
  }
  if (!s.backends.length) {
    return {
      ok: false,
      detail: "sound enabled with no backends",
      fixHint:
        "add curtain.sound.backends in config, or: herald curtain sound disable",
    };
  }
  const parts = s.backends.map((b) => {
    const t = String(b?.type || "command");
    if (t === "ssh") return `ssh:${b.host || "?"}`;
    if (t === "ntfy") return "ntfy";
    return t;
  });
  return {
    ok: true,
    detail: `sound ${s.mode} via ${parts.join(", ")}`,
    fixHint: "",
  };
};

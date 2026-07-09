import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULTS = {
  curtain: {
    enabled: true,
    coverableStates: ["working", "done", "needs"],
    focus: {
      source: "ssh-osascript",
      pollMs: 350,
      ssh: { host: "mac-music", connectTimeout: 4 },
      terminalApp: "ghostty",
      titleStripPrefixes: ["[mosh] "],
    },
    autoArm: { enabled: true, sessionGlob: "*" },
  },
};

const configPath = () =>
  process.env.HERALD_CONFIG ||
  join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "status-herald",
    "config.json",
  );

// Deep-merge plain objects; arrays and scalars in `over` replace the base.
const merge = (base, over) => {
  if (over === undefined) return base;
  if (Array.isArray(base) || base === null || typeof base !== "object")
    return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
};

export const loadConfig = (path = configPath()) => {
  try {
    if (!existsSync(path)) return DEFAULTS;
    return merge(DEFAULTS, JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    process.stderr.write(
      `herald: bad config at ${path}, using defaults (${e?.message ?? e})\n`,
    );
    return DEFAULTS;
  }
};

// Normalize a raw terminal-tab title: strip the first matching transport
// prefix (e.g. mosh's "[mosh] ") and trim. Adapters send raw; the box
// normalizes here so session.mjs can stay exact-match.
export const stripTitle = (raw, prefixes) => {
  let t = raw ?? "";
  for (const p of prefixes || []) {
    if (t.startsWith(p)) {
      t = t.slice(p.length);
      break;
    }
  }
  return t.trim();
};

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULTS = {
  curtain: {
    enabled: true,
    coverableStates: ["working", "done", "needs", "compacting"],
    focus: {
      source: "ssh-osascript",
      pollMs: 350,
      eventFile: "$HOME/.local/state/status-herald/focus-events",
      heartbeatSec: 20,
      ssh: { host: "mac-music", connectTimeout: 4 },
      terminalApp: "ghostty",
      titleStripPrefixes: ["[mosh] "],
    },
    autoArm: { enabled: true, sessionGlob: "*" },
    theme: "classic",
    themeBySession: {},
    themes: {},
    animation: { fps: 2 },
    // While a session is covered, optionally restyle its tmux status bar.
    // "keep" = no change. "transparent" = drop the bar's background (unless
    // wash is painting a state colour). wash=true → whole-bar breathing from
    // @herald_state (card loop + hooks drive the phase).
    tmuxBar: {
      whenCovered: "keep",
      // Off by default: full-bar colour flash hid context; sliding line stole
      // status-left. Context (@ctxbar) must stay the primary bar signal.
      wash: false,
      doneFlashSec: 3,
    },
    // Stuck-state defense (Grok synthesis hosts + optional fleet ceilings).
    // See lib/curtain/settle.mjs. Claude task-list hosts are not quiet-settled.
    settle: {
      settleSynthQuietSec: 90,
      settleSynthLeakSec: 180,
      maxWorkingSec: 0,
      maxNeedsSec: 0,
    },
  },
  // Slice 2 native bars. Defaults reproduce today's look (account gauges on,
  // model badge off in the bar, Claude statusline on). Per-segment toggles and
  // priorities drive orderSegments + width-drop; partial overrides deep-merge.
  bars: {
    tmux: { enabled: true },
    claude: { enabled: true, silentCapture: false },
    segments: {
      context: { enabled: true, priority: 100 },
      model: { enabled: false, priority: 60 },
      state: { enabled: true, priority: 90 },
      account5h: { enabled: true, priority: 30 },
      accountWeekly: { enabled: true, priority: 20 },
      clock: { enabled: true, priority: 10 },
      notify: { enabled: true, priority: 40 },
    },
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
export const merge = (base, over) => {
  if (over === undefined) return base;
  if (Array.isArray(base) || base === null || typeof base !== "object")
    return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
};

// Minimal glob: "*" becomes ".*"; every other char is matched literally.
// Shared by session arming (autoArm.sessionGlob) and theme binding
// (themeBySession) so both use one matcher.
export const globToRe = (g) =>
  new RegExp(
    `^${g
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );

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

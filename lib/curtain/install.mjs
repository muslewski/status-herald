import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This package's own CLI entry, resolved absolutely from this module's location
// so it does not depend on where herald was invoked from.
const HERALD_BIN = fileURLToPath(new URL("../../bin/herald", import.meta.url));

// The events that move a session's state. One payload-aware command on each: the
// event name alone cannot distinguish "the turn ended" from "the work finished"
// -- only the stdin payload can (background_tasks for Claude; synthesized for
// Grok) -- so they all route to the same command.
export const EVENTS = [
  // SessionStart self-arms a new session's curtain the moment its agent starts,
  // so a tab opened after the last `arm-all` is not left uncovered. Idempotent.
  "SessionStart",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "Notification",
  // PreCompact marks a compaction beginning: real work with no live output that
  // would otherwise leave the card on the previous DONE for the whole minute.
  "PreCompact",
  // PostToolUse is the "active again" marker. Claude Code fires no event when a
  // block clears (approval granted, compaction ended, a background task resumed
  // the turn), so a transient NEEDS/COMPACTING would stick until the next Stop.
  // A tool the agent ran proves it is working, clearing the stale state.
  "PostToolUse",
];

// The absolute, PATH-independent hook command, resolved fresh at install time
// from the node running the installer and this package's bin entry. A hook fires
// in whatever environment the agent host hands it -- Grok's standalone binary, a
// non-login shell, a systemd-spawned session -- and that environment often does
// not carry the nvm shim dir that puts a bare `herald` on PATH. A bare command
// then exits 127 before any code runs, and because hooks fail open, silently. An
// absolute `"<node>" "<bin/herald>"` starts regardless. tmux still resolves from
// /usr/bin. Re-running install rewrites this, so a node upgrade self-heals.
export const hookCommand = () =>
  `"${process.execPath}" "${HERALD_BIN}" curtain hook`;

// Any herald curtain-hook wiring, however herald was resolved: bare
// `herald curtain hook`, an absolute `"/x/node" "/y/bin/herald" curtain hook`,
// or a stale absolute from a previous node version. Used to migrate/replace all
// of them with the freshly resolved command.
const isHeraldHookCmd = (cmd) =>
  typeof cmd === "string" && /\bcurtain hook\b/.test(cmd) && /herald/.test(cmd);

// The pre-payload wiring mapped one event name to one state (`Stop -> done`),
// which is the original bug. Match any of it so install migrates it away.
const isLegacyCmd = (cmd) =>
  typeof cmd === "string" &&
  /\bcurtain event\b/.test(cmd) &&
  /herald/.test(cmd);

const entry = (command) => ({ hooks: [{ type: "command", command }] });
const has = (groups, cmd) =>
  (groups || []).some((g) => (g.hooks || []).some((h) => h.command === cmd));

export const hooksInstalled = (settings) => {
  const cmd = hookCommand();
  return EVENTS.every((ev) => has(settings?.hooks?.[ev], cmd));
};

// Mutates settings; drops every *entry* whose command matches `pred`, keeping
// the group (and any co-located foreign hooks) when something remains. Empty
// groups are removed. Pre-r003 filtered whole groups, which silently deleted
// foreign commands that shared a group with herald on uninstall/migrate.
// Returns true if anything was removed.
const dropWhere = (settings, pred) => {
  if (!settings.hooks) return false;
  let changed = false;
  for (const ev of Object.keys(settings.hooks)) {
    const groups = settings.hooks[ev];
    if (!Array.isArray(groups)) continue;
    const nextGroups = [];
    let evChanged = false;
    for (const g of groups) {
      const hooks = g.hooks || [];
      const keptHooks = hooks.filter((h) => !pred(h.command));
      if (keptHooks.length !== hooks.length) evChanged = true;
      if (keptHooks.length === 0) continue; // drop empty group
      nextGroups.push(
        keptHooks.length === hooks.length ? g : { ...g, hooks: keptHooks },
      );
    }
    if (evChanged || nextGroups.length !== groups.length) {
      settings.hooks[ev] = nextGroups;
      changed = true;
    }
  }
  return changed;
};

// Mutates settings; returns true if anything was added or migrated. Removes
// legacy hooks and any prior herald hook that is not exactly the current
// command (bare, or a stale-absolute from another node), then adds the fresh
// absolute command on every event.
export const mergeHooks = (settings) => {
  settings.hooks ??= {};
  const cmd = hookCommand();
  let changed = dropWhere(settings, isLegacyCmd);
  if (dropWhere(settings, (c) => isHeraldHookCmd(c) && c !== cmd))
    changed = true;
  for (const ev of EVENTS) {
    settings.hooks[ev] ??= [];
    if (!has(settings.hooks[ev], cmd)) {
      settings.hooks[ev].push(entry(cmd));
      changed = true;
    }
  }
  return changed;
};

// Mutates settings; removes only herald hook entries (current + legacy).
export const removeHooks = (settings) => {
  const legacy = dropWhere(settings, isLegacyCmd);
  const current = dropWhere(settings, isHeraldHookCmd);
  return legacy || current;
};

// Inspect the herald hook wiring in a settings file for `doctor`: is a hook
// present, is it the current absolute command, is it a bare name (the failure
// mode), and do the absolute paths it names exist on disk?
export const inspectWiring = (path) => {
  const l = load(path);
  if (l.malformed) return { present: false, malformed: true };
  const cmds = [];
  for (const groups of Object.values(l.settings?.hooks || {}))
    for (const g of groups || [])
      for (const h of g.hooks || [])
        if (isHeraldHookCmd(h?.command)) cmds.push(h.command);
  if (!cmds.length) return { present: false };
  const cur = hookCommand();
  const bare = cmds.some((c) => !c.includes("/"));
  const resolvable = cmds.every((c) => {
    const paths = [...c.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return paths.length > 0 && paths.every((p) => existsSync(p));
  });
  return {
    present: true,
    current: cmds.every((c) => c === cur),
    bare,
    resolvable,
    sample: cmds[0],
  };
};

export const getClaudeSettingsPath = () =>
  join(homedir(), ".claude", "settings.json");

export const getGrokHooksPath = () =>
  join(homedir(), ".grok", "hooks", "herald.json");

const load = (path) => {
  if (!existsSync(path)) return { settings: {}, existed: false };
  const raw = readFileSync(path, "utf8");
  try {
    return { settings: JSON.parse(raw), existed: true };
  } catch {
    return { malformed: true };
  }
};

export const install = (path) => {
  const l = load(path);
  if (l.malformed)
    return { ok: false, reason: `malformed JSON in ${path}; left untouched` };
  const changed = mergeHooks(l.settings);
  if (changed) {
    if (l.existed) copyFileSync(path, `${path}.bak`);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(l.settings, null, 2)}\n`);
  }
  return { ok: true, changed };
};

export const uninstall = (path) => {
  const l = load(path);
  if (l.malformed)
    return { ok: false, reason: `malformed JSON in ${path}; left untouched` };
  if (!l.existed) return { ok: true, changed: false };
  const changed = removeHooks(l.settings);
  if (changed) {
    copyFileSync(path, `${path}.bak`);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(l.settings, null, 2)}\n`);
  }
  return { ok: true, changed };
};

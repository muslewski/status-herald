import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const HOOK = "herald curtain hook";

// One payload-aware command on every event that moves a session. The event name
// alone cannot distinguish "the turn ended" from "the work finished" -- only the
// stdin payload's background_tasks can -- so all five route to the same command.
export const HOOK_CMDS = {
  UserPromptSubmit: HOOK,
  SubagentStart: HOOK,
  SubagentStop: HOOK,
  Stop: HOOK,
  Notification: HOOK,
};

// Pre-payload wiring: these mapped an event name straight to a state, which is
// exactly the bug (Stop -> done, even with subagents still running). `install`
// strips them so upgrading does not leave two hooks fighting over the state.
export const LEGACY_CMDS = {
  UserPromptSubmit: "herald curtain event working",
  Stop: "herald curtain event done",
  Notification: "herald curtain event needs",
};

const entry = (command) => ({ hooks: [{ type: "command", command }] });
const has = (groups, cmd) =>
  (groups || []).some((g) => (g.hooks || []).some((h) => h.command === cmd));

export const hooksInstalled = (settings) =>
  Object.entries(HOOK_CMDS).every(([ev, cmd]) =>
    has(settings?.hooks?.[ev], cmd),
  );

// Mutates settings; drops every entry running one of `cmds`. Returns true if changed.
const dropCmds = (settings, cmds) => {
  if (!settings.hooks) return false;
  let changed = false;
  for (const [ev, cmd] of Object.entries(cmds)) {
    const groups = settings.hooks[ev];
    if (!groups) continue;
    const kept = groups.filter(
      (g) => !(g.hooks || []).some((h) => h.command === cmd),
    );
    if (kept.length !== groups.length) {
      settings.hooks[ev] = kept;
      changed = true;
    }
  }
  return changed;
};

// Mutates settings; returns true if anything was added or migrated.
export const mergeHooks = (settings) => {
  settings.hooks ??= {};
  let changed = dropCmds(settings, LEGACY_CMDS);
  for (const [ev, cmd] of Object.entries(HOOK_CMDS)) {
    settings.hooks[ev] ??= [];
    if (!has(settings.hooks[ev], cmd)) {
      settings.hooks[ev].push(entry(cmd));
      changed = true;
    }
  }
  return changed;
};

// Mutates settings; removes only herald hook entries; returns true if changed.
export const removeHooks = (settings) => {
  const legacy = dropCmds(settings, LEGACY_CMDS);
  const current = dropCmds(settings, HOOK_CMDS);
  return legacy || current;
};

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
    writeFileSync(path, `${JSON.stringify(l.settings, null, 2)}\n`);
  }
  return { ok: true, changed };
};

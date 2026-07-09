import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export const HOOK_CMDS = {
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

// Mutates settings; returns true if anything was added.
export const mergeHooks = (settings) => {
  settings.hooks ??= {};
  let changed = false;
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
  if (!settings.hooks) return false;
  let changed = false;
  for (const [ev, cmd] of Object.entries(HOOK_CMDS)) {
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

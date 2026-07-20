# Plan r003: entry-level hook uninstall + absolute grid hooks

> **For the executor:** REQUIRED — TDD. Touch only in-scope files.
> Parent: install safety / plan 013 absolute wiring. Cluster: C1. Phase: 1.

**Goal:** (1) Never drop foreign hook commands that share a settings group with herald. (2) Grid tmux hooks invoke absolute `node`+`bin/herald` like agent hooks.

**Architecture:** Change `dropWhere` to filter hooks inside each group, keep the group if any hooks remain. Reuse `hookCommand()` from install (or equivalent absolute command string) in `grid.mjs` set-hook run-shell lines.

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, `./node_modules/.bin/biome`.

## Status

- **Severity:** P2
- **Effort:** S–M
- **Parent plan(s):** phase-1 install invariants, plan 013 absolute wiring
- **Cluster:** C1
- **Planned at:** `16f4a3f`
- **Depends on:** none

## Why this matters

Co-located foreign+herald hooks lose the foreign command on uninstall/migrate. Grid focus hooks silently 127 if bare `herald` is not on tmux PATH.

## Evidence

- `lib/curtain/install.mjs:75–89` — `dropWhere` filters whole groups
- `lib/curtain/grid.mjs:70–82` — `run-shell "herald curtain focus-in …"`
- Agent hooks already absolute via `hookCommand()`

## Files

- In scope: `lib/curtain/install.mjs`, `lib/curtain/grid.mjs`, `test/install.test.mjs`, and a small grid test file if one exists that can assert hook argv (or add assertion in `test/grid.integration.test.mjs` / new unit if grid exports a pure helper)
- Out of scope: 020, session.mjs, cli.mjs (except if grid needs import only), live tmux destroy of operator sessions

## Steps

- [ ] **Step 1: Failing tests**

1. `test/install.test.mjs` — mixed group:

```js
test("uninstall preserves foreign hooks that share a group with herald", () => {
  const p = tmp();
  const heraldCmd = CMD; // existing fixture constant for current absolute cmd if present; else use hookCommand()
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: heraldCmd },
              { type: "command", command: "my-other-tool --x" },
            ],
          },
        ],
      },
    }),
  );
  // install first so CMD matches package, or use isHeraldHookCmd-compatible string
  install(p); // ensures known herald cmd present; may restructure — prefer write exact current hookCommand()
  // Better: write with hookCommand() from module:
});
```

Concrete approach (match existing test style):

```js
import { hookCommand, install, uninstall, EVENTS } from "../lib/curtain/install.mjs";

test("removeHooks keeps foreign command in a mixed group", () => {
  const p = tmp();
  const cmd = hookCommand();
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: cmd },
              { type: "command", command: "foreign-sidecar" },
            ],
          },
        ],
      },
    }),
  );
  const r = uninstall(p);
  assert.equal(r.ok, true);
  const settings = JSON.parse(readFileSync(p, "utf8"));
  const cmds = (settings.hooks.Stop || []).flatMap((g) =>
    (g.hooks || []).map((h) => h.command),
  );
  assert.ok(cmds.includes("foreign-sidecar"), "foreign kept");
  assert.equal(cmds.some((c) => c === cmd), false, "herald removed");
});
```

2. For grid absolute hooks — export a pure helper if needed:

```js
// in grid.mjs
import { hookCommand } from "./install.mjs";
// but hookCommand is "… curtain hook" — for focus-in need:
// `"${process.execPath}" "${HERALD_BIN}" curtain focus-in #{pane_id}`
```

Prefer small exported builder:

```js
// grid.mjs
import { fileURLToPath } from "node:url";
const HERALD_BIN = fileURLToPath(new URL("../../bin/herald", import.meta.url));
export const focusHookCmd = (which) =>
  `"${process.execPath}" "${HERALD_BIN}" curtain ${which} #{pane_id}`;
```

Test:

```js
test("focusHookCmd is absolute node+herald, not bare herald", () => {
  const c = focusHookCmd("focus-in");
  assert.match(c, process.execPath);
  assert.match(c, /bin\/herald/);
  assert.doesNotMatch(c, /^herald /);
});
```

Use in set-hook: `run-shell '${focusHookCmd("focus-in")}'` — careful quoting. Current uses single-quoted run-shell body. Build:

```js
`run-shell ${JSON.stringify(focusHookCmd("focus-in"))}`
// or match install style carefully
```

Simplest safe form matching install:

```js
t(["set-hook", "-t", SESSION, "pane-focus-in",
  `run-shell ${JSON.stringify(`${process.execPath} ${HERALD_BIN} curtain focus-in #{pane_id}`)}`]);
```

Note: `#{pane_id}` must remain unexpanded by shell until tmux runs it — put it inside the double-quoted command string tmux parses. Mirror:

```js
`run-shell "${process.execPath} ${HERALD_BIN} curtain focus-in #{pane_id}"`
```

- [ ] **Step 2: Run tests RED**

```bash
node --test test/install.test.mjs
```

- [ ] **Step 3: Implement dropWhere**

```js
const dropWhere = (settings, pred) => {
  if (!settings.hooks) return false;
  let changed = false;
  for (const ev of Object.keys(settings.hooks)) {
    const groups = settings.hooks[ev];
    if (!Array.isArray(groups)) continue;
    const nextGroups = [];
    for (const g of groups) {
      const hooks = g.hooks || [];
      const keptHooks = hooks.filter((h) => !pred(h.command));
      if (keptHooks.length !== hooks.length) changed = true;
      if (keptHooks.length === 0) continue; // drop empty group
      nextGroups.push({ ...g, hooks: keptHooks });
    }
    if (nextGroups.length !== groups.length || changed) {
      settings.hooks[ev] = nextGroups;
    }
  }
  return changed;
};
```

Wire grid hooks to absolute command.

- [ ] **Step 4–5: PASS + full suite + biome**

```bash
node --test
./node_modules/.bin/biome check lib/curtain/install.mjs lib/curtain/grid.mjs test/install.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(curtain): entry-level hook drop + absolute grid focus hooks (r003)"
```

## STOP conditions

- uninstall API changes break existing tests without fixable cause
- 020 / live operator settings mutation beyond temp files in tests

## Executor report format

```
STATUS: COMPLETE | STOPPED
STEPS: ...
FILES CHANGED: ...
NOTES: ...
```

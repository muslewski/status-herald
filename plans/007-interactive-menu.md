# Plan 007: Interactivity — `herald menu` preset switcher (tmux display-menu + plain fallback)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Plans 003, 005, 006 must be DONE. Verify
> `./bin/herald presets` lists presets and `lib/config.mjs` exports
> `saveConfig`. If `herald menu` already responds, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (writes only HERALD's own config; tmux interaction is
  read-mostly)
- **Depends on**: plans/003, 005, 006
- **Category**: direction
- **Planned at**: greenfield; tmux `display-menu` semantics per tmux ≥3.0
  man page; config-as-message-bus decision recorded in plans/README.md,
  2026-07-02

## Why this matters

The operator's explicit wish: the bar "can get interactive once something is
pressed… a status bar can have a menu and options to change it." Hosts differ
wildly here — tmux has a native popup menu primitive (`display-menu`), Claude
Code's statusLine has none (stdout only). HERALD's answer is the
**config-as-message-bus** pattern: interaction happens through any available
affordance, the result is written to HERALD's config, and *every* surface
(including the non-interactive Claude Code bar) reflects it on its next
refresh tick. This plan ships the first interaction: switching the current
project's preset.

## Current state

After Plans 003–006:
- `loadConfig`/`saveConfig` (`lib/config.mjs`) — atomic, fail-soft.
- `resolveProject(cwd, config)` → `{id, root, entry}` (`lib/project.mjs`);
  preset resolution reads `config.projects[id].preset`.
- `listPresets({env, home})` → `[{name, description, source}]`
  (`lib/presets.mjjs` — note: actual file is `lib/presets.mjs`).
- `herald render` re-reads config on every invocation (stateless CLI), so a
  config write IS the broadcast: tmux repaints within `status-interval`
  (5 s), Claude Code on its next 300 ms-debounced update or `refreshInterval`
  tick.

**tmux facts** (the executor must not guess):
- `display-menu` (tmux ≥ 3.0): `tmux display-menu -T "title" "label" "key"
  "command" …` — triplets of label/key/command; empty label = separator. It
  must run against a live tmux server; from a non-tmux terminal it fails.
- `$TMUX` env var is set inside tmux clients — the standard detection.
- A command run by display-menu executes via tmux's command parser; use
  `run-shell "herald preset set <name> --cwd <path>"` as the item command.
- Keybinding convention: users bind it themselves; the README snippet (Plan
  009) will suggest `bind-key h run-shell "herald menu --cwd '#{pane_current_path}'"`.
  Note `#{pane_current_path}` — the *pane's* cwd, not the server's.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |
| Smoke (no tmux) | `printf '2\n' \| TMUX= ./bin/herald menu` | numbered list, picks #2, prints confirmation |

## Scope

**In scope**:
- `lib/menu.mjs` (create) — menu model + tmux argv builder
- `bin/herald` (extend) — `menu` and `preset set|get` verbs
- `test/menu.test.mjs` (create)

**Out of scope** (do NOT touch):
- Any new tmux keybinding written by `herald install tmux` — the wiring
  stays a documented snippet (Plan 009); auto-binding keys into a user's
  tmux.conf is a consent question deferred to a future `--menu` install flag.
- Toggling individual segments, theme switching from the menu — natural
  follow-ups, not v1.
- Claude Code-side interaction — no affordance exists; the docs explain the
  message-bus model instead.

## Git workflow

- Branch: `advisor/007-interactive-menu`
- Conventional Commits, e.g. `feat(menu): tmux display-menu preset switcher with plain fallback`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `herald preset set <name> [--cwd <path>] [--global]`

- Validate `<name>` against `listPresets` (unknown → print known names,
  exit 1 — this verb is interactive, not a render hot path; loud is right).
- `--global`: set `config.defaultPreset`. Otherwise: resolve the project for
  `--cwd` (default `process.cwd()`), upsert
  `config.projects[id] = {...existing, root, preset: name}`, `saveConfig`.
- Print one confirmation line: `preset oracle-forecast → project token-oracle-a1b2c3d4`.
- `herald preset get [--cwd]`: print the resolved preset name and source
  (project/global/builtin-default) — thin wrapper over existing resolution.

**Verify**: `d=$(mktemp -d); XDG_CONFIG_HOME=$d ./bin/herald preset set stoic --cwd /tmp && XDG_CONFIG_HOME=$d ./bin/herald preset get --cwd /tmp` → prints `stoic (source: project)`.

### Step 2: `lib/menu.mjs`

```js
// menuItems(config, cwd, {env, home}) -> [{name, description, current: bool}]
// tmuxMenuArgs(items, cwd) -> argv array for execFileSync('tmux', argv):
//   ['display-menu', '-T', 'status-herald', <label>, <key>, <command>, ...]
//   label: '<name> — <description>' with '*' prefix when current;
//   key: '1'..'9' then 'a'..'z'; command: `run-shell "herald preset set
//   <name> --cwd '<cwd>'"` (single-quote cwd; reject cwds containing a
//   single quote with a clear error rather than escaping heroics).
```

### Step 3: `herald menu [--cwd <path>]`

- Inside tmux (`env.TMUX` non-empty): `execFileSync('tmux',
  tmuxMenuArgs(...))`; any failure falls through to the plain path.
- Plain fallback: print a numbered list of presets (current marked `*`),
  read one line from stdin, apply via the same code path as `preset set`.
  Non-numeric/out-of-range input → print `no change`, exit 0.
- `--cwd` defaults to `process.cwd()` — tmux binding passes the pane path.

**Verify**: the smoke command from the table (uses `TMUX=` empty to force
fallback) → picks the second preset, confirmation printed; re-run
`herald preset get` → shows it.

### Step 4: tests

`test/menu.test.mjs`:
- `preset set` round-trip in temp XDG dir: config gains
  `projects.<id>.preset`; `--global` sets `defaultPreset`; unknown preset
  name → exit 1, config untouched (byte-compare).
- `menuItems` marks the resolved current preset; `tmuxMenuArgs` produces the
  exact argv triplet shape (assert full array for two presets); cwd with a
  single quote → throws the clear error.
- Plain fallback end-to-end: spawn `./bin/herald menu` with `TMUX=''`, pipe
  `2\n`, assert config changed to the second listed preset.

**Verify**: `node --test` → all pass; `npx biome check .` → exit 0.

## Test plan

Covered in Step 4. Pattern: hermetic temp XDG dirs (Plan 003 tests), spawn
with controlled env.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0; `test/menu.test.mjs` passes
- [ ] `npx biome check .` exits 0
- [ ] The Step 1 verify one-liner prints `stoic (source: project)`
- [ ] `TMUX= printf 'x\n' | XDG_CONFIG_HOME=$(mktemp -d) ./bin/herald menu` → `no change`, exit 0
- [ ] `grep -n "display-menu" lib/menu.mjs` → match
- [ ] No runtime dependencies added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The installed tmux is < 3.0 (`tmux -V`) — display-menu is absent; the
  fallback still ships, but flag the version so docs set expectations.
- You find yourself escaping shell metacharacters beyond the single-quote
  rejection — that's the injection cliff; report instead.
- Making the menu work requires a daemon/socket — the stateless
  config-as-bus model is a recorded decision; do not add background
  processes.

## Maintenance notes

- Follow-ups queued behind this pattern: theme switcher, per-segment
  toggles, `herald menu --section alerts`. All reuse `preset set`'s
  config-write + next-tick-pickup mechanics.
- zellij's equivalent affordance is keybinding→`Run` plugins (Plan 010
  spike); kitty has none for the tab bar — the plain fallback is their path.
- Reviewers: check the tmux argv is built as an ARRAY (no string
  concatenation into `sh -c`) and that fallback exit codes keep 0 for
  "declined" (menus must be safe to bind to a key and cancel).
- Known cosmetic nit: "Current state" mentions `lib/presets.mjjs` — the real
  path is `lib/presets.mjs` (typo acknowledged here so nobody "fixes" a
  nonexistent file).

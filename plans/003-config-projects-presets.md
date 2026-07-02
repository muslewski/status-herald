# Plan 003: Config loading, project registry, and preset resolution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Plan 001 must be DONE (`node --test` exits 0,
> `./bin/herald --version` works). Plan 002 is NOT required. If `lib/config.mjs`
> or `lib/project.mjs` already exist, STOP — someone implemented this already.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-bootstrap-repo.md
- **Category**: direction
- **Planned at**: greenfield; conventions sourced from agentic-sage @
  `cffd055` (`lib/repo-id.mjs`, `lib/roots.mjs`) and token-oracle @ `ada32e9`
  (`core/config.py`), 2026-07-02

## Why this matters

The operator's core design decision: HERALD installs **globally, once** — but
users define **presets per project** ("in repo X show the token forecast, in
repo Y show fleet info"). That requires three things this plan builds: a
fail-soft global config, a stable project identity (so per-project settings
survive renames of tmux sessions and multiple worktrees of the same repo),
and a deterministic preset-resolution order. The config file doubles as the
message bus for interactivity later (Plan 007): `herald menu` writes a preset
choice here, and every surface picks it up on its next refresh tick.

## Current state

After Plan 001: `bin/herald`, `lib/version.mjs`, tests, CI. No config code.

Conventions to honor, inlined from the sibling repos:

**agentic-sage `lib/repo-id.mjs` — project identity (port this exactly):**
- `repoId = `${basename(root)}-${sha256(root).slice(0, 8)}`` where `root` is
  the **realpath of the parent of the git common dir**, resolved via
  `git rev-parse --path-format=absolute --git-common-dir` run in the cwd.
  This makes every linked worktree resolve to the SAME id as its main
  checkout — essential, or a worktree would silently lose its project preset.
- Not inside a git repo → identity falls back to the cwd itself (id
  `${basename(cwd)}-${sha256(realpath(cwd)).slice(0,8)}`).

**token-oracle `core/config.py` — fail-soft loading (port the stance):**
- `load_config` NEVER raises. Malformed JSON, wrong types, unknown keys →
  defaults win and a human-readable string is appended to an `issues` list
  that diagnostic verbs (doctor, where) print. A broken config must never
  blank a status bar.

**XDG paths** (both siblings use XDG data dirs; HERALD follows):
- Config: `${XDG_CONFIG_HOME:-~/.config}/status-herald/config.json`
- User presets: `${XDG_CONFIG_HOME:-~/.config}/status-herald/presets/<name>.json`
- State/cache (Plan 004 uses it): `${XDG_STATE_HOME:-~/.local/state}/status-herald/`

**Config file shape** (this plan defines it; later plans consume it):

```json
{
  "theme": "oracle",
  "defaultPreset": "default",
  "projects": {
    "token-oracle-a1b2c3d4": {
      "root": "/home/kento/Repositories/token-oracle",
      "preset": "oracle-forecast",
      "displayName": "oracle",
      "vars": {}
    }
  }
}
```

`projects` is keyed by repoId. `root` is informational (doctor prints it);
resolution is always by recomputed repoId, never by path comparison. `vars`
is an open object presets may interpolate (Plan 006). All fields optional.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |

## Scope

**In scope**:
- `lib/paths.mjs` (create) — XDG path builders, all taking `(env, home)` params
- `lib/config.mjs` (create) — `loadConfig`, `saveConfig`, issues list
- `lib/project.mjs` (create) — `repoRoot`, `repoId`, `resolveProject`,
  `resolvePresetName`
- `bin/herald` (extend) — add the `where` verb
- `test/paths.test.mjs`, `test/config.test.mjs`, `test/project.test.mjs` (create)

**Out of scope** (do NOT touch):
- Preset file *content* and built-in presets — Plan 006.
- Providers, rendering, install verbs — Plans 004/005.
- Migrating or reading any agentic-sage/token-oracle config file — HERALD has
  its own config; integration happens via presets, not config sharing.

## Git workflow

- Branch: `advisor/003-config-projects-presets`
- Conventional Commits, e.g. `feat(config): fail-soft config, repo identity, preset resolution`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `lib/paths.mjs`

```js
// XDG path builders. Every function takes (env, home) so tests inject temp
// dirs — never touch the real HOME (agentic-sage hermetic-test convention).
export const configDir = (env = process.env, home = os.homedir()) =>
  path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'status-herald')
export const configFile = (env, home) => path.join(configDir(env, home), 'config.json')
export const userPresetsDir = (env, home) => path.join(configDir(env, home), 'presets')
export const stateDir = (env = process.env, home = os.homedir()) =>
  path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'status-herald')
```

**Verify**: `node --test test/paths.test.mjs` → passes (tests in Step 5).

### Step 2: `lib/config.mjs`

```js
// loadConfig({env, home}) -> { config, issues }
//   - missing file: defaults, no issue (first run is not an error)
//   - unreadable/malformed JSON: defaults + issues ['config.json: <reason>']
//   - non-object fields (theme not string, projects not object, ...):
//     field-level fallback to default + one issue per field
// saveConfig(config, {env, home}) -> path | null
//   - mkdir -p the config dir; atomic write: write to `${file}.tmp-${pid}`
//     then fs.renameSync over the target (port of token-oracle's
//     mkstemp+os.replace convention); returns null on any error, never throws.
export const DEFAULTS = { theme: 'oracle', defaultPreset: 'default', projects: {} }
export const loadConfig = ({ env, home } = {}) => ...
export const saveConfig = (config, { env, home } = {}) => ...
```

**Verify**: `node --test test/config.test.mjs` → passes.

### Step 3: `lib/project.mjs`

```js
// repoRoot(cwd): parent of `git rev-parse --path-format=absolute
// --git-common-dir` (execFileSync git, 2s timeout, stdio pipe), realpathed.
// Returns null outside a git repo or when git is missing (fail-open).
// repoId(root): `${path.basename(root)}-${sha256(root).slice(0,8)}`
// resolveProject(cwd, config): { id, root, entry|null } — root falls back to
// realpath(cwd) when repoRoot is null.
// resolvePresetName(cwd, config): entry?.preset ?? config.defaultPreset ?? 'default'
```

Use `node:crypto` `createHash('sha256')`. Match agentic-sage's id shape
exactly (`basename-8hexchars`) so users see one familiar convention across
the tool family.

**Verify**: `node --test test/project.test.mjs` → passes.

### Step 4: `herald where` verb

Extend `bin/herald`'s switch with `where`: print, as plain lines,

```
config   /home/user/.config/status-herald/config.json (present|absent)
project  token-oracle-a1b2c3d4  /home/kento/Repositories/token-oracle
preset   oracle-forecast  (source: project|default|builtin-default)
theme    oracle
issues   (none | one line per issue)
```

Fail-open: any thrown error prints nothing new and exits 0.

**Verify**: `cd /tmp && herald_path=$(pwd) && cd - >/dev/null; ./bin/herald where` → prints the
five lines with `preset default (source: builtin-default)` on a fresh machine
profile (set `XDG_CONFIG_HOME` to an empty temp dir to simulate).

### Step 5: tests

`test/paths.test.mjs`: XDG overrides honored; defaults built from injected
home. `test/config.test.mjs`: missing file → defaults + zero issues;
malformed JSON → defaults + 1 issue naming the file; wrong-typed `projects` →
default + field issue; save→load round-trip in a temp XDG_CONFIG_HOME; save
returns null on unwritable dir (e.g. path under a file). `test/project.test.mjs`:
build a real temp git repo (`git init`, `git -C … rev-parse` available on CI);
repoId stable across a linked worktree (`git worktree add`); non-git dir falls
back to cwd-based id; `resolvePresetName` honors project entry over default.
Model the temp-git-repo setup as a small helper inside the test file.

**Verify**: `node --test` → all pass; `npx biome check .` → exit 0.

## Test plan

Covered in Step 5. Pattern: node:test, hermetic temp dirs, injected
`{env, home}` — same as agentic-sage's test suite and Plan 001's smoke test.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0; the three new test files pass
- [ ] `npx biome check .` exits 0
- [ ] `XDG_CONFIG_HOME=$(mktemp -d) ./bin/herald where` prints 5 lines, exit 0
- [ ] `node -e "import('./lib/project.mjs').then(async m=>console.log(m.repoId('/tmp/foo')))"` → `foo-` + 8 hex chars
- [ ] Corrupt config never crashes: `d=$(mktemp -d); mkdir -p $d/status-herald; echo '{oops' > $d/status-herald/config.json; XDG_CONFIG_HOME=$d ./bin/herald where` → exit 0, `issues` line mentions config.json
- [ ] No runtime dependencies added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `git` is unavailable on the machine (project identity tests can't run).
- You are tempted to have `loadConfig` throw for any input — the never-throw
  contract is load-bearing for every status-bar host; report instead.
- Windows-style paths break repoId tests — POSIX is the v1 target; note it
  and continue, do not add platform shims.

## Maintenance notes

- The `projects` map grows monotonically; a future `herald clean` verb should
  prune entries whose `root` no longer exists (mirror token-oracle plan 008's
  init/clean pairing). Deferred deliberately.
- `repoId` must stay byte-compatible with agentic-sage's `repo-id.mjs` — if
  sage changes its hashing, coordinate; users will eventually see both ids in
  docs.
- Reviewers: check atomic-save uses rename on the same filesystem (temp file
  must live in the config dir, not `/tmp`).
- Plan 007 (`herald menu`) writes `projects.<id>.preset` through
  `saveConfig`; Plan 006 defines preset file contents; Plan 008 uses
  `displayName`.

# Plan 008: Identity — one display name across surfaces, `herald name`, tmux sync

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Plans 003, 005, 006 must be DONE. Verify
> `lib/project.mjs` exports `resolveProject` and `herald render` works. If
> `lib/identity.mjs` exists, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003, 005, 006
- **Category**: direction
- **Planned at**: greenfield; Claude Code `session_name` semantics from
  code.claude.com/docs/en/statusline (fetched 2026-07-02); repo identity from
  agentic-sage @ `cffd055`, 2026-07-02

## Why this matters

The operator's pain: Claude Code lets you rename a session (`/rename`), tmux
has its own session names, and nothing keeps them coherent — "two naming
conventions" for one piece of work. HERALD standardizes without inventing a
third scheme: **the project display name lives in HERALD's config; tmux
mirrors it via its native `rename-session`; Claude Code surfaces it as a
rendered segment.** One write point (`herald name`), native mechanisms
everywhere, no reinvention.

## Current state

After Plans 003–006: config has an (unused) `displayName` field per project
entry (`projects.<id>.displayName`, Plan 003); `resolveProject(cwd, config)`
returns `{id, root, entry}`; presets interpolate provider vars; the
claude-context provider (Plan 004) already exposes `session_name` (the name
set via Claude's `/rename`, absent unless set) and `dir`.

**Naming facts:**
- Claude Code: `session_name` arrives in the statusLine stdin payload. There
  is NO documented external API to *set* it — HERALD can display but not
  write it. (Its scope is one conversation, not a project, anyway.)
- tmux: `tmux rename-session -t <current> <name>` is the standard way;
  current session name via `tmux display-message -p '#S'`. Session names
  may not contain `.` or `:` (tmux uses them as target separators) —
  sanitize.
- agentic-sage renders *branch* as identity on its board and never renames
  anything — HERALD adopting "project display name + branch" stays
  consistent with that family convention.

**Precedence to implement** (highest wins):
1. `config.projects[<id>].displayName` — the user said so.
2. `workspace.repo.name` from the Claude payload (repo identity from the
   `origin` remote) — when rendering the claude-code surface.
3. `basename(root)` from `resolveProject` (git root, or cwd fallback).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |
| Smoke | `d=$(mktemp -d); XDG_CONFIG_HOME=$d TMUX= ./bin/herald name oracle && XDG_CONFIG_HOME=$d ./bin/herald name` | sets then prints `oracle` |

## Scope

**In scope**:
- `lib/identity.mjs` (create) — `displayName(ctx)`, `identityVars(ctx)`,
  sanitizer
- `lib/providers/identity.mjs` (create) + registration in
  `lib/providers/index.mjs`
- `bin/herald` (extend) — `name [<new-name>] [--clear] [--cwd <path>]` verb
- `presets/default.json` (extend) — use the identity segment
- `test/identity.test.mjs` (create)

**Out of scope** (do NOT touch):
- Renaming Claude Code sessions (no API — display only).
- Watching for tmux renames done by the user directly (`tmux rename-session`
  by hand) and syncing them BACK into config — one-directional sync only in
  v1; bidirectional is a recorded deferral.
- agentic-sage's board or any sage file.

## Git workflow

- Branch: `advisor/008-identity-naming`
- Conventional Commits, e.g. `feat(identity): project display name, herald name verb, tmux rename sync`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `lib/identity.mjs`

```js
// sanitizeSessionName(name): replace [.:] with '-', trim, collapse
// whitespace to '-', max 40 chars. Exported for tests.
// displayName(ctx): the precedence chain from "Current state".
//   ctx = {env, home, cwd, payload, config} (config passed in — identity
//   never loads config itself).
// identityVars(ctx) -> { project, branch, session, worktree }
//   project: displayName(ctx)
//   branch: via the cached command provider pattern — call the existing
//     command provider internally with git rev-parse --abbrev-ref HEAD
//     (intervalSecs 10) rather than duplicating exec logic.
//   session: payload.session_name ?? null
//   worktree: payload.workspace?.git_worktree ?? payload.worktree?.name ?? null
```

### Step 2: identity provider

`lib/providers/identity.mjs`: `provide(spec, ctx)` → `identityVars(ctx)`
(absent vars omitted so `when`/interpolation hide cleanly). Register as
`identity` in the provider index.

### Step 3: `herald name` verb

- `herald name` (no arg): print the resolved display name and its source
  (`config | repo | dir`).
- `herald name <new-name>`: sanitize; write
  `config.projects[<id>].displayName` (upsert entry with root, like
  `preset set`); if `env.TMUX` is non-empty, also `execFileSync('tmux',
  ['rename-session', sanitized])` (best-effort — tmux failure prints a
  warning but the config write stands). Print what happened:
  `name "oracle" → config + tmux session`.
- `herald name --clear`: delete `displayName` from the project entry.

**Verify**: smoke command from the table → second invocation prints
`oracle (source: config)`.

### Step 4: wire into `default.json`

Prepend to the default preset's first line a segment:
`{id: 'project', provider: 'identity', format: '{project}', role: 'accent',
priority: 95}` and demote the `model` segment to priority 85. Add
`{id: 'session', provider: 'identity', format: '({session})', when:
'session', role: 'dim', priority: 45}` — shows Claude's `/rename` name when
present, hides otherwise.

**Verify**: `echo '{"workspace":{"current_dir":"/tmp/x","repo":{"name":"token-oracle"}},"model":{"display_name":"M"}}' | ./bin/herald render --surface claude-code` → line starts with `token-oracle`.

### Step 5: tests

`test/identity.test.mjs`:
- sanitizer: `a.b:c` → `a-b-c`; long names truncated to 40; whitespace
  collapsed.
- precedence: config displayName beats payload repo.name beats basename
  (three fixtures over one temp git repo).
- `herald name` round-trip in temp XDG dir with `TMUX=` (no tmux calls);
  `--clear` restores basename source.
- identity provider: payload with `session_name` exposes `session`; without,
  var absent (segment hides — assert via pipeline render).

**Verify**: `node --test` → all pass; `npx biome check .` → exit 0.

## Test plan

Covered in Step 5. Never call real tmux in tests (guard all rename tests
with `TMUX=` empty env).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0; `test/identity.test.mjs` passes
- [ ] `npx biome check .` exits 0
- [ ] Smoke command prints `oracle (source: config)`
- [ ] Step 4 verify command output starts with `token-oracle`
- [ ] `grep -n "rename-session" lib/` → only in identity/name code paths
- [ ] No runtime dependencies added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- You are tempted to write to any Claude Code setting to "set" a session
  name — no such contract exists; display-only is the design.
- Sanitization rules conflict with real tmux behavior on this machine
  (test manually with `tmux rename-session` if a live server exists) —
  report the discrepancy rather than loosening the sanitizer.

## Maintenance notes

- Bidirectional sync (user renames tmux session by hand → HERALD adopts it)
  is deliberately deferred: it needs a "which write wins" policy; revisit
  only with a concrete user complaint.
- If agentic-sage ever grows a display-name concept, it should read
  `projects.<id>.displayName` from HERALD's config rather than inventing
  its own — note for that repo's maintainers (repoId schemes are already
  aligned by Plan 003).
- Reviewers: the tmux rename is best-effort by design; check it cannot fail
  the verb (config write must land first).

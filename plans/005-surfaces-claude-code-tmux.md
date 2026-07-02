# Plan 005: Surface adapters — `herald render` for Claude Code and tmux, install verbs, doctor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Plans 001, 002, 003, 004 must all be DONE.
> Verify `lib/render.mjs`, `lib/config.mjs`, `lib/providers/index.mjs` exist
> and `node --test` exits 0. If `herald render` already responds, STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (writes to users' `~/.claude/settings.json` and
  `~/.tmux.conf` — the two files a user least wants clobbered)
- **Depends on**: plans/001, 002, 003, 004
- **Category**: direction
- **Planned at**: greenfield; Claude Code statusLine contract from
  code.claude.com/docs/en/statusline (fetched 2026-07-02); wiring conventions
  from agentic-sage @ `cffd055` (`lib/wiring.mjs`); tmux snippet convention
  from token-oracle @ `ada32e9` (`SETUP.md:28-40`), 2026-07-02

## Why this matters

This plan makes HERALD actually appear somewhere. Two launch surfaces:
Claude Code's statusLine (a shell command fed JSON on stdin, its stdout
displayed as the bar) and tmux's status-right (`#(command)` polled on
`status-interval`). It also ships the non-clobbering installers — the part
users judge a tool by. agentic-sage already solved safe settings.json
merging (backup, abort-on-malformed, skip-if-present); this plan ports that
behavior.

## Current state

After Plans 001–004 the repo has: render core (`render(segments, {surface:
'ansi'|'tmux'|'plain', color, width, separator})`, `pipeColor`), config +
preset-name resolution (`resolvePresetName(cwd, config)`), providers
(`provide(spec, ctx)` → vars|null, `interpolate(format, vars)` → string|null).
Preset *files* don't exist until Plan 006 — this plan hard-codes one built-in
fallback preset (see Step 2) so `herald render` works standalone.

**Claude Code statusLine contract** (inlined from the official docs; the
executor must not guess):

- Wiring: user or project `settings.json` (`~/.claude/settings.json`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "herald render --surface claude-code",
    "padding": 0
  }
}
```

- Claude Code pipes a JSON object to the command's **stdin** on each update
  (debounced 300 ms; runs after each assistant message; an in-flight
  execution is cancelled by a newer one — so the command must be FAST,
  ideally <100 ms). An optional settings key `refreshInterval` re-runs it on
  a timer.
- Key stdin fields (all may be absent — code defensively):
  `model.display_name`, `workspace.current_dir`, `workspace.project_dir`,
  `workspace.repo.{host,owner,name}`, `workspace.git_worktree`,
  `cost.total_cost_usd`, `context_window.used_percentage`,
  `context_window.remaining_percentage`, `exceeds_200k_tokens`,
  `rate_limits.five_hour.{used_percentage,resets_at}`,
  `rate_limits.seven_day.{used_percentage,resets_at}`, `session_id`,
  `session_name` (set via `/rename` — may be absent), `transcript_path`,
  `version`, `output_style.name`, `vim.mode`, `agent.name`,
  `pr.{number,url,review_state}`, `worktree.{name,path,branch}`,
  `effort.level`, `thinking.enabled`.
- Output: **each printed line is a bar row** (multi-line supported); ANSI
  color escapes supported; OSC 8 hyperlinks supported. The script's stdout is
  captured (NOT a TTY — use the `pipeColor` gate). Terminal width is in the
  `COLUMNS` env var (set by Claude Code v2.1.153+; may be absent — treat as
  unlimited).
- Failure mode: print nothing, exit 0. A nonzero exit or stderr noise shows
  an error state in the bar.

**tmux contract**:

- Wiring snippet (token-oracle's documented convention, adapted):

```tmux
# status-herald >>>
set -g status-interval 5
set -g status-right '#(herald render --surface tmux)'
set -g status-right-length 120
# status-herald <<<
```

- `#(command)` output is re-read every `status-interval` seconds; must be a
  single line of tmux format markup (`#[fg=colour214]…#[default]`); literal
  `#` must arrive escaped as `##` (the tmux renderer from Plan 002 does this).

**agentic-sage `lib/wiring.mjs` merge behavior to port** (for settings.json):
backup target to `<file>.bak` before first write; abort (leave file
untouched, print why) when existing JSON is malformed; skip silently when the
exact wiring is already present; never remove or reorder unrelated keys.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |
| Manual smoke (claude) | `echo '{"model":{"display_name":"Test"},"context_window":{"used_percentage":42}}' \| ./bin/herald render --surface claude-code` | one line, exit 0 |
| Manual smoke (tmux) | `./bin/herald render --surface tmux` | one line of tmux markup or empty, exit 0 |

## Scope

**In scope**:
- `lib/surfaces/claude-code.mjs`, `lib/surfaces/tmux.mjs` (create)
- `lib/pipeline.mjs` (create) — preset → providers → segments → render
- `lib/wiring.mjs` (create) — settings.json merge + tmux.conf block append/remove
- `bin/herald` (extend) — `render`, `install`, `uninstall`, `doctor` verbs
- `test/pipeline.test.mjs`, `test/wiring.test.mjs`, `test/surfaces.test.mjs` (create)

**Out of scope** (do NOT touch):
- Shipping real presets (Plan 006) — only the single hard-coded `default`
  preset object below.
- `herald menu`, `herald name` — Plans 007/008.
- zellij/kitty — Plan 010 spike.
- Editing `~/.tmux.conf` or `~/.claude/settings.json` on the DEV machine
  during implementation — tests use temp files exclusively.

## Git workflow

- Branch: `advisor/005-surfaces-claude-tmux`
- Conventional Commits, e.g. `feat(surfaces): claude-code + tmux render, safe installers, doctor`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `lib/pipeline.mjs`

```js
// runPreset(preset, ctx) -> array of lines, each an array of segments.
// preset shape: { name, lines: [ { segments: [spec, ...] } ], separator? }
// For each spec: vars = provide(spec, ctx); vars===null -> skip;
// text = interpolate(spec.format, vars); null -> skip;
// role: spec.role === 'gauge:<var>' resolves via gaugeRole(vars[<var>]),
// otherwise the literal role string.
export const runPreset = (preset, ctx) => ...
```

### Step 2: built-in fallback preset

In `lib/pipeline.mjs` export `FALLBACK_PRESET` used whenever the named preset
cannot be loaded (Plan 006 adds real loading; until then `render` always uses
this):

```js
export const FALLBACK_PRESET = {
  name: 'default',
  lines: [
    {
      segments: [
        { id: 'model', provider: 'claude-context', format: '{model}', role: 'accent', priority: 90 },
        { id: 'dir', provider: 'claude-context', format: '{dir}', role: 'text', priority: 70 },
        { id: 'ctx', provider: 'claude-context', format: '{ctx_pct}% ctx', role: 'gauge:ctx_pct', priority: 80, short: '{ctx_pct}%' },
      ],
    },
  ],
}
```

(On tmux, claude-context vars are absent → all three hide → empty output.
That is correct fail-open behavior; Plan 006 gives tmux real content.)

### Step 3: `herald render`

`bin/herald` verb `render --surface <claude-code|tmux|plain> [--preset <name>]`:

1. Read stdin fully IF surface is `claude-code` (stdin may be empty or
   invalid JSON → payload `{}`; never block on a TTY stdin — check
   `process.stdin.isTTY` and skip reading when true).
2. `loadConfig`; resolve preset name (flag > project > default); load preset
   (this plan: always `FALLBACK_PRESET`).
3. Build ctx `{env, home, cwd, now, payload}`; `runPreset`.
4. Render: claude-code → mode `ansi`, `color = pipeColor(env)`, width =
   `Number(env.COLUMNS) || null`, one stdout line per preset line. tmux →
   mode `tmux`, single line (join preset lines with the separator — tmux is
   one row), width from `config.tmuxWidth ?? null`. plain → mode `none`.
5. **Whole verb wrapped in try/catch → on any error print nothing, exit 0.**
   (Port of sage's `bin/sage:353-355` fail-open statusline stance.)

**Verify**: the two manual smoke commands from the table → expected outputs;
`printf 'not json' | ./bin/herald render --surface claude-code` → empty
output, exit 0.

### Step 4: `lib/wiring.mjs` + install/uninstall verbs

```js
// mergeClaudeSettings(settingsPath, command) -> {action: 'wrote'|'skipped'|'aborted', reason?}
//   - missing file: create with just the statusLine block
//   - malformed JSON: abort, do not touch
//   - statusLine already === ours: skip
//   - statusLine present but different: abort with reason (never overwrite a
//     user's custom statusline; print the manual snippet instead)
//   - else: backup to .bak, set statusLine, write pretty JSON (2-space)
// appendTmuxBlock(confPath) / removeTmuxBlock(confPath): manage the marked
// block between '# status-herald >>>' and '# status-herald <<<' exactly;
// backup to .bak before every write; refuse (abort+reason) if the file
// already contains 'status-right' OUTSIDE our markers (print manual snippet).
```

Verbs:
- `herald install claude-code [--settings <path>]` → default path
  `~/.claude/settings.json`; command wired:
  `herald render --surface claude-code`. Print what happened + the manual
  snippet on abort.
- `herald install tmux [--conf <path>]` → default `~/.tmux.conf`; on success
  print `run: tmux source-file ~/.tmux.conf`.
- `herald uninstall claude-code|tmux` → reverse, same safety rules (only
  remove our exact block/entry).

**Verify**: `node --test test/wiring.test.mjs` → passes (tests in Step 6).

### Step 5: `herald doctor`

Read-only diagnosis, plain lines with ✓/✗/– prefixes, always exit 0 unless a
`--strict` flag is passed (then exit 1 if any ✗):

```
✓ config     ~/.config/status-herald/config.json (0 issues)
✓ preset     oracle-forecast (source: project)
✗ oracle     forecast.json missing (~/.local/share/token-oracle/forecast.json) — run: oracle snapshot
– sage       ~/.claude/agentic-sage not found (optional)
✓ claude     statusLine wired in ~/.claude/settings.json
– tmux       no status-herald block in ~/.tmux.conf
```

Checks: config issues list, preset resolution, forecast.json presence +
freshness (`generated_at` < 15 min → ✓, older → `stale (Nm)` warning), sage
data dir presence, both wirings detected by exact-match inspection.

**Verify**: `XDG_CONFIG_HOME=$(mktemp -d) ./bin/herald doctor` → prints the
six-ish lines, exit 0.

### Step 6: tests

- `test/pipeline.test.mjs`: FALLBACK_PRESET + full Claude payload fixture →
  3 segments, gauge role responds to ctx_pct (42→ok, 101→warn); empty payload
  → zero segments.
- `test/surfaces.test.mjs`: exec `./bin/herald render --surface claude-code`
  with piped fixture JSON (reuse Plan 004's payload fixture) → expected ANSI
  line under `NO_COLOR` unset vs set (set → no `\x1b[`); invalid stdin →
  empty, exit 0; `--surface tmux` with no data → empty, exit 0; `COLUMNS=20`
  env → output visible length ≤ 20.
- `test/wiring.test.mjs` (all on temp files): create-missing; skip-identical;
  abort-on-malformed (file byte-identical after); abort-on-foreign-statusLine
  (file untouched); backup exists after write; tmux append/remove round-trip
  is byte-identical to the original; refuse-on-foreign-status-right.

**Verify**: `node --test` → all pass; `npx biome check .` → exit 0.

## Test plan

Covered in Step 6. Fixtures: Claude stdin payload JSON (build from the field
list in "Current state"), temp settings.json/tmux.conf files. Pattern: Plan
004's hermetic tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0; three new test files pass
- [ ] `npx biome check .` exits 0
- [ ] `echo '{"model":{"display_name":"X"},"context_window":{"used_percentage":10},"workspace":{"current_dir":"/tmp/y"}}' | ./bin/herald render --surface claude-code` → non-empty line containing `X` and `y`, exit 0
- [ ] `printf '' | ./bin/herald render --surface claude-code` → empty, exit 0
- [ ] Wiring tests prove: malformed settings.json is never modified; foreign
      statusLine is never overwritten
- [ ] `herald doctor` exits 0 on a bare machine profile
- [ ] No runtime dependencies added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any test needs to touch the real `~/.claude/settings.json` or
  `~/.tmux.conf` — hermeticity is non-negotiable.
- Claude Code's actual stdin payload on this machine (observable by wiring a
  debug command that tees stdin to a temp file) contradicts the field list —
  the docs may have moved; report the diff.
- Startup latency of `herald render` exceeds ~150 ms on this machine
  (`time ./bin/herald render --surface plain` after warm cache) — the 300 ms
  debounce budget makes this a product problem, not a tuning detail.

## Maintenance notes

- The abort-don't-merge stance for foreign statusLine/status-right is
  deliberate: composing with an existing user statusline (chaining commands)
  is a documented future feature (sage's snippet does it by appending
  `sage statusline` output) — do it as an explicit `--append` mode later,
  never implicitly.
- `refreshInterval` (Claude settings) is worth documenting in Plan 009 for
  time-based segments (stoic quote rotation, staleness countdowns) since
  statusLine otherwise only refreshes on conversation activity.
- Reviewers: check `render` never writes to stderr (hosts surface it as an
  error state).
- Subagent status lines exist in Claude Code (statusLine runs per-subagent) —
  untested surface; noted for the future.

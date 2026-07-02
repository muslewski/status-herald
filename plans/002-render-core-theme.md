# Plan 002: Build the segment model, theme engine, and per-surface renderers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Plan 001 must be DONE. Verify:
> `node --test` exits 0 and `./bin/herald --version` prints a version. If not,
> STOP — the bootstrap has not landed.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-bootstrap-repo.md
- **Category**: direction
- **Planned at**: greenfield; color/style conventions sourced from
  token-oracle @ `ada32e9` (`token_oracle/cli/colors.py`) and agentic-sage @
  `cffd055` (`lib/color.mjs`), 2026-07-02

## Why this matters

This is HERALD's core value: **write a status line once as semantic segments,
render it correctly on any surface**. Claude Code's statusLine wants raw ANSI
escapes; tmux wants `#[fg=colour214,bold]…#[default]` markup; a dumb pipe
wants plain text. Both sibling projects solved this twice (token-oracle has
parallel `statusline.py`/`tmux.py` adapters that differ only in color syntax;
agentic-sage has its own `color.mjs`). HERALD centralizes it: segments carry
*roles* (`ok`, `warn`, `crit`, `accent`, `dim`…), a theme maps roles to
colors, and a renderer compiles to each surface's syntax — including
width-aware shrinking, which neither sibling has.

## Current state

After Plan 001 the repo has `bin/herald` (dispatch skeleton), `lib/version.mjs`,
smoke tests, CI. No rendering code exists.

Conventions to honor, inlined from the sibling repos (the executor need not
read them):

**token-oracle `cli/colors.py` — the color doctrine to port:**
- 256-color foreground codes: accent violet `141`, dim `240`; gauge tiers
  green `42`, lime `154`, orange `214`, red `196`.
- The urgency thresholds are centralized in one function (`gauge_tier(pct)`):
  `pct >= 120 → red`, `>= 100 → orange`, `>= 85 → lime`, else `green`. Single
  source of truth — port these exact thresholds.
- **Two distinct color gates**: interactive surfaces gate on
  `NO_COLOR` + `FORCE_COLOR` + `isatty()`; *piped adapter output* (statusline,
  tmux — always read through a pipe, never a TTY) gates on `NO_COLOR` only.
  Getting this wrong makes colors vanish inside Claude Code (its statusLine
  captures stdout, so isatty is false there).
- Color is applied only at the output boundary; "color-off output == color-on
  output minus escape codes" is an invariant their tests assert. Keep it.

**agentic-sage `lib/color.mjs`** honors `NO_COLOR`, `FORCE_COLOR`, and TTY the
same way and keeps renderers plain-text with color applied at a single
chokepoint. Same doctrine.

**tmux markup facts** (for the tmux renderer):
- Style syntax: `#[fg=colour214,bold]text#[default]`. 256-color palette is
  spelled `colour<n>`.
- A literal `#` in text must be escaped as `##` or tmux interprets it as a
  format directive.

**i3bar protocol** (prior art for shrinking): every block may carry a
`short_text` used when the bar overflows. HERALD adopts this as `short` on a
segment plus a numeric `priority` for drop order.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |
| Format | `npx biome format --write .` | exit 0 |

## Scope

**In scope**:
- `lib/style.mjs` (create) — roles, themes, color gates, paint
- `lib/segment.mjs` (create) — segment normalization + gauge role helper
- `lib/render.mjs` (create) — surface renderers + width fitting
- `test/style.test.mjs`, `test/segment.test.mjs`, `test/render.test.mjs` (create)

**Out of scope** (do NOT touch):
- `bin/herald` — no new verbs yet; Plan 005 wires rendering into the CLI.
- Config loading, presets, providers — Plans 003/004/006.
- Any network or filesystem access inside render code — rendering must stay
  pure (data in, string out) so it is trivially testable.

## Git workflow

- Branch: `advisor/002-render-core-theme`
- Conventional Commits, e.g. `feat(render): segment model, themes, ansi/tmux/plain renderers`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `lib/style.mjs` — roles, themes, gates

Implement and export:

```js
// Roles are semantic: presets never name colors, only roles. A theme maps
// role -> color code per depth. Port of token-oracle's colors.py doctrine.
export const ROLES = ['text', 'dim', 'accent', 'ok', 'notice', 'warn', 'crit']

// Built-in theme: token-oracle's palette (256-color codes).
export const THEMES = {
  oracle: {
    depth: 256,
    roles: { text: null, dim: '240', accent: '141', ok: '42', notice: '154', warn: '214', crit: '196' },
  },
  basic16: {
    depth: 16,
    roles: { text: null, dim: '90', accent: '35', ok: '32', notice: '92', warn: '33', crit: '31' },
  },
}

// gaugeRole(pct): the single source of truth for urgency coloring.
// >=120 crit, >=100 warn, >=85 notice, else ok  (token-oracle thresholds).
export const gaugeRole = (pct) => ...

// Two gates, per token-oracle:
//   pipeColor(env)          -> !('NO_COLOR' in env)            // adapter/piped output
//   ttyColor(env, stream)   -> NO_COLOR? false : FORCE_COLOR set&&!=''&&!='0'? true : stream.isTTY
export const pipeColor = (env = process.env) => ...
export const ttyColor = (env = process.env, stream = process.stdout) => ...

// paint(text, role, {theme, mode}) -> string
//   mode 'ansi'  : \x1b[38;5;<code>m text \x1b[0m   (256-depth theme)
//                  \x1b[<code>m text \x1b[0m         (16-depth theme)
//   mode 'tmux'  : #[fg=colour<code>]text#[default]  (16-depth: fg=<name-or-code>)
//   mode 'none'  : text unchanged
//   role 'text' or unknown role: text unchanged in every mode.
export const paint = (text, role, opts) => ...
```

Notes: no bold/italic attributes in v1 (add later via role variants); keep
the module pure (no reads of process.env except as defaulted parameters, so
tests inject their own).

**Verify**: `node --test test/style.test.mjs` → passes (write tests in Step 4
first if you prefer TDD; final gate is Step 4).

### Step 2: `lib/segment.mjs` — the segment contract

```js
// A segment is the unit of a status line. Normalized shape:
// {
//   id: string,          // stable identifier, e.g. 'oracle-5h'
//   text: string,        // full rendering
//   short: string|null,  // compact fallback when width is tight (i3bar short_text idea)
//   role: string,        // one of ROLES, default 'text'
//   priority: number,    // 0..100, higher survives longer; default 50
// }
export const normalize = (raw) => ...   // fills defaults, coerces text to string,
                                        // returns null for null/empty-text input
```

Segments with empty/whitespace-only `text` normalize to `null` and are
dropped — this is how providers "hide" a segment (fail-open: no data, no
segment, no error).

**Verify**: `node --test test/segment.test.mjs` → passes (after Step 4).

### Step 3: `lib/render.mjs` — compile segments per surface

```js
// render(segments, {surface, theme, color, width, separator}) -> string
//   surface: 'ansi' | 'tmux' | 'plain'
//   color:   boolean (caller computed via pipeColor/ttyColor)
//   width:   number|null — visible-character budget for ONE line (null = unlimited)
//   separator: default '  ' (two spaces — token-oracle's join)
export const render = (segments, opts) => ...
```

Behavior, in order:
1. Normalize + drop null segments.
2. **Escape** per surface *before* measuring: tmux → `#` becomes `##`;
   ansi/plain → text passes through.
3. **Fit to width** (when `width` is a number): measure *visible* length
   (segment texts + separators; color codes add zero — measure before
   painting). While over budget: (a) swap the lowest-priority segment that has
   a `short` to its short text; (b) if still over, drop the lowest-priority
   segment entirely; repeat. Ties break toward dropping the rightmost. Never
   truncate mid-text; never emit a partial escape sequence.
4. Paint each surviving segment with its role, join with separator.
5. Multi-line is the caller's concern: `render` produces one line. Callers
   pass arrays of segment-lists, one per line (Plan 005).

Also export `visibleLength(text)` — counts characters excluding nothing (input
is pre-paint), but do handle wide emoji conservatively: count code points, not
UTF-16 units (`[...text].length`).

**Verify**: `node --test test/render.test.mjs` → passes (after Step 4).

### Step 4: tests

Write `test/style.test.mjs`, `test/segment.test.mjs`, `test/render.test.mjs`
using node:test + assert/strict (model after `test/smoke.test.mjs`). Required
cases:

- `gaugeRole`: 84→ok, 85→notice, 100→warn, 120→crit (boundary values).
- `pipeColor`: `{}`→true, `{NO_COLOR:''}`→false. `ttyColor`: NO_COLOR beats
  FORCE_COLOR; `FORCE_COLOR:'0'`→falls back to isTTY; non-TTY stream→false.
- `paint`: ansi 256 produces `\x1b[38;5;214m`…`\x1b[0m`; tmux produces
  `#[fg=colour214]`…`#[default]`; mode none returns input; role 'text'
  returns input in all modes.
- Invariant test: for a sample segment list,
  `render(segs, {color:false, …})` equals `render(segs, {color:true, …})`
  with `/\x1b\[[0-9;]*m/g` stripped (ansi) and `/#\[[^\]]*\]/g` stripped (tmux).
- Escaping: tmux render of text `50#` contains `50##`; fitting measures the
  escaped text.
- Fitting: three segments (priorities 90/50/10, the 50 one has `short`);
  width forcing one swap → the 50 segment shows short text; width forcing
  more → priority-10 segment dropped first; generous width → identical to
  unfitted output. Emoji: `visibleLength('🕐 5h')` is 4.

**Verify**: `node --test` → all pass, ≥ 14 tests total.
`npx biome check .` → exit 0.

## Test plan

Covered in Step 4 (this plan is core logic; tests are the deliverable's
larger half). Structural pattern: `test/smoke.test.mjs` from Plan 001.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0; new test files exist and pass
- [ ] `npx biome check .` exits 0
- [ ] `grep -n "38;5;141" lib/style.mjs` → match (oracle violet present)
- [ ] `node -e "import('./lib/style.mjs').then(m=>console.log(m.gaugeRole(101)))"` → `warn`
- [ ] `node -e "import('./lib/render.mjs').then(m=>console.log(m.render([{id:'a',text:'hi',role:'warn'}],{surface:'tmux',color:true})))"` → `#[fg=colour214]hi#[default]`
- [ ] No runtime dependencies added (`node -e "const p=require('./package.json');process.exit(p.dependencies?1:0)"` → exit 0)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001's rails are absent (no `bin/herald`, `node --test` fails at start).
- You find yourself needing a dependency (chalk, string-width, etc.) — the
  zero-dep stance is a hard constraint; report the gap instead.
- Width fitting turns out to need terminal-cell-accurate emoji width to pass
  tests — the conservative code-point count is the accepted v1 tradeoff; if a
  test you wrote demands more, weaken the test, not the constraint. If that
  feels wrong, STOP and report.

## Maintenance notes

- `gaugeRole` thresholds intentionally mirror token-oracle
  (`gauge_tier`, `cli/colors.py:58-66`). If oracle ever changes its tiers,
  HERALD should follow — note the pairing in a code comment.
- The 16-color theme uses standard SGR codes so it degrades on ancient
  terminals; a truecolor theme is a natural later addition (role → `#rrggbb`,
  tmux spells it `fg=#rrggbb`).
- Reviewers: scrutinize the fit-then-paint ordering — painting before
  measuring is the classic bug that makes width fitting overcount.
- Deferred: bold/italic style attributes; right-alignment groups; per-segment
  separators. All are additive to the segment shape.

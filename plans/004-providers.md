# Plan 004: Provider layer — data sources that feed segments, fail-open

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Plans 001 and 003 must be DONE — verify
> `lib/config.mjs` and `lib/paths.mjs` exist and `node --test` exits 0. If
> `lib/providers/` already exists, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (subprocess execution + caching — the two classic
  status-bar failure sources: hangs and flicker)
- **Depends on**: plans/001-bootstrap-repo.md, plans/003-config-projects-presets.md
- **Category**: direction
- **Planned at**: greenfield; data contracts sourced from token-oracle @
  `ada32e9` (`snapshot/writer.py`, `ADAPTERS.md`) and agentic-sage @ `cffd055`
  (`lib/asking.mjs`), 2026-07-02

## Why this matters

Segments need data: token forecasts, sage consult activity, git branch,
quotes. The prior art is unanimous about the right shape — starship custom
modules and zjstatus `command`/`pipe` widgets both converged on "run a
command or read a file, on an interval, with a timeout, cache the result,
and show nothing on failure". tmux-powerline's best-known failure mode is a
slow segment freezing the whole bar. This plan builds that contract once:
five small providers with hard timeouts, interval caching in the XDG state
dir, and a hide-on-failure guarantee, so no preset can ever hang or break a
host's status line.

## Current state

After Plans 001+003: CLI skeleton, `lib/paths.mjs` (has `stateDir(env, home)`),
`lib/config.mjs`, `lib/project.mjs`. No provider code.

**External data contracts HERALD consumes** (inlined; the executor must not
guess these):

**token-oracle `forecast.json`** — written atomically by `oracle snapshot` to
`${XDG_DATA_HOME:-~/.local/share}/token-oracle/forecast.json`. Exact shape
(schema constant `SCHEMA_VERSION = 1`, fields from the `Forecast` dataclass,
`core/contracts.py:24-32`):

```json
{
  "schema": 1,
  "generated_at": 1751450000.0,
  "windows": [
    {
      "window": "5h",
      "used": 45000,
      "cap": 220000,
      "projected_pct": 21.4,
      "eta_to_cap_secs": null,
      "reset_in_secs": 13320.0,
      "idle": false,
      "confidence": 1.0
    }
  ]
}
```

`eta_to_cap_secs` is float-or-null; `idle: true` windows are conventionally
skipped in status lines (oracle's own adapter does). Freshness: the file is
only as fresh as the user's `oracle snapshot` cron; consumers must compare
`generated_at` (epoch seconds) to now.

**agentic-sage "asking" breadcrumb** — flat per-session file
`~/.claude/agentic-sage/asking/<session_id>` (legacy fallback path
`~/.claude/sage/asking/<session_id>`). Body = consult verb name; **mtime =
last consult time**. Convention: show an indicator while
`now - mtime < ttlMs` (sage's default TTL is 8000 ms, config key
`statuslineTtlMs`, label default `⚖️ Asking Sage`). Files are keyed by Claude
Code `session_id` only.

**Provider spec shape** (this plan defines it; presets in Plan 006 write it):
a segment in a preset names a provider and its options:

```json
{
  "id": "oracle-5h",
  "provider": "json-file",
  "options": { "path": "${XDG_DATA_HOME:-~/.local/share}/token-oracle/forecast.json", "maxAgeSecs": 900 },
  "format": "🕐 {reset_hms} {used_k}/{cap_k} →{pct}%",
  "role": "gauge:pct",
  "priority": 80
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |

## Scope

**In scope**:
- `lib/providers/index.mjs` (create) — registry + `provide(spec, ctx)` dispatcher
- `lib/providers/json-file.mjs`, `file-age.mjs`, `command.mjs`, `static.mjs`,
  `claude-context.mjs` (create)
- `lib/cache.mjs` (create) — interval cache in `stateDir()`
- `lib/format.mjs` (create) — `{var}` template interpolation + tiny formatters
- `test/providers.test.mjs`, `test/format.test.mjs`, `test/cache.test.mjs` (create)

**Out of scope** (do NOT touch):
- Preset files and which segments use which provider — Plan 006.
- CLI verbs / stdin reading (the claude-context provider only *transforms* a
  payload object handed to it; Plan 005 does the actual stdin read).
- `lib/render.mjs`, `lib/style.mjs` — providers return variables, never
  styled text.

## Git workflow

- Branch: `advisor/004-providers`
- Conventional Commits, e.g. `feat(providers): json-file, file-age, command, static, claude-context`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `lib/format.mjs`

```js
// interpolate('{a} of {b}', {a:1, b:2}) -> '1 of 2'
//   unknown var -> interpolation FAILS: return null (segment hides rather
//   than rendering a literal '{pct}' — fail-open doctrine).
export const interpolate = (template, vars) => ...

// Formatters providers use to precompute friendly variables:
export const fmtK = (n) => ...      // 45000 -> '45k', 8000000 -> '8.0M', <1000 -> String(n)
export const fmtHms = (secs) => ... // 13320 -> '3:42' (h:mm), <1h -> '42m'
export const fmtDh = (secs) => ...  // 498000 -> '5d 18h', <1d -> '18h'
```

**Verify**: `node --test test/format.test.mjs` → passes (tests Step 5).

### Step 2: `lib/cache.mjs`

```js
// Interval cache: cached(key, ttlMs, computeFn, {env, home, now}) -> value|null
// Stores JSON blobs under stateDir()/cache/<sha1(key)>.json as
// {at: epochMs, value}. Fresh -> cached value, no compute. Stale/missing ->
// compute; on compute success write-through (atomic rename, best effort);
// on compute THROW or null -> return stale value if present (serve-stale),
// else null. Never throws.
export const cached = (key, ttlMs, computeFn, opts) => ...
```

Serve-stale-on-failure is deliberate: a transient git/command failure must
not blank a segment that showed data one tick ago (tmux-powerline flicker
lesson).

**Verify**: `node --test test/cache.test.mjs` → passes.

### Step 3: the five providers

Common contract (`lib/providers/index.mjs`):

```js
// provide(spec, ctx) -> vars object | null   — NEVER throws.
// ctx = { env, home, cwd, now, payload }  (payload: parsed Claude stdin JSON or {})
// null means "hide this segment". Unknown provider name -> null.
export const provide = (spec, ctx) => ...
```

- **json-file** (`options: {path, maxAgeSecs?}`): expand leading `~` and
  `${VAR:-default}` env patterns in `path`; read+parse JSON; if `maxAgeSecs`
  set and the object has numeric `generated_at`, hide when
  `now/1000 - generated_at > maxAgeSecs` (fall back to file mtime when the
  field is absent). Return the parsed object flattened one level with
  dot-paths available to `pick` later — simplest correct v1: return
  `{json: <parsed>}` plus a `pick(obj, 'windows.0.projected_pct')` helper
  exported from the module, and let the *preset adapter functions* in Plan
  006 map JSON to vars. To keep this plan self-sufficient, also implement
  `options.fields: {pct: "windows.0.projected_pct", ...}` → returns those
  picked vars directly.
- **file-age** (`options: {path, ttlMs, glob?: boolean}`): stat the path
  (or, with `glob: true`, every direct child of the dirname matching the
  basename pattern `*` only — no full glob engine). Vars:
  `{present: bool, age_ms: number|null, fresh: bool, fresh_count: number}`
  where fresh = `age_ms < ttlMs`. Missing path → `{present:false, fresh:false,
  fresh_count:0, age_ms:null}` (NOT null — presets decide to hide via
  `when`, see Step 4).
- **command** (`options: {command, args?, intervalSecs=10, timeoutMs=1500}`):
  `execFileSync(command, args)` with `timeout: timeoutMs`, `stdio: ['ignore',
  'pipe', 'ignore']`, wrapped in `cached()` with key
  `cmd:${command} ${args}:${cwd}` and ttl `intervalSecs*1000`. Vars:
  `{stdout: firstLineTrimmed, exit: 0}`; failure → cached stale or null.
  No `sh -c` — args array only (no shell injection surface).
- **static** (`options: {values: [...], rotate: 'hour'|'day'|'render'}`):
  vars `{value: values[index]}` where index = `floor(now/3600e3) % len`
  (hour), `floor(now/86400e3) % len` (day), or `randomInt(len)` (render).
- **claude-context** (`options: {}`): flattens `ctx.payload` into friendly
  vars: `model` (model.display_name), `dir` (basename of
  workspace.current_dir), `project_dir`, `ctx_pct`
  (context_window.used_percentage rounded), `cost_usd`
  (cost.total_cost_usd, 2 decimals), `session_name`, `branch` — branch comes
  from a `command` fallback ONLY in presets, not here; this provider never
  execs. Absent payload fields → the var is simply absent (interpolation
  then fails → segment hides).

### Step 4: `when` guard on specs

In `lib/providers/index.mjs`, after computing vars, apply an optional
`spec.when` string of the restricted form `"<var>"` (truthy check) or
`"<var><op><number>"` with op in `>=`, `<=`, `>`, `<`, `==` (e.g.
`"pct>=85"`, `"fresh"`). Failing guard → null. No eval — hand-parse with one
regex: `/^(\w+)\s*(>=|<=|==|>|<)?\s*(-?\d+(?:\.\d+)?)?$/`.

**Verify** (Steps 3–4 together): `node --test test/providers.test.mjs` → passes.

### Step 5: tests

`test/format.test.mjs`: interpolate happy/missing-var→null; fmtK boundaries
(999, 1000, 8_000_000); fmtHms/fmtDh samples from the contracts above.
`test/cache.test.mjs`: fresh hit skips compute (count calls); stale recompute;
serve-stale when compute throws; corrupt cache file → recompute (no throw).
`test/providers.test.mjs`, all hermetic under a temp home/state dir:
- json-file: reads a fixture forecast.json (copy the exact JSON from
  "Current state" into `test/fixtures/forecast.json`); `fields` picking works
  (`windows.0.projected_pct` → 21.4); `maxAgeSecs` hides stale
  (`generated_at` old vs injected `now`); missing file → null; `~` and
  `${XDG_DATA_HOME:-...}` expansion.
- file-age: fresh/stale/missing via touched temp files; glob fresh_count
  counts only fresh files.
- command: echoes via `execFileSync('printf', ['hi'])`-style fixture; timeout
  path returns null-or-stale (use `sleep` with tiny timeoutMs); result cached
  (second call within interval does not re-exec — assert via a counter file).
- static: hour rotation deterministic for a fixed `now`; render rotation
  within bounds.
- claude-context: full payload fixture → all vars; empty payload → `{}`.
- when-guard: `pct>=85` filters correctly both sides; `fresh` truthy check;
  malformed guard → null (fail closed).

**Verify**: `node --test` → all pass; `npx biome check .` → exit 0.

## Test plan

Covered in Step 5 — fixtures under `test/fixtures/`, hermetic temp dirs,
injected `{env, home, now, payload}`. Pattern: Plan 003's tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0; three new test files pass
- [ ] `npx biome check .` exits 0
- [ ] `test/fixtures/forecast.json` exists and matches the schema-1 shape above
- [ ] `grep -rn "sh -c\|exec(" lib/providers/` → no matches (no shell eval)
- [ ] `grep -n "serve-stale\|stale" lib/cache.mjs` → at least one match (the
      contract is documented in a comment)
- [ ] No runtime dependencies added
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- You need async providers (the render path in Plan 005 is synchronous by
  design — hosts give ~a few hundred ms). If a provider genuinely cannot be
  sync, STOP; do not convert the pipeline to async on your own.
- The `when` mini-grammar grows beyond the single regex — that's scope creep
  toward an expression language; report the use case instead.
- Real forecast.json on this machine differs from the schema above (check
  `~/.local/share/token-oracle/forecast.json` if present) — the contract may
  have moved; report the diff.

## Maintenance notes

- token-oracle plan 017 (TODO in that repo) will add cost fields to
  forecast.json windows (a schema bump). The json-file provider needs no
  change — presets will just pick new fields — but the `oracle-alerts`
  preset (Plan 006) documents the gate.
- The command provider's no-shell stance means pipelines need a wrapper
  script; that's intentional (injection surface). Reviewers: reject any
  `sh -c` addition.
- glob support is deliberately a poor-man's `*` on basename; if a real need
  for `**` appears, revisit — don't grow it silently.
- `static` render-rotation uses `Math.random` — fine in repo code (only
  Workflow orchestration scripts forbid it).

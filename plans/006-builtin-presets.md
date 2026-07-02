# Plan 006: Built-in presets — oracle forecast/alerts, sage session/judge, stoic, default

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Plans 001–005 must be DONE. Verify
> `./bin/herald render --surface plain` exits 0 and `lib/pipeline.mjs`
> exports `FALLBACK_PRESET`. If a `presets/` directory already exists, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001, 002, 003, 004, 005
- **Category**: direction
- **Planned at**: greenfield; preset content mirrors token-oracle @ `ada32e9`
  (`adapters/statusline.py`, `adapters/tmux.py`) and agentic-sage @ `cffd055`
  (`lib/asking.mjs`, statusline snippet), 2026-07-02

## Why this matters

Presets are the product. The operator named five launch presets: Token
Oracle forecast, Token Oracle money/cap alerts, Agentic Sage session info,
a tmux-side sage fleet view, and a stoic-quote bar. Each is a small JSON
file — proof that HERALD's segment/provider convention covers real cases,
and the template users copy to write their own. This plan ships them, adds
preset-file loading (replacing Plan 005's hard-coded fallback), and locks
their rendered output with snapshot-style tests.

## Current state

After Plan 005: `herald render` works end-to-end but always uses
`FALLBACK_PRESET` (`lib/pipeline.mjs`); preset *names* already resolve via
config (`resolvePresetName`). Providers available (Plan 004): `json-file`
(with `fields` dot-path picking, `maxAgeSecs` staleness), `file-age`
(`present/fresh/fresh_count/age_ms`, poor-man glob), `command` (cached,
timeout), `static` (hour/day/render rotation), `claude-context` (payload
vars: `model`, `dir`, `ctx_pct`, `cost_usd`, `session_name`, …). Formatters:
`fmtK`, `fmtHms`, `fmtDh`. `when` guards: `"pct>=85"` style.

**What the source tools render today** (targets to reproduce):

- token-oracle statusline (`adapters/statusline.py:8-13`): per active window
  `🕐 3:42 45k/220k →21%`, gauge-colored by projected pct, plus
  `⚠ cap 5 days 18 hours` appended when `eta_to_cap_secs` is set; idle
  windows skipped; segments joined by two spaces.
- token-oracle tmux adapter: same data, `->` instead of `→`, tmux colors,
  single-space join.
- sage statusline segment: the literal label `⚖️ Asking Sage` shown only
  while the per-session breadcrumb file
  `~/.claude/agentic-sage/asking/<session_id>` is younger than 8000 ms.
- **Money alerts caveat**: token-oracle has NO cost fields yet (its plan 017
  is TODO). forecast.json schema 1 windows carry:
  `window, used, cap, projected_pct, eta_to_cap_secs, reset_in_secs, idle,
  confidence`. So `oracle-alerts` v1 alerts on **projected_pct thresholds and
  time-to-cap** — the money line lights up in a future revision once oracle
  ships cost fields (documented in the preset file as a comment field).

**Preset file format** (defined here, consumed by the loader):

```json
{
  "$schema": "https://raw.githubusercontent.com/muslewski/status-herald/main/presets/schema.json",
  "name": "oracle-forecast",
  "description": "token-oracle burn forecast per rate window",
  "comment": "optional free text",
  "separator": "  ",
  "lines": [ { "surfaces": ["claude-code", "tmux", "plain"], "segments": [ ...specs ] } ]
}
```

`lines[].surfaces` (optional, default all) lets one preset render differently
per surface — a line is skipped on surfaces not listed.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |
| Smoke | `./bin/herald render --surface plain --preset stoic` | one quote line |

## Scope

**In scope**:
- `presets/*.json` (create): `default.json`, `oracle-forecast.json`,
  `oracle-alerts.json`, `sage-session.json`, `sage-judge.json`, `stoic.json`
- `lib/presets.mjs` (create) — loader: built-in dir → user XDG presets dir
  override → FALLBACK_PRESET
- `lib/pipeline.mjs` (extend) — honor `lines[].surfaces`
- `bin/herald` (extend) — `herald presets` verb (list name + description +
  source builtin/user)
- `test/presets.test.mjs` (create), fixtures under `test/fixtures/`

**Out of scope** (do NOT touch):
- `herald menu` (Plan 007), identity segments (Plan 008).
- Any change to token-oracle or agentic-sage themselves — presets only READ
  their published files.
- Cost/money rendering — schema-gated future (see caveat above); do not
  invent cost fields.

## Git workflow

- Branch: `advisor/006-builtin-presets`
- Conventional Commits, e.g. `feat(presets): six built-in presets + loader`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `lib/presets.mjs` loader

```js
// loadPreset(name, {env, home}) -> preset object
// Resolution: userPresetsDir()/<name>.json  >  <pkg>/presets/<name>.json
//   > FALLBACK_PRESET (with an issue recorded on the returned object:
//   preset.issues = ['preset <name> not found, using default']).
// Malformed preset JSON -> next candidate in the chain (fail-soft).
// listPresets({env, home}) -> [{name, description, source}]  (deduped,
//   user overrides shadow built-ins of the same name)
```

Wire into `herald render` (replace the always-FALLBACK behavior from Plan
005) and add the `herald presets` verb.

**Verify**: `./bin/herald presets` → six built-ins listed.

### Step 2: `default.json`

Port FALLBACK_PRESET to a file and extend: line 1 (claude-code only):
model · dir · ctx% gauge (as in Plan 005); add a `cost_usd` segment
(`format: '${cost_usd}'`, role `dim`, priority 40, `when: 'cost_usd'`).
Line 2 (tmux/plain): a `command` segment for the git branch:
`{command: 'git', args: ['rev-parse','--abbrev-ref','HEAD'], intervalSecs: 10}`,
format `⎇ {stdout}`, role `dim`.

### Step 3: `oracle-forecast.json`

One line, all surfaces. Segments (window 0 = 5h, window 1 = weekly — index
into forecast.json):

```json
{
  "id": "oracle-5h",
  "provider": "json-file",
  "options": {
    "path": "${XDG_DATA_HOME:-~/.local/share}/token-oracle/forecast.json",
    "maxAgeSecs": 900,
    "fields": {
      "pct": "windows.0.projected_pct", "used": "windows.0.used",
      "cap": "windows.0.cap", "reset": "windows.0.reset_in_secs",
      "idle": "windows.0.idle"
    }
  },
  "when": "idle==0",
  "format": "🕐 {reset_hms} {used_k}/{cap_k} →{pct_r}%",
  "role": "gauge:pct",
  "priority": 85,
  "short": "🕐 {pct_r}%"
}
```

This needs derived vars (`reset_hms`, `used_k`, `cap_k`, `pct_r` rounded).
Add a small post-processing step in the json-file provider: for every picked
numeric field `x`, also emit `x_k` (fmtK), `x_hms` (fmtHms), `x_dh` (fmtDh),
`x_r` (Math.round). Cheap, generic, keeps templates declarative. Second
segment `oracle-weekly` identical with `windows.1.*`, priority 60, plus a
third segment `oracle-cap-eta`: fields from `windows.0.eta_to_cap_secs`,
`when: 'eta'` (truthy — null hides), format `⚠ cap {eta_dh}`, role `crit`,
priority 95.

Note in the preset's `comment`: requires `oracle snapshot` on a cron; stale
file (>15 min) hides the segments (maxAgeSecs).

### Step 4: `oracle-alerts.json`

Quiet-by-default alerting: same json-file options, but every segment has a
threshold guard — `when: "pct>=85"` (role `gauge:pct`, format
`🔮 {window_label}: {pct_r}% of cap`), and the cap-ETA segment from Step 3 at
priority 99. Nothing renders while usage is healthy — that's the point.
`comment` field: "money/cost alerts activate when token-oracle ships cost
fields in forecast.json (oracle plan 017); add a segment picking
windows.N.cost_usd then."

### Step 5: `sage-session.json`

Line (claude-code): segments `session` (claude-context, format
`{session_name}`, `when: 'session_name'`, role accent, priority 70) and
`sage-asking` (file-age provider,
`options: {path: '~/.claude/agentic-sage/asking/{session_id}', ttlMs: 8000}`,
`when: 'fresh'`, format `⚖️ Asking Sage`, role `notice`, priority 95).

The `{session_id}` placeholder in a provider `path` must be interpolated
from ctx.payload before stat — add that one substitution to the file-age
provider (payload vars only, no env). On tmux (no payload) the path keeps
the placeholder, stat fails, `fresh:false` → hidden. Correct fail-open.

### Step 6: `sage-judge.json`

tmux-only line. Segment `fleet-consulting`: file-age with
`options: {path: '~/.claude/agentic-sage/asking/*', glob: true, ttlMs: 8000}`,
`when: 'fresh_count>=1'`, format `⚖️ {fresh_count} consulting`, role
`notice`, priority 90. Segment `fleet-hint`: static provider, values
`["prefix+j fleet board"]`, rotate `day`, role `dim`, priority 20 — a
standing reminder that agentic-sage's fleet board popup is on `bind j`
(sage wires that keybinding itself; HERALD only advertises it).

### Step 7: `stoic.json`

All surfaces, one segment: static provider, `rotate: 'hour'`, role `dim`,
format `{value}`, priority 50, values = an array of exactly 30 short stoic
quotes with attributions (Marcus Aurelius, Seneca, Epictetus — write them
out, ≤70 chars each, e.g. `"You have power over your mind — not outside
events. — Marcus Aurelius"`). Keep every quote ASCII-safe apart from the
em-dash.

### Step 8: tests

`test/presets.test.mjs`:
- Every `presets/*.json` parses, has unique `name` matching its filename,
  and every segment spec passes a shape check (id/provider/format present,
  role valid or `gauge:*`, priority number).
- Loader chain: user preset shadows built-in (temp XDG dir with an
  override); unknown name → fallback + issue; malformed user preset falls
  through to built-in.
- Rendered snapshots with fixtures and injected `now`:
  - oracle-forecast + `test/fixtures/forecast.json` (from Plan 004) →
    plain-surface output equals
    `🕐 3:42 45k/220k →21%` (verify exact string; weekly window per fixture);
    fixture with `eta_to_cap_secs: 498000` → output contains `⚠ cap 5d 18h`.
  - oracle-alerts + healthy fixture (pct 21) → empty output; pct 101 fixture
    → one warn-colored segment on ansi surface.
  - sage-session: touched breadcrumb file (age 0) + payload with session_id
    → contains `⚖️ Asking Sage`; 10-s-old file → empty.
  - sage-judge: two fresh breadcrumbs in temp dir → `⚖️ 2 consulting`.
  - stoic: fixed `now` → deterministic quote; 30 values exactly.
- `lines[].surfaces` honored: a claude-code-only line absent from tmux
  output.

**Verify**: `node --test` → all pass; `npx biome check .` → exit 0.

## Test plan

Covered in Step 8 — snapshot-style exact-string assertions on plain surface,
role assertions on ansi surface. Fixtures: forecast.json variants (healthy,
hot, with-eta), breadcrumb temp files, Claude payload.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0; preset tests pass
- [ ] `npx biome check .` exits 0
- [ ] `./bin/herald presets` lists 6 presets, exit 0
- [ ] `ls presets/*.json | wc -l` → 6
- [ ] `node -e "const q=require('./presets/stoic.json').lines[0].segments[0].options.values; process.exit(q.length===30?0:1)"` → exit 0
- [ ] `grep -l "cost_usd" presets/oracle-alerts.json` → no match in a
      SEGMENT spec (only in the `comment` string) — money is schema-gated
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Provider capabilities from Plan 004 are missing something a preset needs
  beyond the two named extensions (derived `_k/_hms/_dh/_r` vars; `{session_id}`
  path substitution) — a third extension means the contract was mis-scoped;
  report it.
- Real forecast.json on this machine has a different `windows` order than
  [5h, weekly] — the index-based picking assumption breaks; report and
  propose name-based window lookup instead.
- You cannot produce 30 quotes ≤70 chars without inventing attributions —
  trim the count and report, do not fabricate sources.

## Maintenance notes

- Window picking is positional (`windows.0`); token-oracle guarantees no
  ordering contract. If oracle ever reorders, switch json-file `fields` to a
  matcher syntax (`windows[window=5h].used`). Known accepted risk, recorded
  here.
- When token-oracle plan 017 lands (cost fields, `pro`/`max5`/`max20`
  presets), extend `oracle-alerts.json` with a money segment and bump its
  description. When oracle plan 012 lands (real `confidence` values), a
  low-confidence dim marker becomes possible.
- The `presets/schema.json` referenced by `$schema` doesn't exist yet —
  Plan 009 decides whether to publish one; the key is inert until then.
- Reviewers: presets are user-facing API. Names, ids, and field choices are
  hard to change after adoption.

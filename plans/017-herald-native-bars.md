# Plan 017: Herald-native status bars — program spec (Slice 2)

> **This is an umbrella SPEC, not a single executable plan.** It records the
> architecture, the load-bearing decisions, the cross-process contracts, and
> the decomposition into five executable sub-plans (018–022). Each sub-plan
> gets its own dense `-plan.md` (TDD, verbatim code) when it is dispatched.
> Design produced by fusion (Opus advisor + isolated Grok xhigh consult,
> 2026-07-13); the two positions converged independently on the token_forecast
> boundary, the staged reversible cutover, and the `/proc`-descendant Grok
> detection, which raised confidence on those three.

## Status

- **Priority**: P1
- **Effort**: XL (program; five sub-plans)
- **Risk**: HIGH — the bar drives ~15 LIVE tmux sessions right now. A bad
  cutover blanks every session's status bar simultaneously. Cutover
  (Plan 021) is the high-risk step; 018–020 are additive and touch nothing
  live.
- **Depends on**: the curtain subsystem (shipped: 013 IN PROGRESS, 014 DONE,
  016 SPEC). Supersedes the never-built engine design in Plans 002/004/005 —
  see "Relationship to Plans 002–006".
- **Category**: direction
- **Planned at**: 2026-07-13, fusion consult
  `scratchpad/grok-slice2-out.md`.

## Why this matters

Today HERALD renders **only** the curtain card. The two status bars the
operator calls "our tmux bar" and "our Claude bar" are **Python** in
`~/.claude` — `session-sync.py` (tmux) + `statusline-context.py` (Claude),
sharing `claude_sessions.py`. HERALD's founding premise (README, Plan 013 "IN
PROGRESS") is to absorb these into herald as native, configurable surfaces.

The operator's requirements (2026-07-13) crystallize what "configurable" must
mean, and add two features the Python bars never had:

1. **Segment model with priority** — when the terminal narrows, drop
   low-value segments (clock, account) before high-value ones (per-session
   context). Context disappearing on a narrow client is the operator's core
   complaint.
2. **Per-segment toggles** — hide account gauges, show model + effort, hide
   the Claude bar entirely; defaults reproduce today's exact look so existing
   users are unaffected ("some user will get what we have now").
3. **Model + effort badge** — `Opus 🧠xhigh` per window; Grok windows labelled
   `Grok xhigh` via process detection (a data source the Claude-only Python
   never had).
4. **State-synced animated bar background** (Plan 022) — the curtain state
   machine (working/done/compacting) drives a whole-bar breathing wash: idle
   transparent, working flows, done pulses ~3 s then fades. Same visual
   language as the curtain card (Plan 016), now in the bar.

An interim Python config already ships the operator's personal preferences
today (`~/.claude/herald-bar.conf`: `ACCOUNT`/`MODEL`/`CLAUDE_BAR`, plus a
`~/.claude/session-meta/<sid>.json` effort sidecar and `_curtain` hidden from
the window list). Slice 2 makes that real: herald owns it, tested, configured
through herald's own config, and the two Python scripts are retired.

## Relationship to Plans 002–006

Plans 002/003/004/005/006 designed a generic engine (segment model, provider
layer, preset marketplace, safe wiring, doctor) but were **never built** — the
repo shipped the curtain ad-hoc around a minimal `config.mjs` + `render.mjs`.
This program **harvests** 005's genuinely valuable parts and **drops** its
speculative generality:

**Harvested (build these):**
- Segment shape with `priority` + `short` variant (005 Step 2) — that *is* the
  width-drop.
- Semantic roles (`ok/notice/warn/crit/accent/dim`) → colors per surface, and
  gauge thresholds `85/100/120` (README design decision).
- Safe wiring: `.bak` backup, **abort-on-foreign** (never clobber a user's
  custom `statusLine`/`status-right`), exact-marker tmux block (005 Step 4).
- Fail-open everywhere: empty output + exit 0 (README design decision).
- `herald doctor` / a `status doctor` contract-checker (005 Step 5).

**Dropped for v1 (YAGNI — DECISION 1):** 005's generic
`provide(spec,ctx) → interpolate(format,vars)` provider/preset/interpolation
engine. The operator needs a *fixed set of toggleable segments*, not a preset
marketplace. So v1 uses a **direct segment registry** —
`{ id, enabled, priority, order, render(ctx) }` — with config toggles. If users
later demand custom segments, the generic provider layer can be reintroduced
behind the same segment interface. This removes a large, speculative subsystem
from the critical path.

## Load-bearing decisions

**DECISION 1 — direct segment registry, not a provider/preset engine.**
(Above.) Each segment is a small module with a pure `render(ctx)` returning
`{ text, short?, role, priority }`; enable/order/priority come from config.

**DECISION 2 — token_forecast stays an external black box; feed via a thin
exec-hook, never a Node reimplementation.** The account 5h/weekly numbers come
from the operator's separate `token_forecast` project (server-truth Anthropic
rate limits + burn-rate engine) plus `usage_limits.py` (owned elsewhere,
uneditable). The current Claude statusline is the *writer* of rate-limit
snapshots (`RL.ingest` + `capture.append_snapshot`) and the tmux bar is a
*reader* of derived numbers. Getting the snapshot shape one byte wrong
**silently freezes** the operator's forecasting. Therefore:
- **Read path:** herald reads the already-computed 5h/weekly numbers from the
  stable artifact `token_forecast`/`usage_blocks` publishes. Opaque input.
- **Write/feed path:** herald execs a *tiny* Python ingest entrypoint (a
  user-configurable command, default best-effort/no-op) to perform the
  snapshot ingest — it does NOT reimplement the append shape in Node.
- herald **core stays zero-runtime-dep**; the forecasting bridge is an optional
  exec hook that no-ops cleanly when absent. The two **bar** scripts still die;
  `token_forecast` remains its own project.

**DECISION 3 — whole-bar breathing background (Plan 022), not a spatial
gradient.** `status-style bg` is a single color for the whole bar (including
the window list); a spatial `#[bg=]` gradient could only cover herald's
status-left/right regions, leaving a window-list gap. v1 sets `status-style bg`
per tick at **session scope** (each client sees its own session's state):
idle = transparent, working = slow hue flow, done = pulse fading over ~3 s,
compacting = its own wash. Frame rate is capped at `status-interval` (≥1 s;
no daemon — 005 rejected daemons), so the animation is a slow flow by design.

**DECISION 4 — side-effects are global and cannot be canaried.** `tmux-status`
writes `@ctxbar`/`@model`/`@state` + window rename/color for **all** live
sessions on every invocation. The instant one session's `status-right` points
at herald, herald owns the hidden state for all 15. Only the **stdout**
(right-side string) is per-session canaryable. Cutover therefore uses a
"herald owns side-effects" **lock file** so the Python no-ops itself once
herald is live, plus a fail-open wrapper at the call site.

**DECISION 5 — two-layer width handling.** (a) Order segments lowest-priority
(left) → highest (right) in `status-right` so tmux's native left-truncation
drops clock/account before context. (b) Additionally, herald drops
lowest-priority segments internally using `min(client_width)` from
`tmux list-clients` (default 100–120 if none). Never trust
`display-message '#{client_width}'` inside `#(...)` — the client context is not
guaranteed. Narrowest attached client wins; document the multi-client
compromise.

## Module layout (herald stays zero-dep)

New `lib/status/` subtree (Grok-proposed, adopted):

| Module | Responsibility |
|---|---|
| `lib/status/segments.mjs` | Declarative segment registry `{id, enabled, priority, order, render(ctx)}`. Pure. |
| `lib/status/compute.mjs` | Port of session discovery, transcript token/context math, message counting, `@ctxbar` construction, model/state glyphs, effort lookup. Returns structured per-session + global data. Calls the grok adapter. |
| `lib/status/bridge-token-forecast.mjs` | `readAccountUsage()` (read published cache) + `feedSnapshot(data)` (exec thin Python ingest hook). No forecasting logic. |
| `lib/status/grok-adapter.mjs` | `/proc` descendant walk from `pane_pid`, grok argv detection, `--effort` extraction, `Grok <effort>` label. |
| `lib/status/side-effects.mjs` | Writes window names, colors, `@ctxbar` (window + SESSION mirror), `@model`, `@state`, and (Plan 022) `status-style bg`. Shared by surfaces. |
| `lib/status/tmux-status.mjs` | Orchestrates compute + bridge + grok + side-effects + priority assembly + stdout (account gauges). Respects segment config. |
| `lib/status/claude-statusline.mjs` | Reads stdin JSON; writes effort sidecar + feeds snapshot; renders the Claude bottom bar from the same segment model; honors the hide/silent-capture toggle. |
| `lib/status/background.mjs` | (Plan 022) state → breathing-wash palette + phase-from-wall-clock → `status-style bg` color for this tick. |
| `lib/config.mjs` (extend) | Segment model config (see below) merged from `~/.config/status-herald/config.json`. Defaults reproduce today. |
| `lib/cli.mjs` (extend) | `render --surface tmux-status|claude-statusline`, `status doctor`. |

The segment registry is the single source of truth for ordering, enabling,
priority. Both surfaces consult it; `tmux-status` additionally performs the
global side-effects the old `session-sync.py` did.

## Config segment model

Merge-friendly (per-segment overrides, not a whole-array replace):

```jsonc
{
  "bars": {
    "tmux":   { "enabled": true,  "background": { "animated": true, "doneFlashSec": 3 } },
    "claude": { "enabled": false, "silentCapture": true },   // operator: hidden, still captures effort
    "segments": {
      "context":       { "enabled": true,  "priority": 100 },
      "model":         { "enabled": true,  "priority": 60 },
      "state":         { "enabled": true,  "priority": 90 },
      "account5h":     { "enabled": false, "priority": 30 },
      "accountWeekly": { "enabled": false, "priority": 20 },
      "clock":         { "enabled": true,  "priority": 10 },
      "notify":        { "enabled": true,  "priority": 40 }
    }
  }
}
```

`DEFAULTS.bars` reproduces **today's** look (account on, model off, Claude bar
on) so an absent config is a no-op for existing users; the operator's own
config supplies their preferences. This formalizes and supersedes the interim
`~/.claude/herald-bar.conf`.

## Parity anchors (extract from the Python BEFORE coding)

The highest-leverage work is reproducing contracts exactly. Executors of 018–020
MUST read the live Python and pin these; one character off and the operator
notices immediately (Grok risk list):

- **Effort sidecar**: `~/.claude/session-meta/<sessionId>.json` =
  `{ "model": <display_name>, "effort": <level> }` (atomic write). Already
  created by the interim statusline patch.
- **Rate-limit snapshot shape + location**: whatever `token_forecast`'s
  `RL.ingest(rate_limits)` + `capture.append_snapshot(data, now)` consume —
  pin the exact call, delegate via exec-hook.
- **Published account artifact**: the cache `usage_limits`/`token_forecast`
  writes that `claude_sessions.usage_blocks()` reads (path + JSON shape).
- **"Live session" predicate**: `claude_sessions.live_sessions()` = scan
  `~/.claude/sessions/*.json`, keep those whose `pid` is alive.
- **Context/token math**: `latest_used` (input + cache_read + cache_creation),
  `model_window` (1M vs 200k table), `count_messages` (human msgs, reset on
  `compact_boundary`).
- **Exact visible strings**: `_ctx_segment` (emoji band per 100k + colored bar
  + `pct% used/win 💬 n`), account `_slider`, tmux `#[fg=...]` styling, the
  `▶/⏸` state glyph, `@ctx` bucket colors (`green/orange/red/colour201`).
- **Side-effect scope**: `@ctxbar` written at BOTH window and SESSION scope
  (the covered-curtain case depends on the session mirror). `@model`/`@state`
  window-scoped. Window renamed to the tmux **session name** (operator renames
  via `prefix + $`), NOT the Claude label.
- **Ppid walk**: port `window_for` (climb ≤4 parents) but read
  `/proc/<pid>/status` `PPid:` — NOT `/proc/<pid>/stat` comm parsing (brittle:
  comm has spaces/parens).
- Confirm **`status-right` is the sole driver** of these side-effects today.

## Decomposition — five executable sub-plans

| Plan | Sub-project | Touches live? | Risk |
|---|---|---|---|
| **018** | Engine: `segments.mjs` registry + render modes (tmux/ansi/plain) + roles/gauges + two-layer priority width-drop. Pure, hermetic, `node --test`. | no | low |
| **019** | Compute + bridges: port `claude_sessions` (`/proc/status` discovery, ctx/token/msg math) + effort-sidecar reader + `bridge-token-forecast` (read cache, exec-hook feed) + `grok-adapter`. Fixtures from real transcripts. | no | med |
| **020** | Surfaces + side-effects + wiring: `tmux-status` (compute + side-effects + stdout) + `claude-statusline` (stdin + sidecar + snapshot + render, hide/silent toggle) + `side-effects.mjs` + safe install/uninstall + config segment model + `status doctor`. All tests hermetic (temp files); touches NO live tmux/settings. | no | med |
| **021** | Cutover: parity verification vs Python → fail-open call-site wrapper → side-effect ownership lock → canary ONE session's stdout → roll fleet in batches → archive Python to `~/.claude/legacy/` (keep ≥1 month) → one-command rollback script. Operator-gated, staged. | **YES** | **high** |
| **022** | State-synced animated background: `background.mjs` (state + wall-clock phase → breathing-wash `status-style bg`), `doneFlashSec` timing (needs a state-entered timestamp), session-scope set via `side-effects.mjs`, config `bars.tmux.background`. Depends on 018 + 020. | yes (bg only) | med |

Dependency order: 018 → 019 → 020 → {021 cutover, 022 background} (021 and 022
are independent after 020; 022 rides whatever surface 020 ships, live or
canary).

## Global constraints (every sub-plan inherits)

- **Zero runtime dependencies** — hard invariant. The token_forecast feed is an
  exec-hook, not an npm dep.
- **`node --test` + `./node_modules/.bin/biome check <files>`** — house verify.
  NEVER `npx biome` (wrong version) or `npm run lint` (proxy mangles output).
  `bash -n` for any shell.
- **Fail-open on every render path** — empty output + exit 0. `render` never
  writes to stderr (hosts surface it as an error state).
- **Defaults reproduce today's exact look** — any day-1 user-visible change is
  a regression.
- **Never disturb the operator's ~15 live tmux sessions** — 018–020 touch
  nothing live; 021 is staged, per-session-reversible, Python-fallback. Back up
  before mutating any live file.
- **Performance**: 15 sessions × transcript reads + message counting + one
  `/proc` scan every ≤2 s must stay in tens of ms. Single `/proc` scan per
  render, reused for all panes.

## Risks (fusion-surfaced)

- **Side-effect ownership / races** — concurrent herald invocations (every 2 s
  from every attached session) race on window names/colors/`@ctxbar`. Writes
  must be idempotent; the ownership lock makes the Python no-op during overlap.
- **Silent forecasting breakage** — a wrong snapshot feed freezes 5h/weekly
  with no error in herald. Mitigated by DECISION 2 (delegate ingest to Python).
- **Covered-curtain case** — the SESSION-scope `@ctxbar` mirror must keep
  working so a covered session (active window `_curtain`) still shows its gauge.
- **Grok vs Claude data model** — Grok sessions lack Anthropic `rate_limits`
  and the same context math; segments/side-effects degrade gracefully for them.
- **tmux `#(...)` environment** — no TTY, limited env, stdout-only, short
  timeout; any stray stdout / unhandled rejection / long sync work → blank or
  stale bar.
- **Testing the side-effects + exact visuals** — hard to unit-test; rely on
  real-session fixtures + property tests on segment dropping + `status doctor`
  integration smoke.

## Open items to resolve during 019/021 (Grok's uncertainty list)

Read the actual Python first: exact sidecar/snapshot paths + shapes; the
precise "live" predicate + token math; exact stdout format (ANSI vs tmux
`#[...]`); `usage_blocks()` output shape + published artifact location; whether
`status-right` is the sole side-effect driver; measured Python latency on the
15-session workload (baseline the perf budget).

## Execution model

Opus stays advisor (this spec, each `-plan.md`, review, verify, merge); Grok
xhigh executes the code per sub-plan via armory, in a worktree
(`.claude/worktrees/<name>`), verified by `node --test` + biome + `bash -n`.
One sub-plan dispatched at a time — earlier plans land and are reviewed before
the next is written, so specs do not drift. Plan 021 (cutover) is
operator-gated and never auto-run.

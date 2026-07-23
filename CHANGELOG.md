# Changelog

All notable changes to status-herald are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project is pre-1.0: breaking changes are listed under **Migration** and
are not soft-aliased (see design D3).

## [Unreleased]


## [0.2.3] — 2026-07-23

### Fixed

- **Curtain stuck grey after `prefix+&` / kill-window**: when the last live
  window dies and only `_curtain` remains, a session `window-unlinked` hook
  (tmux 3.x — not `after-kill-window`, which does not exist) kills the card so
  the session and grey curtain die with the work. Re-arm / `arm-all` refreshes
  the hook. Also sets `detach-on-destroy on` for clean client exit.

## [0.2.1] — 2026-07-23

### Added

- **Public product documentation** under `docs/` (docs-kit frontmatter, sidebar `_meta.json`, `docs:check` / `docs:health`)
- **`docs/works-with.md`** — fleet sibling map with honest interop edges
- **Contextual fleet mentions** in feature docs where integrations are real
- **Recollection soft-nudge** for docs health (memory-atlas `atlas-recollection` + docs-kit)

See [`docs/index.md`](docs/index.md) for the documentation hub.

## [0.2.0] — 2026-07-22

First real feature release after the public `0.1.0` scaffold. Curtain cards
grow a **bestiary** of denizens, clickable chrome, and the truth-lease settle
model that was already documented under Unreleased.

### Highlights

- **Bestiary / denizens** — fox, cat, and owl assigned per tmux session; reactive
  poses by curtain state; full + compact tiers; public lore in
  [`docs/BESTIARY.md`](docs/BESTIARY.md).
- **Clickable card chrome** — × off and ↻ pet on the curtain card.
- **Truth leases** — fail-idle settle; watchers never hold `WORKING`.
- **Pause / resume** — keep a session’s curtain open for copy/select without
  the focus adapter re-covering the pane.

### Migration (breaking)

#### Curtain settle — truth leases (fail-idle)

`WORKING` no longer clings until an idle notification or a forever-watcher.
Every hold is a lease with a TTL under `curtain.lease.*`:

| Kind | Config key | Default TTL |
|------|------------|-------------|
| subagent | `curtain.lease.subagentTtlSec` | 300s |
| watcher | `curtain.lease.watcherTtlSec` | 900s |
| bg_shell | `curtain.lease.bgShellTtlSec` | 300s |
| turn | `curtain.lease.turnTtlSec` | 120s |

Watchers (`/loop`, `scheduler_create`, `monitor`) are **informational only** —
they never hold `WORKING` and never block settle (display/decay only).
Synthesis/hybrid hosts quiet-settle via `curtain.settle.settleSynthQuietSec`
(default 300s) and leak-clear leftover subagent leases via
`curtain.settle.settleSynthLeakSec` (default 360s). Dead agent PID → `DONE`.

#### Removed tmux session options

Replaced by a single lease store and host classification:

| Removed | Replacement |
|---------|-------------|
| `@herald_bg_subagents` | live counts from `@herald_leases` |
| `@herald_bg_subagent_ids` | lease ids in `@herald_leases` |
| `@herald_bg_shells` | `bg_shell` leases |
| `@herald_bg_watchers` | `watcher` leases |
| `@herald_bg_watcher_ids` | watcher lease ids |
| `@herald_tasks_seen` | `@herald_host_kind` (`synthesis` \| `task_list` \| `hybrid`) |

New related options: `@herald_leases`, `@herald_host_kind`,
`@herald_agent_pid`, `@herald_model_hint`, `@herald_settle_ts`.

Re-arm after upgrade: `herald curtain disarm && herald curtain arm` (or
`herald curtain refresh` for card-loop script updates).

#### Token feed path (token-forecast removed)

- **Default feed:** `~/.local/share/token-oracle/forecast.json` via
  `lib/status/bridge-token-oracle.mjs`.
- **Removed:** `TOKEN_FORECAST_SNAPSHOT` env and all `token-forecast` path
  assumptions (including the old `bridge-token-forecast.mjs` module name).
- **Kept:** `HERALD_TOKEN_FEED` still overrides the optional ingest/feed
  command used when pushing snapshot data.

### Added

- **Curtain pause / resume** — hold a session’s curtain open so the live agent
  pane stays selectable (copy text to a browser, etc.) without the focus
  adapter re-covering it:
  - `herald curtain pause [session]` / `resume [session]`
  - `herald curtain pause-all` / `resume-all`
  - Session opt `@herald_paused=1`; still armed (hooks keep stamping state).
- **Denizens P2 — per-session creatures** (fox / cat / owl):
  - Deterministic species + seed stamped at `arm` (`@herald_entity`,
    `@herald_seed`); card loop passes `--entity`/`--seed`.
  - Reactive poses by `@herald_state`; full (≤5×12) / compact (≤3×8) tiers
    (RECONCILE R1); `none` when card too small.
  - Whitespace-only composite (art sacred); classic + motion-off unchanged.
- **Denizens P1 — coherent particles + one motion language**
  (`docs/superpowers/specs/2026-07-18-herald-denizens-design.md`):
  - `driftField` particle engine (coordinate-only mote identity + continuous
    drift + age-ramp fade). Replaces phase-randomized `sparkRain` that
    re-rolled every frame (the curtain “snow flicker”).
  - Ambient drifting motes during `WORKING` (not only a DONE burst).
  - Single `stateHue()` table in `lib/curtain/wash.mjs`: WORKING amber(214),
    done green(70), needs rose(167), compacting steel(67). Tmux state segment
    accent, tmux tab glyph phase-cycle (`●◐○◑`), Claude WORKING chip → amber
    + dark ink (`38;5;232` on `48;5;214`) for WCAG contrast.
  - `theatrics.seed` threaded through render (defaults to 0 until P2 seed funnel).
  - Denizen species + public bestiary (see Highlights / BESTIARY.md).
- Curtain **theatrics**: stage-curtain draw on cover, DONE rising burst,
  NEEDS breathe; `curtain.animation.enabled` / `reducedMotion` / stage-draw
  timing; motion-off + `classic` stay byte-identical to baseline.
- `herald curtain inspect` stage board (lease kinds + optional fzf drill-in).
- Unified `herald doctor` banner + fix hints; real `package.json` version
  (no more `0.0.0`).
- README demo GIFs (curtain / inspect / doctor) via headless VHS recorder.
- Native status surfaces wiring (tmux-status + Claude statusline; plan 020).
- `herald doctor` — hooks (absolute paths), tmux, settle-health
  (`@herald_settle_ts` / RC3), agent-status dir, card-loop binary.
- Per-CLI payload adapters (`lib/curtain/adapters/claude.mjs`,
  `grok.mjs`) behind `normalizePayload`.
- Agent-status providers convention reader (`lib/status/providers.mjs`) and
  normative schema doc [`docs/AGENT-STATUS-PROVIDERS.md`](docs/AGENT-STATUS-PROVIDERS.md).
- Optional curtain info lines: `curtain.lines.model`,
  `curtain.lines.sageZone` (default off).
- Optional bar segment: `bars.segments.sage` (default off); account gauges
  read the oracle forecast when present.

### Changed

- Claude bottom-bar WORKING uses full-bar amber bg; chip is dark-on-amber.
  Secondary text (model, forecast) on bright amber is a known lower-contrast
  follow-up (out of Denizens P1 scope; see RECONCILE R2/docs).
- Tmux bar wash: sliding comet line (not solid colour flood); wash off by
  default so `@ctxbar` context stays visible.
- Grok context window treated as **500k** (not 1M).

### Fixed

- Particle flicker / uncorrelated snow on curtain cards (`sparkRain` phase
  XOR into every cell hash).
- Three disagreeing WORKING hues (curtain / wash / Claude bar) unified via
  `stateHue`.
- Watcher leases no longer immortal-hold `WORKING`; kind-scoped lease touch;
  subagent count self-heal; empty Stop distrust; Claude host-kind never
  demotes itself to hybrid; synthesis quiet settle 300s for silent thinking.
- Absolute `bin/herald` path in card loop (blank curtain when wrong Node on PATH).
- Card loop HUP cleanup; art block centering; settle policy for stuck fleets.

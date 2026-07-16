# Changelog

All notable changes to status-herald are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project is pre-1.0: breaking changes are listed under **Migration** and
are not soft-aliased (see design D3).

## [Unreleased]

### Migration (breaking)

#### Curtain settle — truth leases (fail-idle)

`WORKING` no longer clings until an idle notification or a forever-watcher.
Every hold is a lease with a TTL under `curtain.lease.*`:

| Kind | Config key | Default TTL |
|------|------------|-------------|
| subagent | `curtain.lease.subagentTtlSec` | 120s |
| watcher | `curtain.lease.watcherTtlSec` | 900s |
| bg_shell | `curtain.lease.bgShellTtlSec` | 120s |
| turn | `curtain.lease.turnTtlSec` | 120s |

Watchers (`/loop`, `scheduler_create`, `monitor`) hold `WORKING` only while
their lease is live; they no longer block settle forever. Synthesis/hybrid
hosts also quiet-settle via `curtain.settle.settleSynthQuietSec` (default 90s)
and leak-clear leftover subagent leases via
`curtain.settle.settleSynthLeakSec` (default 180s). Dead agent PID → `DONE`.

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

# Plan Quality Revision — Campaign Index

**Design:** `docs/superpowers/specs/2026-07-13-herald-plan-quality-revision-design.md`
**Ops plan:** `docs/superpowers/plans/2026-07-14-herald-plan-quality-revision.md`
**Mode:** revise-executed (Grok 4.5 auditors + fix-plan executors)
**Scope:** C1–C6 (plans 013–019 landed). **Frozen:** Plan 020 + partial surfaces.

## WIP freeze

- WIP freeze: branch wip/020-partial @ 56b4615

## Baseline (Phase 0)

- Measured at: `4fd7000`
- `node --test`: `224 pass / 0 fail`
- biome: `./node_modules/.bin/biome` available: yes (1.9.4)
- `biome check .`: exit 1 — 3 pre-existing fixture format nits (record, do not fix): `test/fixtures/session-meta-test-sid-1234.json`, `test/fixtures/token-forecast-snapshot.json`, `test/fixtures/session-sample.json`

## Clusters

| ID | Plans | Primary paths | Key commits (evidence) | Audit status |
|----|-------|---------------|------------------------|--------------|
| C1 | 013 curtain + per-tab | `lib/curtain/{session,orchestrator,tmux,state,grid,install,hook,debug}.mjs`, curtain CLI, `scripts/curtain-card-*.sh` | `a0699c8`..`a147449`, `b49f8b8`, `f278209` | PENDING |
| C2 | 014 | `lib/curtain/themes.mjs`, hook/state | `479da55` | PENDING |
| C3 | 015 | `mac/herald-focus.lua`, `scripts/focus-agent/*`, systemd unit, config keys | `6046ad2`..`5b661c7` | PENDING |
| C4 | 016 | card loop/session, bar save/restore | `30c702c`..`442bfbf` | PENDING |
| C5 | 018 | `lib/status/segments.mjs`, `lib/render.mjs` | `ef1b148`..`ec7b75e` | PENDING |
| C6 | 019 | `lib/status/{compute,grok-adapter,bridge-token-forecast}.mjs` | `1aa506e` | PENDING |

## Phases

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Inventory + index + freeze | IN PROGRESS | |
| 1 C1+C2 audit/fix | TODO | |
| 2 C3+C4 audit/fix | TODO | |
| 3 C5+C6 audit/fix | TODO | |
| 4 Cross-cutting residual | TODO | |
| Campaign closed | TODO | Green light for 020 only when closed |

## Fix-plans (`plans/rNNN-*.md`)

| Plan | Parent | Cluster | Severity | Status |
|------|--------|---------|----------|--------|
| _(none yet)_ | | | | |

Status values: TODO | IN PROGRESS | DONE | BLOCKED | REJECTED | DEFERRED

## Findings disposition log

| ID | Cluster | Severity | Summary | Disposition |
|----|---------|----------|---------|-------------|
| _(none yet)_ | | | | |

## Explicit out of scope (do not audit as gaps)

- `lib/status/tmux-status.mjs`, `lib/status/background.mjs`, `test/status-surfaces.test.mjs`, `plans/020-*`
- Plans 002–012 generic engine (superseded per `plans/017-herald-native-bars.md`)
- Live tmux sessions / operator `~/.claude` mutation

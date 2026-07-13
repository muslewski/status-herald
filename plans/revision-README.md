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
| C1 | 013 curtain + per-tab | `lib/curtain/{session,orchestrator,tmux,state,grid,install,hook,debug}.mjs`, curtain CLI, `scripts/curtain-card-*.sh` | `a0699c8`..`a147449`, `b49f8b8`, `f278209` | AUDITED |
| C2 | 014 | `lib/curtain/themes.mjs`, hook/state | `479da55` | AUDITED |
| C3 | 015 | `mac/herald-focus.lua`, `scripts/focus-agent/*`, systemd unit, config keys | `6046ad2`..`5b661c7` | PENDING |
| C4 | 016 | card loop/session, bar save/restore | `30c702c`..`442bfbf` | PENDING |
| C5 | 018 | `lib/status/segments.mjs`, `lib/render.mjs` | `ef1b148`..`ec7b75e` | PENDING |
| C6 | 019 | `lib/status/{compute,grok-adapter,bridge-token-forecast}.mjs` | `1aa506e` | PENDING |

## Phases

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Inventory + index + freeze | DONE | freeze wip/020-partial@56b4615; baseline 224 pass |
| 1 C1+C2 audit/fix | DONE | r001-r004 merged; 233 pass |
| 2 C3+C4 audit/fix | TODO | |
| 3 C5+C6 audit/fix | TODO | |
| 4 Cross-cutting residual | TODO | |
| Campaign closed | TODO | Green light for 020 only when closed |


## Fix-plans (`plans/rNNN-*.md`)

| Plan | Parent | Cluster | Severity | Status |
|------|--------|---------|----------|--------|
| r001 | 013 / per-tab | C1 | P1 | DONE |
| r002 | 013 / config | C1 | P1 | DONE |
| r003 | install/grid | C1 | P2 | DONE |
| r004 | 013/014 tests | C1+C2 | P1 | DONE |


## Findings disposition log

| ID | Cluster | Severity | Summary | Disposition |
|----|---------|----------|---------|-------------|
| C1a-F1 | C1 | P1 | status reads pane opts; stamps are session-scoped | DONE |
| C1a-F2 | C1 | P1 | coverableStates config ignored | DONE |
| C1a-F3 | C1 | P2 | grid orchestrator omits compacting | DONE |
| C1a-F4 | C1 | P2 | missing Grok Stop synthesis test | DONE |
| C1a-F5 | C1 | P2 | missing compacting cover test | DONE |
| C1b-F1 | C1 | P2 | install drops whole hook group | DONE |
| C1b-F5 | C1 | P2 | grid hooks bare herald | DONE |
| C2-F1 | C2 | P1 | framed card tests omit dynamic info lines | DONE |
| C1a-F6 | C1 | P2 | focus title ambiguity tie-break | DEFERRED |
| C1a-F7 | C1 | P3 | legacy event path pane stamp | DEFERRED |
| C1a-F8 | C1 | P3 | disarm leaves stale @herald_* | DEFERRED |
| C1b-F2 | C1 | P2 | disarm order weak-test | DEFERRED |
| C1b-F3 | C1 | P2 | keypress reveal weak-test | DEFERRED |
| C1b-F4 | C1 | P2 | doctor short of design §6.6 | DEFERRED |
| C1b-F6 | C1 | P3 | no bash -n card script test | DEFERRED |
| C2-F2..F8 | C2 | P2/P3 | additional theme weak-tests | DEFERRED |

## Fix-plans (`plans/rNNN-*.md`)

| Plan | Parent | Cluster | Severity | Status |
|------|--------|---------|----------|--------|
| r001 | 013 / per-tab | C1 | P1 | DONE |
| r002 | 013 / config | C1 | P1 | DONE |
| r003 | install/grid | C1 | P2 | DONE |
| r004 | 013/014 tests | C1+C2 | P1 | DONE |

## Explicit out of scope (do not audit as gaps)

- `lib/status/tmux-status.mjs`, `lib/status/background.mjs`, `test/status-surfaces.test.mjs`, `plans/020-*`
- Plans 002–012 generic engine (superseded per `plans/017-herald-native-bars.md`)
- Live tmux sessions / operator `~/.claude` mutation

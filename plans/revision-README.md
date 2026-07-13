# Plan Quality Revision — Campaign Index

**Design:** `docs/superpowers/specs/2026-07-13-herald-plan-quality-revision-design.md`  
**Ops plan:** `docs/superpowers/plans/2026-07-14-herald-plan-quality-revision.md`  
**Mode:** revise-executed (Grok 4.5 auditors + fix-plan executors)  
**Scope:** C1–C6 (plans 013–019 landed). Plan 020 was frozen during the campaign.

## WIP freeze

- WIP freeze: branch `wip/020-partial` @ `56b4615`

## Baseline

| When | Suite |
|------|--------|
| Phase 0 | 224 pass / 0 fail @ `4fd7000` |
| Campaign close | **242 pass / 0 fail** @ `037b0ff` |

biome: `./node_modules/.bin/biome` 1.9.4 available. Whole-tree check still has 3 pre-existing fixture format nits (not fixed).

## Clusters

| ID | Plans | Audit status |
|----|-------|--------------|
| C1 | 013 curtain + per-tab | REVISED (r001–r003) |
| C2 | 014 themes | REVISED (r004) |
| C3 | 015 event focus | REVISED (r005) |
| C4 | 016 anim + bar | REVISED (r006–r007) |
| C5 | 018 status engine | REVISED (r009) |
| C6 | 019 compute/bridges | REVISED (r008) |

## Phases

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Inventory + index + freeze | DONE | `wip/020-partial@56b4615` |
| 1 C1+C2 audit/fix | DONE | r001–r004 |
| 2 C3+C4 audit/fix | DONE | r005–r007 |
| 3 C5+C6 audit/fix | DONE | r008–r009 |
| 4 Cross-cutting residual | DONE | no new P0/P1; P2/P3 deferred |
| Campaign closed | DONE | **Green light for 020: YES** |

## Fix-plans

| Plan | Parent | Cluster | Sev | Status |
|------|--------|---------|-----|--------|
| r001 | 013 | C1 | P1 | DONE — status reads session-scoped `@herald_state` |
| r002 | 013 | C1 | P1 | DONE — `coverableStates` + compacting default |
| r003 | install/grid | C1 | P2 | DONE — entry-level hook drop + absolute grid hooks |
| r004 | 014 | C2 | P1 | DONE — framed forge keeps dynamic info lines (test) |
| r005 | 015 | C3 | P1 | DONE — no unit `reveal-all` on failure restart; heartbeat truncate |
| r006 | 016 | C4 | P1 | DONE — reset card tick on state change (`settleAfter`) |
| r007 | 016 | C4 | P1 | DONE — `refreshCards` survives EXIT trap |
| r008 | 019 | C6 | P1 | DONE — hermetic token-forecast, discovery `ppid`, injectable paths |
| r009 | 018 | C5 | P1 | DONE — width-drop rightmost multi-drop test |

## Findings disposition (high-signal)

| ID | Sev | Disposition |
|----|-----|-------------|
| C1a-F1 status pane vs session | P1 | DONE r001 |
| C1a-F2 coverableStates ignored | P1 | DONE r002 |
| C1a-F3 grid omits compacting | P2 | DONE r002 |
| C1b-F1 install whole-group drop | P2 | DONE r003 |
| C1b-F5 bare herald grid hooks | P2 | DONE r003 |
| C2-F1 framed info lines | P1 | DONE r004 |
| C3-F1 ExecStopPost reveal-all | P1 | DONE r005 |
| C3-F2 heartbeat no truncate | P2 | DONE r005 |
| C4-F1 settleAfter absolute tick | P1 | DONE r006 |
| C4-F2 refreshCards trap race | P1 | DONE r007 |
| C6-F1 fixture wall-clock | P1 | DONE r008 |
| C6-F2 discovery ppid | P1 | DONE r008 |
| C6-F3 injectable paths | P1 | DONE r008 |
| C5 multi-drop tie-break test | P1 | DONE r009 |
| Focus title tie-break, doctor §6.6, extra weak-tests | P2–P3 | **DEFERRED** |

## Campaign close

- **Green light for Plan 020: YES** (foundations revised; resume from `wip/020-partial` or re-apply WIP)
- Residual DEFER list is non-blocking polish
- By-design: 002–012 never-built / superseded per Plan 017
- WIP: restore with `git cherry-pick` / merge `wip/020-partial` when ready (do not force-drop)

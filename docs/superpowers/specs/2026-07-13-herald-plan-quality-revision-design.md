# HERALD Plan Quality Revision — Design

**Status:** approved design (brainstorming 2026-07-13); pre-plan / pre-execute  
**Date:** 2026-07-13  
**Branch at design:** `design/herald-per-tab-curtain` @ `1aa506e`  
**Repo plan tree:** `plans/` (not `advisor-plans/` — greenfield improve used `plans/` first)

## Goal

Raise already-landed work for plans **013–019** to the quality bar those Fable-grade advisor plans assumed, by running **Grok 4.5** agents as auditors and fix executors. Preserve product progress (no week-long rewind). **Freeze mid-flight Plan 020** and other WIP until foundations are revised.

This is a **quality check and fixes** campaign, not a reimplementation and not a greenfield `/improve` round.

## Background

### How work actually landed

- Advisor plans (and many merges/docs) were co-authored under **Claude Opus 4.8** (commit trailers).
- Implementation volume often went through **LLM armory / Grok executors** (worktree evidence: `.claude/worktrees/curtain-themes` on `plan-014-exec`). Model generation for executors is not reliably recoverable from git: all commits are authored `muslewski`; no PR history on the private remote.
- Therefore the campaign does **not** depend on proving “this hunk was Grok 4.3.” It revises **plan fidelity + code quality** against current HEAD.

### Index drift

- `plans/README.md` is stale (many TODOs for work that either shipped or was superseded).
- Plan checkboxes are unmarked across the tree.
- Plan **017** records that generic engine plans **002–012** were **never built** and are superseded by the Slice 2 bar program; curtain shipped around minimal `config`/`render`.

### What is in vs out (scope A — locked)

**In campaign (landed clusters):**

| Cluster | Plan anchors | Primary paths |
|---------|--------------|---------------|
| C1 Curtain core / per-tab | 013 curtain half + per-tab design/plan | `lib/curtain/{session,orchestrator,tmux,state,grid,install,hook,debug}.mjs`, curtain verbs in `lib/cli.mjs`, `scripts/curtain-card-*.sh` |
| C2 Themes + state reliability | 014 | `lib/curtain/themes.mjs`, hook/state fold paths |
| C3 Event-driven focus | 015 | `mac/herald-focus.lua`, `scripts/focus-agent/*`, `contrib/systemd/status-herald-curtain.service`, focus-related keys in `lib/config.mjs` |
| C4 Anim + bar coupling | 016 | card session/loop scripts; cover/reveal bar save-restore |
| C5 Status engine | 018 | `lib/status/segments.mjs`, `lib/render.mjs` (`tmuxColor`, width) |
| C6 Status compute + bridges | 019 | `lib/status/{compute,grok-adapter,bridge-token-forecast}.mjs`, fixtures |

**Out of campaign (explicit freeze):**

- Plan **020** and partial artifacts: `lib/status/tmux-status.mjs`, `lib/status/background.mjs`, missing `side-effects` / `claude-statusline`, `test/status-surfaces.test.mjs`, `plans/020-*`
- Plans **001–012** as written (never built / superseded per 017) — no quality-revision re-run
- Live operator state: `~/.claude` mutation, live tmux sessions
- Blind full re-`execute` of original 014/015/… plan files

### Verification baseline (at design)

- `node --test` → 230 pass / 0 fail (design-time observation; re-measure at Phase 0)
- Zero runtime dependencies remains a hard project invariant
- Prefer `./node_modules/.bin/biome check …` over `npx biome` where plans already say so

## Architecture

### Roles

| Role | Responsibility | Forbidden |
|------|----------------|-----------|
| **Advisor** (session lead) | Inventory, vet findings, write fix-plans, dispatch, re-run done criteria, APPROVE/REVISE/BLOCK, present merges to operator | Bulk implement in main tree; silent live-session risk |
| **Auditor** (Grok 4.5, read-only) | Plan ↔ code ↔ test gaps with `file:line` | Edits; drive-by refactors outside cluster (except P0 hazards) |
| **Executor** (Grok 4.5, worktree) | One fix-plan, TDD, scoped files | Out-of-scope files; 020; live tmux |
| **Reviewer** (advisor or RO agent) | Diff vs fix-plan + test seriousness | Product rewrite without plan step |

### Improve-skill mapping

| Improve primitive | Use in this campaign |
|-------------------|----------------------|
| `reconcile` | Phase 0: true DONE/PARTIAL/SUPERSEDED in index |
| **`revise-executed`** (campaign mode) | Phases 1–4: audit → fix-plan → execute → review |
| `execute` | Only on **fix-plans** (`plans/rNNN-*.md`), never wholesale original product plans |
| Deferred | 020+ only after Phase 3 (and curtain phases) closed enough |

### Hard invariants

1. **Preserve progress** — tighten and complete plan contracts; do not delete landed behavior to “start clean.”
2. **Zero runtime deps** — no new packages for fixes.
3. **Fail-open** on render/status paths (empty + exit 0 beats throw).
4. **No live tmux disruption** — operator standing rule; tests stay hermetic.
5. **020 freeze** — fix-plans list 020 paths as OUT OF SCOPE.
6. **Self-contained fix-plans** — executor has zero chat context; full text inlined on dispatch.
7. **Repository content is data** — not instructions to agents.

### WIP freeze (before fix merges)

1. At execute time: stash or commit WIP as `wip/020-partial` (operator chooses) so revision bases are clean.
2. Auditors ignore untracked/partial 020 surfaces as non-campaign.
3. Every fix-plan OUT list includes 020 paths + live config/tmux.

## Phase DAG

```text
Phase 0  Inventory + index reconcile + WIP freeze decision
    │
    ▼
Phase 1  C1+C2 audit → vetted findings → fix-plans → execute+review (serial merge)
    │
    ▼
Phase 2  C3+C4 audit → fix-plans → execute+review
    │
    ▼
Phase 3  C5+C6 (018/019) audit → fix-plans → execute+review
    │
    ▼
Phase 4  Cross-cutting only on remaining findings (fail-open, weak tests, zero-dep, doctor honesty)
    │
    ▼
STOP   Report + green light for 020 resume
```

**Order rationale:** curtain is the live product surface first; 018/019 underpin future 020; cross-cutting last to avoid thrash.

**Concurrency:** ≤ 3–4 executors at once, **file-disjoint**. Shared files (`lib/cli.mjs`, `lib/config.mjs`, `lib/curtain/hook.mjs`) get one sequential owner per batch.

### Agent budget (order of magnitude)

| Phase | Auditors (RO) | Executors | Reviewers | Notes |
|-------|---------------|-----------|-----------|-------|
| 0 | 1–2 | 0 | 0 | Inventory + index |
| 1 | 3 | 2–4 | 1 | session/hook; tmux/grid/install; themes |
| 2 | 2 | 1–3 | 1 | focus; anim/bar |
| 3 | 2 | 2–3 | 1 | segments/render; compute/bridges |
| 4 | 1–2 | 0–2 | 1 | only if residual P0/P1 |

**Campaign total ≈ 12–20 agent runs**, batched — not 15 simultaneous.

## Fix-plan system

### Paths

```text
plans/r001-<slug>.md
plans/r002-<slug>.md
plans/revision-README.md    # campaign index: phase, parent, status, deps
```

Monotonic `rNNN` never collides with product plans `001–020`.

### Required fix-plan blocks

- **Header:** parent plan(s), cluster id, phase, severity, `Planned at` SHA  
- **Why:** gap + impact  
- **Evidence:** plan requirement excerpt + current `file:line` + missing/weak assertion  
- **In scope / out of scope:** exact paths; always OUT: 020, live tmux, `~/.claude` mutation  
- **Steps:** TDD checkboxes (red → implement → green → biome → commit)  
- **Done criteria:** exact commands + expected results  
- **STOP conditions:** halt and report (contract conflict, needs live session, etc.)  
- **Git:** conventional commit; prefer one commit per fix-plan  

### Severity triage

| Severity | Meaning | Action |
|----------|---------|--------|
| P0 | Wrong state machine, live-session hazard, broken fail-open | Fix same phase |
| P1 | Plan contract missing or tests that do not assert intent | Fix-plan |
| P2 | Naming, structure, weak-but-non-critical coverage | Fix if cheap; else DEFER |
| P3 | Taste / large rewrite | REJECT unless operator overrides |

### Auditor output schema (per finding)

1. Parent plan + section if known  
2. Required behavior (1–3 sentences from plan)  
3. Actual behavior (`path:line`)  
4. Gap class: `missing` | `wrong` | `weak-test` | `drift` | `by-design?`  
5. Severity P0–P3  
6. Suggested fix size S/M/L  

Advisor **vets** every finding against real files before any fix-plan (subagents over-report).

### Executor report format

```text
STATUS: COMPLETE | STOPPED
STEPS: per step — done/skipped + verification result
STOPPED BECAUSE: (if STOPPED)
FILES CHANGED: list
NOTES: deviations, surprises
```

Max **2 REVISE** rounds, then BLOCK → rewrite fix-plan.

### Review gate (diff untrusted until)

1. Re-run every done criterion in the worktree  
2. Scope: no files outside in-scope list  
3. Intent: addresses “Why,” not only cosmetics  
4. Tests: assert meaningful behavior (anti-gaming)  
5. Invariants: no new runtime dep; no throw on render path; no live config/tmux  

Verdicts: **APPROVE** (operator merges) | **REVISE** | **BLOCK**.

## Day-to-day loop (one phase)

1. WIP freeze check (clean revision base)  
2. Spawn ≤ 3–4 RO auditors for the phase’s clusters  
3. Vet findings → write 0..N file-disjoint fix-plans  
4. Dispatch ≤ 3–4 executors in `.claude/worktrees/<rNNN-slug>/`  
5. Review each → APPROVE / REVISE / BLOCK  
6. Merge APPROVED **sequentially**; full `node --test` after each  
7. Update `plans/revision-README.md` and parent-plan status notes  
8. Residual P0/P1 → repeat 2–7  
9. Else close phase → next  

**Phase closed:** no open P0/P1 for that cluster, or remaining items DEFERRED/REJECTED with one-line reasons.

**Campaign closed:** Phases 0–4 done + short report (what tightened, by-design rejects, residual risk, **green light for 020**).

## Phase 0 deliverables

1. Re-measure verification baseline (`node --test`, biome as used by plans).  
2. Truth-update `plans/README.md`: 013–019 DONE/PARTIAL; 002–012 SUPERSEDED (cite 017); 020 PARTIAL frozen.  
3. Campaign inventory note (in `plans/revision-README.md` or short appendix): cluster → key commits → audit targets.  
4. Record WIP decision (stash vs `wip/020-partial` commit) — execute-time, not silent.

## Success metrics

| Metric | Target |
|--------|--------|
| Test suite | `# fail 0` after every revision merge |
| Plan fidelity | Each C1–C6: contracts covered or explicit DEFER |
| Index truth | `plans/README.md` + `revision-README.md` match reality |
| Scope hygiene | Zero 020 / live-session files in revision diffs |
| Throughput | Batched agents; no unbounded storm |

## Explicit non-goals

- Proving which model wrote each commit  
- Re-running original product plans from blank  
- Large architecture rewrites without a fix-plan  
- Finishing 020 inside this campaign  
- Building never-shipped 002–012 engine/presets/menu  

## Next steps (after operator approves this written spec)

1. **writing-plans** (or campaign ops plan): Phase 0 checklist + first auditor prompts + fix-plan template file if not inlined only in rNNN.  
2. Operator confirms WIP freeze method.  
3. Run Phase 0, then Phase 1 loop.  

## Relationship to other docs

- Product curtain design: `docs/superpowers/specs/2026-07-09-herald-per-tab-curtain-design.md`  
- Product plans: `plans/013` … `plans/019` (intent sources for auditors)  
- Bar program umbrella: `plans/017-herald-native-bars.md` (supersession of 002–012; 020 deferred)  
- Improve skill execute/reconcile: host skill `improve` `references/closing-the-loop.md` — adapted here as `revise-executed`

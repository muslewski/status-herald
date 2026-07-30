---
type: zone
summary: "Curtain truth engine — STATES, truth leases, chrome-parity host inventory reconcile on settle, hook stamp path, NEEDS sound, arm/cover/reveal/focus, tmux opts, grid, wash, debug."
tags: [curtain, leases, tmux, session, chrome-parity]
status: active
created: 2026-07-21
updated: 2026-07-30
verifiedAt: f1bafabb
owns:
  routes: []
  testids: []
  globs:
    - "lib/curtain/state.mjs"
    - "lib/curtain/lease.mjs"
    - "lib/curtain/settle.mjs"
    - "lib/curtain/hook.mjs"
    - "lib/curtain/session.mjs"
    - "lib/curtain/orchestrator.mjs"
    - "lib/curtain/tmux.mjs"
    - "lib/curtain/wash.mjs"
    - "lib/curtain/sound.mjs"
    - "lib/curtain/grid.mjs"
    - "lib/curtain/debug.mjs"
  tools: []
depends:
  - "[[agent-adapters]]"
  - "[[config]]"
  - "[[status-engine]]"
invariants: []
skills: []
related:
  - "[[status-engine]]"
sources:
  - "[[2026-07-30-chrome-parity-counts-design]]"
---

## What this is

Core **curtain lifecycle**: opaque status cards cover unfocused agent panes; focus reveals the live TUI. Domain vocabulary lives here:

| Module | Role |
|--------|------|
| `state.mjs` | `idle` / `working` / `compacting` / `done` / `needs` + elapsed helpers |
| `lease.mjs` | Pure truth-lease algebra — every WORKING hold is `{kind,id,exp}` with TTL |
| `settle.mjs` | Pure settle policy (synth quiet, leak, max working/needs) |
| `hook.mjs` | Stdin JSON → normalized event (via adapters); tool/watcher classification |
| `session.mjs` | Arm/disarm, stampFromHook, **applyHostInventory** (Grok meta reconcile), cover/reveal/focus/pause, PID backstop |
| `orchestrator.mjs` | Pane swap cover/reveal + onEvent/onFocusIn/Out |
| `tmux.mjs` | Session opts (`@herald_state`, `@herald_leases`, peers) |
| `wash.mjs` | Status-bar state colour wash while covered |
| `sound.mjs` | Default-off NEEDS-edge attention audio; pluggable backends |
| `grid.mjs` | Multi-slot `herald curtain up/down` session layout |
| `debug.mjs` | Capture / debug log paths |

Prefer a brief false `DONE` over a card stuck on WORKING: leases expire; they do not cling.

**Chrome-parity counts:** hooks drive WORKING/NEEDS; Grok **counts** come from `[[status-engine]]` `grok-inventory` on each `applySettle` tick (`status: running` metas). Spawn without id uses single `syn-spawn-pending`, not per-second stacking. Claude `task_list` keeps `background_tasks[]` as authority.

## Anchors

Directory-level ownership of lifecycle modules under `lib/curtain/`, excluding adapters (payload shape), install/doctor/inspect (ops CLI), and themes/theatrics/denizens (paint).

## Invariants

Seed pass: empty. Likely future claims — lease kinds, fail-open hooks, absolute node path for grid loops — need `enforcedBy` after review.

## Lineage

Inferred from README curtain phase-1 / truth-lease prose + module headers on 2026-07-21 atlas-seed pass. Design lineage in `docs/superpowers/specs/` (not claimed as vault sources until promoted).

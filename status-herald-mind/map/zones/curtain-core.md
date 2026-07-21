---
type: zone
summary: "Curtain truth engine — STATES, truth leases (subagent/watcher/bg_shell/turn), settle policy, hook stamp path, session arm/cover/reveal/focus, tmux opts, grid up/down, wash/bar coupling, debug capture."
tags: [curtain, leases, tmux, session]
status: seeded
created: 2026-07-21
updated: 2026-07-21
verifiedAt: unverified
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
    - "lib/curtain/grid.mjs"
    - "lib/curtain/debug.mjs"
  tools: []
depends:
  - "[[agent-adapters]]"
  - "[[config]]"
invariants: []
skills: []
related: []
sources: []
---

## What this is

Core **curtain lifecycle**: opaque status cards cover unfocused agent panes; focus reveals the live TUI. Domain vocabulary lives here:

| Module | Role |
|--------|------|
| `state.mjs` | `idle` / `working` / `compacting` / `done` / `needs` + elapsed helpers |
| `lease.mjs` | Pure truth-lease algebra — every WORKING hold is `{kind,id,exp}` with TTL |
| `settle.mjs` | Pure settle policy (synth quiet, leak, max working/needs) |
| `hook.mjs` | Stdin JSON → normalized event (via adapters); tool/watcher classification |
| `session.mjs` | Arm/disarm, stampFromHook, cover/reveal/focus/pause, PID backstop |
| `orchestrator.mjs` | Pane swap cover/reveal + onEvent/onFocusIn/Out |
| `tmux.mjs` | Session opts (`@herald_state`, `@herald_leases`, peers) |
| `wash.mjs` | Status-bar state colour wash while covered |
| `grid.mjs` | Multi-slot `herald curtain up/down` session layout |
| `debug.mjs` | Capture / debug log paths |

Prefer a brief false `DONE` over a card stuck on WORKING: leases expire; they do not cling.

## Anchors

Directory-level ownership of lifecycle modules under `lib/curtain/`, excluding adapters (payload shape), install/doctor/inspect (ops CLI), and themes/theatrics/denizens (paint).

## Invariants

Seed pass: empty. Likely future claims — lease kinds, fail-open hooks, absolute node path for grid loops — need `enforcedBy` after review.

## Lineage

Inferred from README curtain phase-1 / truth-lease prose + module headers on 2026-07-21 atlas-seed pass. Design lineage in `docs/superpowers/specs/` (not claimed as vault sources until promoted).

# status-herald — overview

**HERALD** is a heads-up engine for terminal status surfaces: tmux **curtain
cards** cover unfocused agent panes (Claude Code, Grok Build, …) with
`● WORKING` / `✅ DONE` / `⚠ NEEDS YOU`, and optional **status bars** / gauges
via a soft-fail agent-status providers convention. Standalone-first; sibling
tools (token-oracle, agentic-sage, llm-armory) only light optional lines.

Seeded 2026-07-21 from codebase analysis (`atlas-seed`). All zones
`status: seeded` / `verifiedAt: unverified` until human review + stamp.

## Seeded zones

| Slug | Purpose |
|------|---------|
| [[cli]] | `bin/herald` + `lib/cli.mjs` command routing, version |
| [[config]] | Defaults, XDG/HERALD_CONFIG deep-merge, title helpers |
| [[curtain-core]] | States, truth leases, settle, hooks, session, tmux, grid, wash |
| [[agent-adapters]] | Claude/Grok hook payload normalization |
| [[curtain-ops]] | install / doctor / inspect |
| [[card-surface]] | Card frame, themes, theatrics, denizens, card tick scripts |
| [[status-engine]] | Segments, compute, providers, oracle/sage bridges, bar renderers |
| [[focus-host]] | Focus-agent scripts, Mac Hammerspoon, systemd contrib |

## Not zoned yet

`test/**`, `docs/**`, `demo/**`, `plans/**`, `assets/**` — product tests and
design docs exist but are not partitioned into map zones on this pass.
Promote via recollection when a surface needs them as anchors.

## How to grow the map

1. Orient: this overview → `map/index.md` → zone card → code.
2. After real work: update touched zones, `atlas stamp <slug…>`, `atlas build`
   / `atlas check` (never stamp during seed alone).
3. Keep globs exclusive across mounted zones (ownership SSOT).

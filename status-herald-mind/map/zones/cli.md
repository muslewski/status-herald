---
type: zone
summary: "HERALD CLI entry — bin/herald → lib/cli.mjs routes curtain verbs (up/down/arm/hook/focus/install/doctor/inspect), status bars, and config print; version from package.json."
tags: [cli, entrypoint]
status: seeded
created: 2026-07-21
updated: 2026-07-21
verifiedAt: unverified
owns:
  routes: []
  testids: []
  globs:
    - "bin/herald"
    - "lib/cli.mjs"
    - "lib/version.mjs"
  tools: []
depends: []
invariants: []
skills: []
related: []
sources: []
---

## What this is

Public command surface for **status-herald** (bins `herald` | `status-herald`). `bin/herald` is a one-liner that calls `main(argv)` in `lib/cli.mjs`. That module wires every user-facing verb: curtain lifecycle (`up`/`down` grid, `arm`/`disarm`, `cover`/`reveal`/`focus`, `pause`/`resume`, `hook`), ops (`install`/`uninstall`, `doctor`, `inspect`), status surfaces (`statusline`, `tmux-status`), and `config` / `version`.

## Anchors

- `bin/herald` — npm bin entry (also published as `status-herald`).
- `lib/cli.mjs` — argument routing and process I/O only; domain logic lives in curtain/status modules.
- `lib/version.mjs` — single source of truth; reads `package.json` at runtime.

## Invariants

Seed pass: none claimed. Fail-open hook behavior is owned by [[curtain-core]] / [[curtain-ops]], not the CLI shell.

## Lineage

Inferred from tree + README / AGENTS.md on 2026-07-21 atlas-seed pass.

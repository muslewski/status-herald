---
type: zone
summary: "Curtain ops surface — absolute-path hook install into Claude settings and Grok ~/.grok/hooks, doctor wiring checks, inspect stage-board (fleet rows + fzf session detail)."
tags: [install, doctor, inspect, ops]
status: seeded
created: 2026-07-21
updated: 2026-07-21
verifiedAt: unverified
owns:
  routes: []
  testids: []
  globs:
    - "lib/curtain/install.mjs"
    - "lib/curtain/doctor.mjs"
    - "lib/curtain/inspect.mjs"
  tools: []
depends:
  - "[[config]]"
  - "[[curtain-core]]"
invariants: []
skills: []
related: []
sources: []
---

## What this is

**Install and diagnose** the curtain without owning session truth:

- **install** — wires `UserPromptSubmit` / `SubagentStart` / `SubagentStop` / `Stop` / `Notification` to an **absolute** `"<node>" "<…/bin/herald>" curtain hook` command in `~/.claude/settings.json` (compat path Grok also reads) or native `~/.grok/hooks/herald.json`. Migrates bare `herald` wiring that exits 127 under non-login shells.
- **doctor** — checks tmux, hook wiring (Claude + Grok), resolve of the installed command, session health hints.
- **inspect** — stage-manager board: per-session state, live lease counts, last-hook age; optional fzf drill-in.

These are the first-run and debug UX (`herald curtain install|doctor|inspect`).

## Anchors

Three modules only. Card paint and lease algebra stay out — ops reads opts/wiring and reports.

## Invariants

Seed pass: none. Critical product claim for later stamp: install always rewrites absolute node+bin so hooks never depend on PATH.

## Lineage

Inferred from README install/doctor/inspect demos + module headers on 2026-07-21 atlas-seed pass.

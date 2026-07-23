---
title: "Documentation"
description: "HERALD — tmux curtain cards, denizens, and terminal status surfaces for agent CLIs."
section: home
order: 0
---

# status-herald documentation

**HERALD** is a heads-up engine for terminal status surfaces: tmux **curtain** cards that cover unfocused agent panes, optional **denizens** (ASCII creatures per session), and native **bars** / Claude statusline segments.

Site: [herald.muslewski.com](https://herald.muslewski.com) · npm: [`status-herald`](https://www.npmjs.com/package/status-herald)

## Start here

| Path | For |
|------|-----|
| [Getting started](./getting-started.md) | Install → wire hooks → doctor → arm / grid |
| [Bestiary](./BESTIARY.md) | Signature page — denizens, poses, config |
| [Works with](./works-with.md) | Fleet siblings (sage, oracle, atlas, armory, ferry) |
| [Agent status providers](./AGENT-STATUS-PROVIDERS.md) | Shared filesystem convention (optional peers) |
| [Interop ↔ agentic-sage](./interop-status-herald.md) | COMPACTING / observational compact path |

## Doctrine (short)

1. **Standalone-first** — install only status-herald and curtain + bars still work.
2. **Fail-open** — missing siblings leave gauges/lines empty; nothing hard-errors.
3. **Per-pane honesty** — timers, subs, NEEDS, COMPACTING answer the tab you are looking at.
4. **Open is instant** — focus a card or tab → live session; no click gate.

## Where other knowledge lives

| Kind | Location |
|------|----------|
| **Public product docs** | `docs/` (this tree) |
| **Architecture mind (Atlas)** | [`status-herald-mind/`](../status-herald-mind/) — zones, decisions; specs/plans pipeline |
| **Agent install runbook** | [`AGENTS.md`](../AGENTS.md) |
| **Human README** | [`README.md`](../README.md) |
| **Changelog** | [`CHANGELOG.md`](../CHANGELOG.md) |

Agent design notes under `docs/superpowers/` are historical; new specs/plans go to the mind vault (`status-herald-mind/specs/`, `status-herald-mind/plans/`).

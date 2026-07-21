---
type: zone
summary: "Status surfaces engine — pure segments/gauges/width-drop, compute (transcript/effort), agent-status providers convention, soft bridges to token-oracle and agentic-sage, Claude statusline + tmux status renderers."
tags: [status, segments, providers, bars, bridges]
status: seeded
created: 2026-07-21
updated: 2026-07-21
verifiedAt: unverified
owns:
  routes: []
  testids: []
  globs:
    - "lib/status/**"
  tools: []
depends:
  - "[[config]]"
invariants: []
skills: []
related: []
sources: []
---

## What this is

**Terminal status bars and gauges**, separate from the curtain card:

| Module | Role |
|--------|------|
| `segments.mjs` | Pure segment registry, role→color (tmux/ansi/plain), gauge thresholds, priority width drop |
| `compute.mjs` | Transcript math, session discovery, effort meta, account usage facade |
| `providers.mjs` | Soft-fail reader for agent-status filesystem convention (schema 1) |
| `bridge-token-oracle.mjs` | Optional ingest of token-oracle forecast / account windows |
| `sage-bridge.mjs` | Optional agentic-sage fleet/zone cache |
| `grok-adapter.mjs` | Grok process/host detection helpers for compute |
| `claude-statusline.mjs` | Claude Code statusline renderer |
| `tmux-status.mjs` | Native herald tmux status bar |
| `side-effects.mjs` | Controlled side effects for surface wiring |

Standalone-first: sibling tools (token-oracle, agentic-sage, llm-armory) light up extras when present; absent → empty segments, no errors. Convention: `docs/AGENT-STATUS-PROVIDERS.md`.

## Anchors

Entire `lib/status/**` tree. Does not own curtain session opts or card paint.

## Invariants

Seed pass: none. Soft-fail / no-throw product stance is the main claim to verify later.

## Lineage

Inferred from README “Works well with” + `lib/status/*` headers on 2026-07-21 atlas-seed pass.

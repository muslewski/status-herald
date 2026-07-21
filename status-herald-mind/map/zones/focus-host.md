---
type: zone
summary: "Focus adapters and host glue — scripts/focus-agent (ghostty-ssh-poll, hammerspoon stream, run dispatcher), Mac Hammerspoon lua spikes, optional systemd unit; external processes that call herald curtain focus."
tags: [focus, adapters, mac, ghostty, systemd]
status: seeded
created: 2026-07-21
updated: 2026-07-21
verifiedAt: unverified
owns:
  routes: []
  testids: []
  globs:
    - "scripts/focus-agent/**"
    - "mac/**"
    - "contrib/**"
  tools: []
depends: []
invariants: []
skills: []
related: []
sources: []
---

## What this is

**Outside the box** drivers for per-tab curtain. The Linux/tmux box never polls frontmost windows itself — it reacts to `herald curtain focus "<title>"`. Focus adapters are any process that (a) learns which terminal tab is frontmost and (b) shells that command (locally or via ssh).

Shipped pieces:

- `scripts/focus-agent/ghostty-ssh-poll.sh` — reference adapter: poll Mac for Ghostty title over ssh.
- `scripts/focus-agent/ghostty-hammerspoon-stream.sh` — event-stream variant.
- `scripts/focus-agent/run.sh` — dispatcher choosing source from config.
- `mac/herald-focus.lua` / `herald-spike.lua` — Hammerspoon helpers on the Mac side.
- `contrib/systemd/status-herald-curtain.service` — optional service unit for keep-alive adapters.

**Contract:** adapters send the **raw** tab title; the box normalizes via `curtain.focus.titleStripPrefixes` (e.g. strip `"[mosh] "`). Pre-stripping on the adapter breaks matching.

## Anchors

Host-side scripts and contrib only. Title strip and focus verb implementation live in [[config]] / [[curtain-core]].

## Invariants

Seed pass: none. Adapter raw-title contract is the rule to stamp later.

## Lineage

Inferred from README per-tab curtain / adapter model + tree on 2026-07-21 atlas-seed pass.

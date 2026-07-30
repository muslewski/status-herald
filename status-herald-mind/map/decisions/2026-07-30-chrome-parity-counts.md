---
type: decision
summary: "Curtain fleet counts must equal host CLI chrome inventory; Grok reconciles from subagents/*/meta.json on settle, not synthetic hook tallies."
date: 2026-07-30
status: accepted
---

# Chrome-parity counts

## Decision

`display_counts(session) ≡ host_cli_inflight_inventory(session)`.

Hooks own state edges (WORKING / NEEDS / …). Host inventory owns subagent/shell numbers.

## Why

Synthetic leases from Pre/Post `spawn_subagent` (especially `syn-spawn-<second>`) inflated the card to 90+ kids while Grok’s TUI showed the real registry. The product already writes `sessions/…/subagents/*/meta.json` with `status: running|completed` — that is the chrome source of truth.

## Consequences

- `lib/status/grok-inventory.mjs` reads metas (+ optional bg shells from updates.jsonl).
- `applySettle` → `applyHostInventory` reconciles leases for non–task_list hosts.
- Claude task_list unchanged (`background_tasks[]`).
- Hierarchy (“2 workflows × 50”) deferred until host groups are readable without guessing.

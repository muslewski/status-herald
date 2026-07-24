---
type: spec
status: active
summary: "Curtain card is non-scrollable; mouse wheel up/down cycles denizens (prev/next) as an easter egg. Consume SGR wheel in the card loop; add prevSpecies + directional cycleDenizen."
tags: [curtain, denizens, easter-egg, mouse]
created: 2026-07-24
updated: 2026-07-24
---

# Curtain scroll → pet easter egg

## Goal

The covered curtain scene must **not scroll**. When the operator scrolls the mouse wheel on the card, **cycle the denizen** instead: **wheel up = previous**, **wheel down = next** (fox ⇄ cat ⇄ owl). Quiet easter egg — no on-card hint.

## Context

- Card loop (`scripts/curtain-card-session.sh`) already enables SGR mouse (`1000/1002/1006`) for corner chrome (× off / ↻ pet).
- Only left-click (`b=0|32`) is handled; other button codes are dropped. Some terminals still scroll pane history / content when wheel is not treated as an app action.
- Pet path exists: `herald curtain pet` → `cycleDenizen` → `nextSpecies` only.

## Behavior

| Input | Result |
|-------|--------|
| Wheel **down** (SGR `b=64`… typical: 64) | Next denizen |
| Wheel **up** (SGR `b=65`) | Previous denizen |
| Click ↻ pet / keys `a`/`p` | Unchanged — **next** only |
| Other click / most keys | Reveal (fail-open) |
| Wheel when denizens off / unarmed | No-op; still no scroll / no reveal |

- Stay on the card (do **not** reveal).
- Bump `@herald_seed` on cycle (existing pet behavior) so pose phase shifts.
- One step per wheel event; no debounce in v1.

## Approach (chosen)

**Card-loop wheel decode → directional pet** (not tmux global binds, not chrome-hit overload).

1. `prevSpecies` pure helper (mirror `nextSpecies`).
2. `cycleDenizen(sess, t, cfg, dir)` with `dir = +1 | -1`.
3. CLI: `pet-prev` alias (and keep `pet` = next).
4. `read_event`: set `IN_KIND=wheel`, `IN_WHEEL=up|down` for SGR wheel buttons; consume event.
5. Main loop: wheel → `chrome_action pet|pet-prev` path without reveal.

## Anti-scroll

- Always **consume** wheel SGR in the card process (never fall through as "ignore → terminal scroll").
- Render already aims at exact `rows`; no new layout work required unless a paint path overflows (out of scope unless reproduced).

## Non-goals

- UI copy for "scroll to pet"
- Reverse keyboard ↻
- Config flag (always on with existing denizen system)
- Touchpad multi-line gestures beyond standard wheel SGR

## Acceptance

- [ ] `prevSpecies` / directional `cycleDenizen` unit-tested
- [ ] Card script contracts: wheel buttons → pet / pet-prev; wheel never reveals
- [ ] Manual: covered card + wheel changes animal, pane does not scroll
- [ ] `herald curtain refresh` picks up new loop on armed sessions

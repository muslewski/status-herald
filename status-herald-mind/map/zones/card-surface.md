---
type: zone
summary: "Curtain card paint — renderCardFrame, themes (classic/minimal/…), Act I theatrics (stage-draw, motes, breathe), Act II denizens bestiary, ANSI helpers, tmux card tick scripts."
tags: [render, themes, theatrics, denizens, card]
status: seeded
created: 2026-07-21
updated: 2026-07-21
verifiedAt: unverified
owns:
  routes: []
  testids: []
  globs:
    - "lib/surfaces/**"
    - "lib/render.mjs"
    - "lib/curtain/themes.mjs"
    - "lib/curtain/theatrics.mjs"
    - "lib/curtain/denizens.mjs"
    - "lib/curtain/denizens-data.mjs"
    - "scripts/curtain-card-loop.sh"
    - "scripts/curtain-card-session.sh"
  tools: []
depends:
  - "[[curtain-core]]"
  - "[[config]]"
invariants: []
skills: []
related: []
sources: []
---

## What this is

**What the user sees** on a covered pane:

- `surfaces/curtain-card.mjs` — framed card layout: state glyph/label, elapsed, subagent/shell/watcher lines, optional model/sage lines, denizen cel + theatrics overlay.
- `themes.mjs` — named themes (`classic` static baseline, `minimal`, …) + per-session theme resolution.
- `theatrics.mjs` — pure Act I motion (stage-draw, spark/motes, NEEDS breathe); rides the card tick loop; classic stays static.
- `denizens.mjs` + `denizens-data.mjs` — pure Act II bestiary: deterministic species per session, tier geometry, art cells.
- `render.mjs` — ANSI/SGR helpers shared with status bars.
- `scripts/curtain-card-*.sh` — per-pane tick loop that re-paints the card window from tmux opts.

Paint modules are mostly pure (inject time); shell scripts bridge to tmux.

## Anchors

Presentation layer only. State/lease truth is [[curtain-core]]; segment bars are [[status-engine]].

## Invariants

Seed pass: none. Likely claim later: `classic` theme is the no-motion regression baseline.

## Lineage

Inferred from curtain-card / themes / theatrics / denizens headers + demo GIFs on 2026-07-21 atlas-seed pass.

---
type: zone
summary: "Config load/merge for status-herald — DEFAULTS (curtain, lease, settle, animation, bars), deep-merge from XDG/HERALD_CONFIG JSON, titleStripPrefixes, themeBySession; missing/bad file never throws."
tags: [config, defaults]
status: seeded
created: 2026-07-21
updated: 2026-07-21
verifiedAt: unverified
owns:
  routes: []
  testids: []
  globs:
    - "lib/config.mjs"
  tools: []
depends: []
invariants: []
skills: []
related: []
sources: []
---

## What this is

**Config substrate** for the whole package. `lib/config.mjs` defines `DEFAULTS` (curtain coverable states, focus adapter settings, autoArm, themes, animation/theatrics knobs, lease/settle TTLs, bar segments) and `loadConfig()` that deep-merges user JSON from `$HERALD_CONFIG` or `~/.config/status-herald/config.json`. Hook-safe: absent or corrupt config returns defaults without throwing.

Also exports helpers used at the focus boundary (`stripTitle` / `globToRe` / `merge`) so adapters and session code share one title-normalization story.

## Anchors

- Single file `lib/config.mjs` — schema-as-defaults, not a separate schema package.
- Path resolution and deep-merge live here; consumers must not re-implement defaults.

## Invariants

Seed pass: none claimed. README contract “missing file or bad JSON ⇒ defaults” is the load-bearing product rule to verify later.

## Lineage

Inferred from `lib/config.mjs` header + README config reference on 2026-07-21 atlas-seed pass.

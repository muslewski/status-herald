---
title: "Works with"
description: "How status-herald fits the muslewski fleet — real interop, not a laundry list."
section: recipes
order: 5
---

# Works with

HERALD is **standalone-first**: curtain cards and native bars work with only this package. Sibling tools light optional extras when present; when absent, those extras stay empty. This page is the short honesty map.

| Package | Relationship to HERALD | Links |
|---------|------------------------|--------|
| **agentic-sage** | Fleet / zone awareness when sage is on `PATH`: optional curtain zone line (`curtain.lines.sageZone`) and bar fleet segment (`bars.segments.sage`) via `sage fleet --json`. Shared observational compact vocabulary: PreCompact → **COMPACTING** (never DONE) — see [interop](./interop-status-herald.md). No hard dependency; both install alone. | [sage.muslewski.com](https://sage.muslewski.com) · [npm](https://www.npmjs.com/package/agentic-sage) · [interop](./interop-status-herald.md) |
| **token-oracle** | Publishes `~/.local/share/token-oracle/forecast.json`. Herald bar account segments (`account5h` / `accountWeekly`) and Claude statusline gauges read it via `bridge-token-oracle.mjs` (`HERALD_TOKEN_FEED` override). Oracle session records can feed curtain model truth when `curtain.lines.model` is on. Without oracle, gauges stay blank. | [oracle.muslewski.com](https://oracle.muslewski.com) · [npm](https://www.npmjs.com/package/token-oracle) |
| **memory-atlas** | Code-verified architecture vaults. This repo’s understanding lives in `status-herald-mind/` (Atlas); public guides live in `docs/`. Recollection keeps both honest. No runtime bar/curtain dependency. | [atlas.muslewski.com](https://atlas.muslewski.com) · [npm](https://www.npmjs.com/package/memory-atlas) |
| **llm-armory** | Launch labels for child sessions. Armory stamps long-TTL session records (model, effort, preset, pid). With `curtain.lines.model: true`, the card can render `model@effort` for armory children. Without armory, optional model lines stay off or empty. | [armory.muslewski.com](https://armory.muslewski.com) · [npm](https://www.npmjs.com/package/llm-armory) |
| **mossferry** | Remote tmux/mosh “ferry” to the machine where your fleet (and herald curtains) actually run. HERALD lives on the **app host**; ferry is how you get there from a laptop. No code bridge — adjacency of workflow only. | [mossferry.muslewski.com](https://mossferry.muslewski.com) · [npm](https://www.npmjs.com/package/mossferry) |

Shared filesystem convention for optional peers (heartbeats, session records): [Agent status providers](./AGENT-STATUS-PROVIDERS.md).

## Rules for authors

1. **Contextual first** — when documenting a feature that displays or depends on a sibling, say so on that page (one clear sentence + link).
2. **Update this table** when you add or remove a real edge.
3. **Do not invent** — if code does not wire it, do not claim it.

## See also

- [Getting started](./getting-started.md) — bars/gauges callout
- [Bestiary](./BESTIARY.md) — COMPACTING denizen faces
- [README — Works well with](../README.md#works-well-with)

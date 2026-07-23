---
title: "Interop ↔ agentic-sage"
description: "Pointer to the observational compact contract between status-herald and agentic-sage."
section: reference
order: 40
---

# Interop: status-herald ↔ agentic-sage

**This file is a pointer.** The canonical observational contract lives in the sibling
[agentic-sage](https://github.com/muslewski/agentic-sage) repo:

- **Primary:** `agentic-sage/docs/interop-status-herald.md`
- **Strategy / deliberation:** `agentic-sage/advisor-plans/026-sage-herald-interop-strategy.md`
- **Summary:** `agentic-sage/CONVENTIONS.md` (interop section)

## What herald must honor (compact path)

- `PreCompact` → enter **COMPACTING** (distinct face, never DONE).
- Drain on PostCompact / idle_prompt / Stop (per herald’s own rules for subs).
- Fail-open, default-OFF, zero hard dependency on sage.

## Expect divergence

Herald answers **per-pane UI honesty** (timers, subs, NEEDS). Sage answers **fleet hotness /
collision**. They will differ on subs-after-Stop, stall, and storage identity. That is by design.

## No bridges by default

Do not shell out to `sage` or read sage session files on the court hot path unless a later plan
explicitly adds an experimental, measured bridge. Both installs work alone.

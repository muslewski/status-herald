# Cross-Project Convention: Session State (Reference)

**Primary source of truth:** `../agentic-sage/docs/interop-status-herald.md` (or the canonical location in the agentic-sage repo at https://github.com/muslewski/agentic-sage/blob/main/docs/interop-status-herald.md).

This file is a short mirror / pointer. All details, tables, pseudocode, rules, and adoption checklists live in the primary document.

## Quick Summary (from primary)

- **Canonical phases:** Herald `STATES = {IDLE, WORKING, COMPACTING, DONE, NEEDS}`. Sage: `liveness` (idle/working/stalled/dead/closed) + optional `phase` (currently only `'compacting'` which forces liveness=working).
- **Hot vs UI:** Sage owns coarse fleet-judgment hotness (`isHot = liveness==='working' || phase==='compacting'`) + territory/claims. Herald owns fine UI state, timers, sub counts, cards/curtains.
- **Compacting rule:** Both treat `PreCompact` as entering the distinct compacting face. `PostCompact` (sage) or next idle/Stop/idle_prompt (herald) drains it. Never show compacting as DONE.
- **Key events:** See mapping table in primary (UserPromptSubmit/PostToolUse/Stop/PreCompact/PostCompact/Notification/Subagent*).
- **Consumption:** Herald may read sage records or `sage board --json` / `sage fleet --json` / `sage war --json` (fail-open). Sage may optionally surface `herald_state`.
- **Guarantees:** Independent operation. Additive only. Identical hook sequence must yield same phase/busy decision on the compact/hot path.

## Local Files (status-herald)

- `lib/curtain/state.mjs` — `STATES`, `computeElapsed`
- `lib/curtain/hook.mjs` — `nextState`, `parseHookPayload`, `resetsElapsed`
- `lib/curtain/session.mjs` — `stampFromHook`, `arm`, coverable logic
- `lib/surfaces/curtain-card.mjs` — render for states incl. COMPACTING
- Tests: `test/hook.test.mjs`, `test/curtain-card.test.mjs`, etc.

When editing state transitions or compact handling here, sync the primary interop doc and run the shared-sequence test recommendation.

**Adoption (herald side):** See the full checklist in the primary document under "For status-herald".

Last sync: 2026-07-13.
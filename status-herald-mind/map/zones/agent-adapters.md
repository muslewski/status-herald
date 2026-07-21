---
type: zone
summary: "Hook payload adapters — normalize Claude Code (hook_event_name) and Grok Build (hookEventName, approval_required) into one event shape; shared synthetic-prompt guards; index dispatches host kind."
tags: [adapters, claude, grok, hooks]
status: seeded
created: 2026-07-21
updated: 2026-07-21
verifiedAt: unverified
owns:
  routes: []
  testids: []
  globs:
    - "lib/curtain/adapters/**"
  tools: []
depends: []
invariants: []
skills: []
related: []
sources: []
---

## What this is

**Agent CLI interoperability** for curtain hooks. Claude Code and Grok Build emit similar events with different field names and notification enums. `adapters/` turns raw stdin JSON into one normalized event object consumed by `hook.mjs` / `stampFromHook`:

- `claude.mjs` — snake_case Claude payload paths.
- `grok.mjs` — camelCase Grok fields; `approval_required` → needs; subagent synthesis when no task list.
- `shared.mjs` — common helpers (e.g. synthetic UserPromptSubmit detection).
- `index.mjs` — host detection + `normalizePayload`.

Multi-agent by design: first-class for Claude + Grok, neutral for others once a payload can be normalized.

## Anchors

`lib/curtain/adapters/**` only — no I/O, no tmux. Pure field mapping so host-specific quirks do not leak into lease/settle algebra.

## Invariants

Seed pass: none claimed. Product rule “hooks fail open / unparseable → null” is enforced in [[curtain-core]] `hook.mjs`.

## Lineage

Inferred from `lib/curtain/adapters/*`, AGENTS.md Grok runbook, README subagent/hostkind prose on 2026-07-21 atlas-seed pass.

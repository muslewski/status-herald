# Chrome-parity counts — Design

- **Date:** 2026-07-30
- **Status:** Approved
- **Scope:** Curtain / inspect subagent·shell·monitor counts must match the host CLI terminal chrome
- **Branch:** `fix/chrome-parity-counts`

## 1. Problem

status-herald often shows inflated fleet counts (e.g. **90 subagents · 1 shell** while the open Grok/Claude TUI shows ~25 real kids). Users treat the host CLI header as the only ground truth; Herald was reconstructing a second inventory from hook edge events + TTL leases.

Root causes (Grok-heavy):

1. **Synthetic lease accumulation** — `spawn_subagent` PreToolUse + PostToolUse grant leases; missing ids become `syn-spawn-<second>` and stack.
2. **No authoritative Grok task list on Stop** — Claude reconciles from `background_tasks[]`; Grok does not.
3. **TTL + activity touch** — completed kids keep counting until expire/leak settle.
4. **SubagentStop id mismatch** — wrong `syn-*` released; real id remains.

Claude path with `background_tasks[]` is already close to chrome; Grok path freelances.

## 2. Locked decision

| # | Decision |
|---|----------|
| D1 | **One truth:** `display_counts(session) ≡ host_cli_inflight_inventory(session)`. Match Claude Code / Grok Build terminal chrome, not a parallel model. |
| D2 | **Hooks own state edges** (WORKING / NEEDS / COMPACTING / DONE). **Host inventory owns counts**. |
| D3 | **Approach B** — dual path: reactive hooks + settle/card-tick reconcile from host files. No TUI scraping. |
| D4 | **v1 flat counts** — subagents / shells / monitors as today. Hierarchical “2 workflows × 50” deferred until host inventory exposes groups we can read without guessing. |
| D5 | Soft-fail always; missing inventory → keep last good snapshot, never invent new `syn-*` growth on tick. |

## 3. Host inventory sources

### 3.1 Claude Code

| Kind | Source |
|------|--------|
| subagent / shell / monitor / workflow | Hook payload `background_tasks[]` (types already in adapters) |
| Between events | Last reconcile snapshot; do not grow from bare main-agent PreToolUse |

`type: workflow` continues to count with monitors (Claude’s typing), not shells.

### 3.2 Grok Build

| Kind | Source |
|------|--------|
| **subagents** | `~/.grok{,-profiles/*}/sessions/<encodeURIComponent(cwd)>/<sessionId>/subagents/*/meta.json` where `status === "running"` |
| **shells** | Parent session `updates.jsonl`: open `task_backgrounded` / in-progress bg tool calls not yet completed (best-effort; soft-fail → 0 or prior) |
| **watchers / monitors** | Existing classifiers (`/loop`, `scheduler_*`, `monitor`); not inflated from spawn tools |

Session bind: `@herald_agent_pid` (and/or pane pid) → entry in any `active_sessions.json` under default `~/.grok` and `~/.grok-profiles/*` → `{session_id, cwd, home}`.

Official layout (Grok README): `subagents/` under the session dir is the child registry the product already maintains.

## 4. Architecture

```
Claude/Grok CLI  ──writes──►  host inventory
       │                         │
       │ hooks                   │ files / task list
       ▼                         ▼
 stampFromHook (state)     applyHostInventory (counts)
       │                         │
       └──────────► @herald_* ◄──┘
                      │
                 curtain card / inspect
```

### 4.1 New module

`lib/status/grok-inventory.mjs` (pure reads, injectable fs/home for tests):

- `listGrokHomes(homedir)` → `[~/.grok, ...profiles]`
- `findActiveByPid(pid, homes)` → `{ home, sessionId, cwd, pid } | null`
- `sessionDir(home, cwd, sessionId)` → path (reuse `grokSessionDir`)
- `listSubagentMetas(sessionDir)` → `{ id, status, type, description }[]`
- `runningSubagentIds(sessionDir)` → `string[]`
- `openBgShellIds(sessionDir, opts?)` → `string[]` (updates.jsonl best-effort)
- `inventoryForPid(pid, opts?)` → `{ subagentIds, shellIds, source: "grok-meta" } | null`

### 4.2 Session wiring

In `applySettle` (already called every card-loop second via `herald curtain settle`):

1. Existing quiet/leak settle.
2. **New:** if host looks Grok-capable (agent pid resolves in active_sessions **or** `@herald_host_kind` is synthesis/hybrid and pid maps), call `inventoryForPid` and `reconcile` subagent (+ optional bg_shell) leases to that exact id set with fresh exp.
3. Claude task_list hosts: **do not** overwrite from Grok files; hooks remain authority.

Also call the same reconcile from `stampFromHook` after lease mutations when a Grok inventory snapshot is available (cheap: only if session dir known), so counts heal without waiting a full second.

### 4.3 Stop synthetic inflation

In `stampFromHook` for spawn tools without stable id:

- PreToolUse → grant at most one provisional id: `syn-spawn-pending` (idempotent).
- PostToolUse with `toolTaskId` / agent id → release provisional, grant real id.
- Never use `syn-spawn-${nowSec}` (second-granularity stacking).

SubagentStart with real `agentId` remains grant-by-id (idempotent).

### 4.4 Display

No card layout change required for v1 — `countLive` already feeds `subagents` / `shells` / `watchers` lines. Inspect may show `source=grok-meta|claude-tasks|leases`.

## 5. Failure modes

| Case | Behavior |
|------|----------|
| No active_sessions / pid dead | Skip host reconcile; leases stand |
| meta.json corrupt | Soft-skip that child |
| All metas `completed` | reconcile subagents → `[]` (chrome empty) |
| Host `running` zombie | Trust host (same as chrome) |
| Claude empty Stop distrust | Unchanged |

## 6. Out of scope (v1)

- Hierarchical workflow tree on the card
- TUI ANSI scraping
- Codex / Cursor inventory readers (adapter slot only)
- Changing WORKING settle policy beyond count authority
- agent-status schema extension for inflight (optional later)

## 7. Verification

- Unit: 25 running + 100 completed metas → `runningSubagentIds.length === 25`
- Unit: Pre+Post spawn without id → still 1 provisional until meta reconcile
- Unit: `applySettle` with fake inventory overwrites 90 syn leases → 25
- Live: open Grok fleet; card matches TUI header ±0 on subagent count
- Full `npm test` + lint green

## 8. Atlas

Zones touched on finish: `status-engine` (inventory reader), `curtain-core` (settle reconcile + spawn id fix). Spec lives here; recollection updates those zone cards.

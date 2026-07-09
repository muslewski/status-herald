# Plan 013 — Agent-hierarchy awareness across surfaces

**Status**: curtain half DONE (shipped); statusline + tmux-bar halves TODO.

A Claude Code session is not one agent. It is a main agent plus a changing
set of subagents and background shells. Every HERALD surface currently
renders as if it were one agent, and every one of them is wrong in the same
way. The curtain's failure was the visible one; the statusline and tmux bar
will fail identically once they ship.

## The evidence (measured, not assumed)

Taken from `~/.local/share/token-forecast/events/*.jsonl`, which records
every Claude Code hook payload verbatim. Five days, 289 `Stop` events.

| Claim | Measurement |
|---|---|
| `Stop` does not mean "work finished" | 62 of 95 `Stop`s on 2026-07-09 fired with `background_tasks` still running: 25 with a subagent, 44 with a shell |
| `Stop` fires once per user prompt | 0 of 289 `Stop`s followed another `Stop` without an intervening `UserPromptSubmit` |
| A turn resumed by a completing task emits no `Stop` | corollary of the above; the agent wakes, works, and answers in silence |
| Subagents never fire `Stop` | 0 of 95 `Stop`s carried an `agent_id`; the binary logs `Converting Stop hook to SubagentStop for ${n} (subagents trigger SubagentStop)` |
| `SubagentStop` is not a reliable "main resumed" signal | an internal, unattributed one trails ~2s after almost every `Stop` (90 of 91 carry no `agent_id`) |
| `SubagentStop` may list itself as still running | 68 of 295 include their own `agent_id` in `background_tasks` |
| `Notification` is two different events | `notification_type`: `idle_prompt` (65) vs `permission_prompt` (30) |
| `idle_prompt` is the only end-marker a resumed turn sends | 97 of 153 `idle_prompt`s follow no `Stop` at all |
| `idle_prompt` can fire behind an unanswered permission prompt | 1 of 69 — so it must never clear `needs` |
| Hooks are re-read per event, not snapshotted at session start | a session whose `claude` pid started 17:08 ran the freshly-installed command at 19:52, 96s after `install` rewrote `settings.json` |
| `Notification` carries no `background_tasks` | its only non-envelope keys are `message` and `notification_type` |
| `idle_prompt` fires while subagents are still running | eventizer: `Stop` 20:07:22 with 3 running subagents, `idle_prompt` 20:08:22 — main was idle *because* it was waiting on them |

There is **no** `TurnStart` hook (0 occurrences in the 2.1.205 binary; a
`TaskCreated`/`TaskCompleted` pair exists but tracks the task list, not
background shells). There is no event at all when a background shell exits.

## What the payload gives us

`Stop` and `SubagentStop` carry `background_tasks[]` — `{id, type, status,
description, agent_type?, command?}` with `type` ∈ `subagent | shell`.
`SubagentStart`/`SubagentStop` carry `agent_id`, `agent_type`, and
`agent_transcript_path`. That is enough to know, at any moment, how many
subagents and how many shells a session has in flight, and what each is.

## Shipped: the curtain (lib/curtain/hook.mjs)

One payload-aware command, `herald curtain hook`, on `UserPromptSubmit`,
`SubagentStart`, `SubagentStop`, `Stop`, `Notification`. It reads the event's
JSON on stdin, because the event *name* cannot express the difference between
"the turn ended" and "the work finished".

- `Stop` + subagents running → **WORKING** (a subagent keeps main busy)
- `Stop` + only shells running → **DONE**, annotated `· 1 shell in bg`
  (a CI watch does not hold you up; you can move to the next thing)
- `SubagentStop` → state unchanged, in-flight counts refreshed
- `Notification/permission_prompt` → **NEEDS**
- `Notification/idle_prompt` → **DONE**, unless already **NEEDS**, and unless
  subagents are still in flight — a `Notification` payload has no
  `background_tasks` (its only keys are `message` and `notification_type`), so
  this rule reads the counts stored by the last event that had them

Session-scoped tmux options: `@herald_state`, `@herald_since`,
`@herald_bg_subagents`, `@herald_bg_shells`.

**Known latency**: a turn resumed by finishing subagents holds WORKING until
`idle_prompt` fires (~60s after it truly goes idle). Being 60s late to DONE
is strictly better than being 60s early — early is what sent you to a tab
that was still working. Revisit if Claude Code ever ships a turn-start hook.

## TODO: statusline (Plan 005 surface)

The operator's report: *"when I am entering some subagent session I am still
seeing data of that main one."* The `statusLine` command receives the **main
session's** payload regardless of which agent's transcript is on screen.

Open questions to settle before building:

1. Does the statusline payload expose `agent_id` / `agent_transcript_path`,
   or any marker of which agent the user is currently viewing? (Not answered
   by the 2.1.205 binary; `executeStatusLineCommand` exists, its schema was
   not located. Verify against the live payload — dump it, don't guess.)
2. If it does not, can the surface infer it from the session's tmux options,
   which `herald curtain hook` already keeps current?
3. What *should* a statusline show for a session with 3 subagents in flight —
   the main agent's context/cost, the aggregate, or the focused agent's?

## TODO: tmux status bar (Plan 005 surface)

Same defect, same fix shape: the bar must read
`@herald_bg_subagents` / `@herald_bg_shells` / `@herald_state` and change
context with the agent being viewed, not the session that owns the pane.

The tmux options are already written by the curtain hook, so the bar needs
no new plumbing — only a segment that reads them.

## Design decision (recorded so nobody re-litigates)

**Hooks are folded, not mapped.** The pre-payload wiring mapped one event
name to one state (`Stop → done`). That is unfixable in principle: the same
event name means different things depending on what is still running. Every
future surface must take `nextState(current, payload)` as its contract, not
`stateFor(eventName)`. `install` migrates the old hooks away rather than
leaving both to fight over `@herald_state`.

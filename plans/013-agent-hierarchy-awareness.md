# Plan 013 — Agent-hierarchy awareness across surfaces

**Status**: curtain half DONE (shipped); statusline + tmux-bar halves TODO.

An agent session (Claude Code, Grok Build, etc.) is not one agent. It is a
main agent plus a changing set of subagents and background shells. The curtain
(now generalized) uses hook payloads (or synthesized counts) so that
`● WORKING` vs `✅ DONE` is accurate across agents. Statusline/tmux-bar
halves follow the same normalized model.

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

## Shipped: reliability hardening (2026-07-10)

The curtain worked for some Claude sessions and not others, and not for Grok at
all. Root-caused with a deterministic reproduction, not a guess:

| Claim | Proof |
|---|---|
| The hook was wired as the bare token `herald curtain hook` | both `~/.claude/settings.json` and `~/.grok/hooks/herald.json` |
| A bare command fails in a stripped hook environment | `env -i PATH=/usr/bin:/bin sh -c 'herald curtain hook'` → **exit 127** |
| The absolute form works there | `"<node>" "<bin/herald>" curtain hook` under the same env → **exit 0**, full hook body runs |
| Every other tool in the same hook arrays already wires absolute node | token-forecast, sage: `"/abs/node" "/abs/script"` |

`herald` resolves only via nvm's shim dir. Grok's standalone binary and some
Claude launch contexts (non-login shell, systemd, mosh) do not carry it, so the
hook exited 127 before any code ran — and because hooks fail open, silently. The
card then froze on whatever state it last saw.

**Fixes shipped:**

- **Absolute wiring** (`lib/curtain/install.mjs`): `install` resolves the running
  node's `execPath` + this package's `bin/herald` and writes
  `"<node>" "<bin/herald>" curtain hook`. It migrates any prior wiring — bare, or
  stale-absolute from a past node — so re-running install self-heals a node
  upgrade. tmux still resolves from `/usr/bin`, unaffected.
- **`doctor` resolution check**: reports per host whether the wired command is
  absolute, on disk, and current — turning the silent 127 into a visible ✗.
- **id-set subagent tracking** (`lib/curtain/session.mjs`): subagents are a SET of
  ids (`@herald_bg_subagent_ids`), not an integer. A counter lost an increment
  when a main agent dispatched several subagents at once and never drained a
  leak; a set is idempotent and `Stop`'s task list overwrites it, so any desync
  self-heals at the next turn end.
- **Heartbeat + inspect + capture** (`lib/curtain/debug.mjs`, `herald curtain
  inspect`): every hook stamps `@herald_last_hook`; `inspect` shows per-session
  state, in-flight counts, and heartbeat age; `HERALD_CURTAIN_DEBUG` or a
  `capture.on` sentinel logs raw payloads so a host's real shape is captured, not
  guessed.

Verification: hook fired live through the new wiring (`inspect` showed
`last-hook=68s ago` on a session whose agent never restarted); the full hook body
ran under `env -i PATH=/usr/bin:/bin` where the bare command gave 127.

## Grok payload shape (measured 2026-07-10, no longer a guess)

Captured from a live Grok Build session via the capture sentinel above:

```
keys: hookEventName, sessionId, cwd, workspaceRoot, timestamp,
      transcriptPath, promptId, reason|prompt
hookEventName: "stop" | "user_prompt_submit"   (camelCase KEY, snake_lower VALUE)
background_tasks: ABSENT on Stop
notification_type: absent in the samples seen
```

So on Grok: `normalizeEventName` maps the snake-lower values correctly, `Stop`
carries no task list (the id-set synthesis from `SubagentStart`/`SubagentStop` is
the only subagent path), and basic WORKING/DONE is confirmed working live. Still
unobserved and therefore still best-effort: whether Grok emits `subagent_start`/
`subagent_stop`/`notification` at all. Re-enable capture on a Grok run that
dispatches subagents to settle it.

## Shipped: compaction state + worked clock + flicker (2026-07-11)

Three operator-reported gaps, root-caused from the recorded event log:

1. **Compaction read as DONE.** `PreCompact` is a real Claude Code hook (fires
   with `trigger: manual|auto`), but it was not in `EVENTS`, so herald never
   observed a compaction — the card sat on the previous turn's DONE for the whole
   minute it ran. Fixed by wiring `PreCompact` and adding a `COMPACTING` state
   (`⟳ COMPACTING`). It is coverable, and the next event drains it: `idle_prompt`
   when compaction ends, or the resumed turn's `Stop`. `stampFromHook` preserves
   the in-flight set across it, so an auto-compact mid-turn does not lose counts.

2. **No "worked" duration on DONE.** `@herald_since` keeps ticking after a turn
   ends, so it could not be shown as a finish time. Now `stampFromHook` freezes
   `@herald_worked = now - since` on the transition *into* DONE only (a later
   `idle_prompt` must not recompute and inflate it), and the DONE card stacks
   `worked m:ss` above the focus hint. `arm` clears it with the other counts.

3. **Row flicker.** `renderCardFrame` prepended `\x1b[2J` (full-screen erase)
   every 1s frame: the screen blanked, then the text drew back in. Replaced with
   home-cursor (`\x1b[H`) + overwrite-in-place + erase-below (`\x1b[J`) — an
   unchanged cell is rewritten with its own value, so nothing visibly flickers.

Rollout note: the render-path fixes (flicker, COMPACTING card) reach existing
card windows automatically — `herald` symlinks into the repo and the loop re-runs
`herald render` each tick. The `worked` line needs the loop itself respawned
(it reads the card script once at window creation), so `curtain refresh` respawns
each card window in place, preserving every `@herald_*` option and re-covering a
covered session. Non-destructive: only the hidden `_curtain` window is replaced.

Two follow-ups from the same operator, same day:

4. **Doubled label ("DONE" twice, one below the other).** Once 2J was gone, the
   `✅` glyph exposed a latent bug: `padCenter` measures width by codepoint, but
   `✅` is two terminal cells, so its row was one cell too wide and wrapped, which
   scrolled the block and left the old label as a ghost. `renderCardFrame` now
   brackets the paint with wrap off/on (`\x1b[?7l` / `\x1b[?7h`, DECAWM) so an
   over-wide row is clipped at the margin instead of wrapping -- the technique
   real full-screen TUIs use, and it covers any wide glyph, not just this one.

5. **False NEEDS YOU while still working.** `nextState`'s `Notification` arm
   defaulted every unrecognized type to NEEDS. Grok fires `task_complete` when a
   background task finishes -- 470 in three days across executor sessions
   (token-oracle, agentic-sage/muslewski-v3) -- and each one flipped a working
   card to a false "needs you". Corrected the model: NEEDS means *blocked on the
   user* and comes only from a permission/approval prompt (or a surfaced
   `agent_error`); `idle_prompt` stays the end-marker; `task_complete`,
   `push_notification`, and anything unrecognized are informational and return
   `cur`. The real WORKING/DONE call is Stop + subagent counts, never a status ping.

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

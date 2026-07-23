# HERALD Curtain — Design Spec

**Date:** 2026-07-08
**Status:** approved design → ready for implementation plan
**Project:** status-herald (HERALD)
**Phase:** 1 of 2 (Curtain now; Grind Mode is phase 2, separate spec)

## 1. Summary

Curtain is HERALD's first **takeover surface**: instead of rendering a
one-line status bar, it seizes an entire tmux pane and covers a working AI
session with an opaque status card, so the operator stops doom-watching the
AI scroll and gets pushed back to their own work. Focus a card to open the
real session; leave it and (while the AI is still working) it re-covers.

This graduates HERALD from *status line* to *status surface that can seize a
whole pane*. It reuses HERALD's render core and provider model, and adds one
genuinely new subsystem: a tmux orchestrator (`herald curtain`).

Context: the operator runs multiple Claude Code sessions in a tmux grid on
Manjaro, viewed from a MacBook via `ssh manjaro -t 'tmux attach'` in Ghostty.
Everything in this spec is **Manjaro-side** — no Mac hop, because each Claude
process already sees its own `$TMUX_PANE`, giving a free, exact
pane↔session mapping.

## 2. Goals / Non-goals

**Goals**
- While an unfocused pane's AI is working, cover it with an opaque card
  (`● WORKING m:ss` / `✅ DONE` / `⚠ NEEDS YOU`). The AI keeps running.
- Focusing a covered pane reveals the live session; unfocusing it while still
  working re-covers it.
- Never cover the pane the operator is actively focused on.
- Build only the HERALD core this needs (vertical slice); lay real HERALD
  foundations, defer unrelated core.

**Non-goals (this phase)**
- Grind Mode (Mac Hammerspoon idle-nag) — phase 2, its own spec.
- HERALD's statusLine bar, preset menu, zellij/kitty surfaces — deferred core,
  not required by Curtain.
- Dynamic grids (add/remove panes at runtime), N>2 uneven layouts,
  multi-client focus. v1 targets a fixed 2-slot equal grid (configurable N,
  tested at 2).

## 3. Scope — vertical slice of HERALD

**In scope (build):**
- `lib/render.mjs` — minimal render core slice (segments → ANSI), enough for
  the card. (This is the plan-002 core, trimmed.)
- `lib/surfaces/curtain-card.mjs` — new full-pane surface.
- `herald curtain` orchestrator (`lib/curtain/*.mjs` + `bin/herald` verb) —
  the tmux show/hide/focus subsystem.
- Hook scripts (Claude Code + tmux) + safe installer/doctor for curtain.
- State carried on tmux pane options (no new provider code needed beyond a
  `command`-style read; see §6.3).

**Out of scope (defer to existing HERALD plans):**
- `--surface claude-code` / `--surface tmux` status-line surfaces (plan 005).
- Preset files + menu (plans 006/007).
- Provider layer breadth (plan 004) — Curtain uses only tmux pane options.

## 4. Architecture

```
Claude Code hooks (run INSIDE each live pane, $TMUX_PANE = that pane)
   UserPromptSubmit → working    Stop → done    Notification → needs
        │
        ▼
  herald curtain event <state>          ← writes @herald_state/@herald_since
        │                                  on the live pane; swaps if unfocused
        ▼
  tmux orchestrator (swap-pane between live pane and its peer curtain pane)
        │
   ┌────┴──────────────┐
   ▼                   ▼
 window 0 (grid)     window _holding (mirror)
 shows either the    holds the hidden peer
 live OR the card    (live keeps running here
 per slot            when covered)
        ▲
        │ pane-focus-in / pane-focus-out (tmux global hooks)
   reveal / re-cover

curtain card content = herald render --surface curtain-card
   (1 Hz loop in the curtain pane, reads peer's @herald_state)
```

Four pieces:

1. **`curtain-card` surface** — full-pane centered render. Reuses render core.
2. **State on pane options** — hooks stamp `@herald_state` + `@herald_since`
   on the live pane; the card loop reads them via the peer link.
3. **`herald curtain` orchestrator** — tmux session/holding-window setup,
   swap-pane show/hide, focus reveal/re-cover. HERALD's first orchestrator.
4. **Hooks + installer/doctor** — Claude hooks + tmux focus hooks, wired by a
   safe non-clobbering installer (ports plan-005 merge behavior).

## 5. tmux layout model

- Session `grid`.
  - **Window 0** (`grid`) = the visible layout, tiled into **N slots**
    (v1: N=2, one equal split). Each slot initially shows a **live pane**
    running the launch command (default `claude`).
  - **Window `_holding`** = a **size-mirror** of window 0, one **curtain
    pane** per slot, each running the card render loop. Not selected, so
    never seen — until a swap brings one into window 0.
- **Pairing** (set once at setup, stored as tmux user options on each pane):
  - live pane: `@herald_role=live`, `@herald_slot=<n>`, `@herald_peer=<curtain pane id>`
  - curtain pane: `@herald_role=curtain`, `@herald_slot=<n>`, `@herald_peer=<live pane id>`
- **Cover slot n** = `swap-pane -s <live> -t <curtain>` (only if the live pane
  currently sits in window 0). **Reveal** = swap back + `select-pane` to live.
- **Position query** (no bookkeeping flag): a pane's current window tells
  whether it's shown. `tmux display -p -t <pane> '#{window_id}'`; window 0 ⇒
  shown, `_holding` ⇒ hidden. Idempotent — never double-swap.
- **Why mirror the layout:** swap-pane between same-size panes is
  size-preserving → **no Claude TUI reflow/flicker**. v1 uses equal splits so
  both windows stay mirrored under terminal resize automatically.
- **Pane IDs are stable across swaps** — `%5` stays glued to its process
  wherever displayed, so `$TMUX_PANE` inside Claude never changes and hooks
  always target the right pane.

## 6. Components

### 6.1 `curtain-card` surface (`lib/surfaces/curtain-card.mjs`)

- Inputs (CLI): `--state working|done|needs|idle`, `--since <epoch>`,
  `--cols`, `--rows`, `--color always`.
- Output: `rows` lines painting a full black screen (`\e[2J\e[H`, hide cursor
  `\e[?25l`, every cell black-bg), with a centered block:
  - `working` → `●  WORKING   m:ss` (elapsed = now − since), accent color.
  - `done` → `✅  DONE — focus to open`.
  - `needs` → `⚠  NEEDS YOU`, alert color.
  - `idle` → dim `—` (rarely covered; safe default).
- Color is forced on (the card owns a real TTY pane); does NOT go through the
  statusLine `pipeColor` non-TTY gate.
- Pure layout function `renderCard(state, elapsedSec, cols, rows) → string[]`
  is unit-testable in isolation.

### 6.2 Render core slice (`lib/render.mjs`)

Minimal segment→ANSI helpers the card needs (color wrap, width/pad, center).
This is the plan-002 core trimmed to what Curtain requires; later plans extend
it for line surfaces. Keep the same exported shape so plan 002 supersedes,
not replaces.

### 6.3 State carrier

- Truth lives on the **live pane** as tmux user options:
  `@herald_state` ∈ {idle, working, done, needs}, `@herald_since=<epoch>`.
- Hooks run inside the live pane (`$TMUX_PANE` = live id) → they set these
  directly: `tmux set -p -t "$TMUX_PANE" @herald_state working @herald_since $(date +%s)`.
- The card loop runs in the **curtain pane**; it reads the peer (live) pane's
  options:
  ```sh
  peer=$(tmux show -p -t "$TMUX_PANE" -v @herald_peer)
  state=$(tmux show -p -t "$peer" -v @herald_state)
  since=$(tmux show -p -t "$peer" -v @herald_since)
  herald render --surface curtain-card --state "$state" --since "$since" \
    --cols "$(tput cols)" --rows "$(tput lines)" --color always
  sleep 1
  ```
  This is HERALD's `command`-provider pattern (read via `tmux show`), so no
  bespoke provider code is required for the slice.

### 6.4 `herald curtain` orchestrator

Subcommands (`bin/herald curtain …`):
- `up [--slots N] [--cmd 'claude']` — create session `grid`: tile window 0
  into N live panes running `cmd`; build `_holding` mirror with N card-loop
  panes; set pairing options; install tmux global focus hooks; set
  `mouse on`, `focus-events on`. Idempotent (no-op if `grid` exists).
- `down` — kill session `grid` (and holding window).
- `event <working|done|needs>` — called by Claude hooks. Stamp state on
  `$TMUX_PANE`; if the live pane is **not focused**, cover it (swap peer in);
  if focused, only stamp (so a later focus-out covers it).
- `focus-in <pane_id>` / `focus-out <pane_id>` — called by tmux hooks
  (§6.5). Reveal on focus-in of a curtain pane; re-cover on focus-out of a
  live pane whose state is working/done/needs.
- `status` — print per-slot state table (debug).

**Focus test** ("is this live pane focused?"): pane is focused iff
`#{pane_active}` && `#{window_active}` && the session has an attached client.
Computed via `tmux display -p`.

### 6.5 Hooks

**Claude Code hooks** (wired into `~/.claude/settings.json`, global). Each is
a one-liner guarded by `[ -n "$TMUX_PANE" ] || exit 0`, then
`herald curtain event <state>`; must **never** break Claude (always exit 0):
| Hook | Event |
|---|---|
| `UserPromptSubmit` | `working` |
| `Stop` | `done` |
| `Notification` | `needs` |

`Notification` audio is already handled by the existing
`~/.claude/hooks/ping-mac-music.sh` — Curtain adds only the visual card, no
duplicate ping.

**tmux global hooks** (set at `up`):
```
set -g focus-events on
set -g mouse on
set-hook -g pane-focus-in  'run-shell "herald curtain focus-in  #{pane_id}"'
set-hook -g pane-focus-out 'run-shell "herald curtain focus-out #{pane_id}"'
```

### 6.6 Installer / doctor

- `herald curtain install` / `uninstall` — merge/remove the Claude hook lines
  in `~/.claude/settings.json` using the plan-005 safe-merge contract: back up
  to `<file>.bak` before first write; abort untouched on malformed JSON; skip
  if already present; never reorder unrelated keys. tmux hooks are set live by
  `up` (not persisted to `~/.tmux.conf` unless `--persist`).
- `herald curtain doctor` — check: inside tmux? `focus-events`/`mouse` on?
  hooks present in settings.json? `herald` on PATH? session `grid` healthy
  (N live + N curtain panes, pairing intact)? Print a checklist.

## 7. Data flow (end-to-end)

1. Operator submits a prompt in slot 2 → Claude `UserPromptSubmit` hook →
   `herald curtain event working` → stamps `working`/`since` on the live
   pane. Slot 2 is focused → left visible (operator is watching).
2. Operator clicks slot 1 to work there → tmux `pane-focus-out` on slot 2's
   live pane → state is `working` → **cover slot 2** (swap card in). Slot 2 is
   now a `● WORKING 0:03` black card; its Claude keeps running in `_holding`.
3. Slot 2's AI finishes → `Stop` hook → `event done` → card flips to
   `✅ DONE — focus to open` (already covered, just restamps).
4. Operator clicks slot 2's card → `pane-focus-in` on the curtain pane →
   swap live back into window 0 + `select-pane` → live session revealed,
   focused; next prompt restarts the cycle.

## 8. Config

`herald curtain` config (small): CLI flags override an optional
`~/.config/herald/curtain.json`:
- `slots` (default 2), `cmd` (default `claude`), `session` (default `grid`).
- Card theme: glyph + accent color per state (working/done/needs/idle).
No snooze/threshold here — those belong to Grind (phase 2).

## 9. Error handling & edge cases

- **Hook fires outside tmux** → `$TMUX_PANE` empty → no-op, exit 0.
- **`herald` missing / errors** → hooks swallow and exit 0; Claude never
  breaks.
- **Already in desired position** → window-id check makes cover/reveal
  idempotent; no double-swap.
- **Untracked panes** (operator manually splits) → orchestrator acts only on
  panes carrying `@herald_role`; others ignored.
- **Card loop dies** → pane shows last frame (still black); loop runs under a
  restart wrapper (`while :; do … ; done` already restarts the render; wrap
  the whole thing so a crash of the shell respawns via tmux `respawn-pane` on
  pane-died, optional).
- **Focus thrash** (rapid click between panes) → accept for v1; optional
  50 ms debounce in `focus-out` if it visibly flickers.
- **Multiple attached clients** → v1 assumes a single client; focus is
  per-client and multi-client reveal is undefined (documented limitation).
- **Terminal resize** → equal-split mirror keeps both windows proportional →
  swaps stay size-safe. Uneven/N>2 layouts under resize are a known gap.

## 10. Testing

- **Unit (`node --test`):** `renderCard(state, elapsed, cols, rows)` snapshot
  tests (each state; narrow/wide sizes); render-core color/pad/center helpers.
- **Integration (headless tmux, runs on Linux CI):** `tmux new -d`, build a
  2-slot grid with dummy long-runners (`sleep 999`) as "live" panes, then:
  - `TMUX_PANE=<live> herald curtain event working` while that pane is
    unfocused → assert `capture-pane` on the slot shows `WORKING` and the live
    pane's `#{window_id}` moved to `_holding`.
  - simulate `focus-in <curtain>` → assert live pane back in window 0.
  - `event done` → assert card text `DONE`.
  This exercises the whole state machine without a real Claude or a Mac.
- **Manual (real):** two Claude sessions in Ghostty-over-SSH — click to
  reveal, click away to re-cover, confirm no reflow flicker, confirm
  DONE/NEEDS transitions and that the existing notify ping still fires.

## 11. Phase 0 spike (de-risk first)

Before building the full orchestrator, prove the risky interaction with a
throwaway script: run a **real Claude session** (alt-screen TUI) in a tmux
pane, `swap-pane` it to a holding window and back, driven by
`pane-focus-in/out`, over `ssh manjaro` from Ghostty with `mouse on`. Confirm:
1. `focus-events` actually fire through Ghostty+SSH+mouse.
2. swap-pane preserves the live alt-screen TUI and redraws cleanly on
   swap-back (no blank/corruption).
3. size-mirrored swap shows no visible reflow.

If any fails, revisit the mechanism (fallback: `resize-pane -Z` auto-zoom
approach) before committing to swap-pane. **This spike gates the plan.**

## 12. Risks / open questions

1. **tmux focus-events through Ghostty+SSH+mouse** — must hold; verified by
   the Phase 0 spike. Highest risk.
2. **Alt-screen TUI across swap-pane** — Claude uses the alternate screen;
   swap must preserve/redraw it. Spike verifies.
3. **N>2 / uneven layouts** — deferred; v1 fixes equal 2-slot.
4. **HERALD core divergence** — the trimmed `render.mjs` must stay
   forward-compatible with plan 002 so it's superseded, not rewritten.
5. **Grind coupling** — none; Grind is fully independent (Mac-side) and
   specced separately in phase 2.

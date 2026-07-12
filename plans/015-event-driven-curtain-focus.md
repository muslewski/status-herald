# Plan 015: Event-driven curtain focus — Mac Hammerspoon → Manjaro stream

> **Design spec.** This is the brainstormed design (the *what* and *why*).
> The step-by-step implementation lives in the companion
> `plans/015-event-driven-curtain-focus-plan.md` (produced by writing-plans).
> Executors implement from the plan; read this spec first for context.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM (touches a live systemd focus agent + installs a
  persistent Mac-side app; reveal path is user-visible)
- **Depends on**: 013 (per-tab curtain shipped), 014 (themes shipped)
- **Category**: performance / dx
- **Planned at**: commit `479da55`, 2026-07-12
- **Branch**: `design/herald-per-tab-curtain` (or a fresh
  `feat/event-driven-focus`)

## Why this matters

The per-tab curtain reveals a session's live view when its Ghostty
window/tab takes focus on the Mac. Today that focus signal is discovered by
**polling**: a Manjaro systemd service SSHes to the Mac every `pollMs`
(currently 250 ms) and runs an `osascript` scan for the frontmost terminal
window's title. Two costs fall out of the poll model:

1. **Reveal latency is poll-bound.** A tab switch is not noticed until the
   next poll tick, then the osascript read (~170 ms) and the local
   `herald curtain focus` (~55 ms batched) run. Worst case ≈ 475 ms, average
   ≈ 300 ms. Last session's D-investigation confirmed there is no safe
   root-cause win on the *read* side (the `first process whose frontmost is
   true` predicate is the only reliable osascript; `tell process "ghostty"`
   by-name hangs ~2 min; `lsappinfo` cannot read window titles). The floor is
   the architecture, not the read.
2. **Constant idle load.** The osascript read takes ~170 ms and runs every
   250 ms — a ~68% duty cycle of an AppleScript process scanning every macOS
   process, forever, on a laptop that is often on battery. The poller burns
   CPU and network even when nothing is happening.

Event-driven focus removes both. A Mac-side event source fires the instant a
Ghostty window/tab is focused (or its title changes), pushes the new title to
Manjaro over the already-proven SSH channel, and idles at **zero** cost
between switches. Perceived reveal drops to ≈ 70–100 ms.

There is no agent-free way to get this: no pure-SSH mechanism subscribes to
macOS focus changes — polling is the only agentless option, and it is exactly
what we are replacing. So event-driven **requires** a persistent Mac-side
event source. Hammerspoon is that source (Phase-0 spike:
`mac/herald-spike.lua`).

## Current state

- **Transport**: `scripts/focus-agent/ghostty-ssh-poll.sh`, run by the
  `status-herald-curtain.service` systemd user unit. Direction is
  **Manjaro → Mac** SSH, multiplexed (`ControlMaster auto`,
  `ControlPersist 30s`), so RTT after the first connection is cheap.
- **Read**: `osascript` — `first process whose frontmost is true`; if its name
  is the configured `terminalApp` (`ghostty`), return `title of front
  window`, else return `""`.
- **Drive**: on a *changed* title, run `herald curtain focus "$t"` locally.
  The box normalizes the title (`titleStripPrefixes: ["[mosh] "]`) and does
  the batched cover/reveal across all armed sessions.
- **Lifecycle**: `ExecStartPre=herald curtain arm-all`,
  `ExecStopPost=herald curtain reveal-all` (both non-destructive), so
  stopping the service never leaves a session stuck behind its card.
- **Config** (`~/.config/status-herald/config.json`, `curtain.focus`):
  `source: "ssh-osascript"`, `pollMs: 250`, `ssh.{host,connectTimeout}`,
  `terminalApp: "ghostty"`, `titleStripPrefixes: ["[mosh] "]`.
- **Mac facts** (probed 2026-07-12): Hammerspoon is **not installed**; Ghostty
  runs as **3 separate windows** (so `windowFocused` fires on window
  switches; `windowTitleChanged` covers within-window tab switches). The
  spike commit `8d6216e` was Phase-0 only — never validated live, because
  Hammerspoon was absent.

The tmux side already reports the correct title even while covered: `arm`
sets `set-titles` + `TITLE_FMT` so a covered session's terminal title tracks
its *live* window name (`syndcast-75`), not the `_curtain` window. Hammerspoon
reads the same Ghostty window title the poll already reads — the emitter is a
drop-in signal source; nothing about the tmux/box side changes.

## Design

### Data flow

```
Mac: focus a Ghostty window/tab  (or a non-Ghostty app takes focus)
  → Hammerspoon window-filter fires  windowFocused / windowTitleChanged
        (INSTANT — no poll)                (or application-watcher: non-Ghostty)
  → dedup vs last emitted; append one line to <eventFile>
        (the raw window title, or "" when Ghostty is not frontmost)
Manjaro: systemd service holds a streaming read
  → ssh -o ServerAliveInterval=15 mac 'tail -n0 -F <eventFile>'
  → for each streamed line (skip heartbeat lines):
        herald curtain focus "<title>"   → batched cover/reveal (~55 ms)
```

Reveal latency = instant event + one warm-mux SSH RTT + local batched focus.
Idle Mac cost = zero (Hammerspoon is event-driven; a 20 s heartbeat timer is
the only periodic work).

### Component: Mac emitter — `mac/herald-focus.lua`

Promotes the spike into the production emitter. Installed to
`~/.hammerspoon/herald-focus.lua`; loaded by one `dofile(...)` line appended
to `~/.hammerspoon/init.lua` (reloadable via `hs.reload()`).

Responsibilities:
- `hs.window.filter.new(false):setAppFilter("Ghostty", {})`, subscribed to
  `windowFocused` **and** `windowTitleChanged` → emit `w:title()`.
  (Both are needed: window switches fire `windowFocused`; a tab switch inside
  one Ghostty window fires only `windowTitleChanged` as the window's title
  changes to the active tab.)
- `hs.application.watcher` (or the window-filter's global unfocus) → when a
  **non-Ghostty** app becomes frontmost, emit `""` so Manjaro covers every
  armed session (matches the poll's "front app is not ghostty → `""`").
- **Dedup**: keep the last emitted string; write only on change (mirrors the
  poll's `last` guard, moved to the source).
- **Emit** = append one line to `<eventFile>` and flush. Truncate the file
  when it exceeds ~64 KB so it never grows unbounded (a line per switch plus
  a heartbeat every 20 s ≈ 100 KB/day otherwise).
- **Heartbeat**: `hs.timer.doEvery(heartbeatSec, ...)` appends a sentinel line
  (`__hb__ <unix-ts>`) so a live-but-idle Hammerspoon keeps the reader's
  read-timeout satisfied, and a *dead* Hammerspoon is detectable (no line,
  not even a heartbeat).

The emitter's `eventFile` path and `heartbeatSec` default MUST match the
herald config values (single source of truth is the herald config; the Lua
constants default to the same values, and the installer may template them).

### Component: Manjaro adapter — `scripts/focus-agent/ghostty-hammerspoon-stream.sh`

A new reference adapter beside the poll adapter. Mirrors the poll adapter's
config reading (`herald config` → `curtain.focus.*`).

- **Startup sync**: one osascript read of the current frontmost title (the
  poll adapter's `read_title`, reused) → `herald curtain focus "$t0"`, so
  state is correct immediately and after every restart/gap.
- **Stream**: `ssh <ssh opts> -o ServerAliveInterval=15 -o
  ServerAliveCountMax=3 "$HOST" "tail -n0 -F '$EVENTFILE'"` piped into
  `while IFS= read -r -t "$((2*HEARTBEATSEC+5))" line; do ...`.
  - Heartbeat lines (`__hb__ *`) are skipped (they only keep the stream warm).
  - A real line → `herald curtain focus "$line"`.
  - `read -t` timeout (no line, not even a heartbeat, within
    `2*heartbeatSec+5` s) → Hammerspoon is dead → exit non-zero.
- **No reveal-all on exit.** A transient SSH drop must NOT flash every card
  away and re-cover — the cards should hold last state across a blip, and the
  resync on reconnect corrects them. `reveal-all` stays owned by the
  service's `ExecStopPost` (graceful stop only).
- Exit non-zero on stream end / dead-Hammerspoon so systemd `Restart=on-failure`
  respawns → startup sync re-runs.

### Component: dispatcher — `scripts/focus-agent/run.sh`

The systemd unit's `ExecStart` points here. It reads
`curtain.focus.source` and `exec`s the matching adapter:
`ssh-osascript` → `ghostty-ssh-poll.sh`; `ghostty-hammerspoon` →
`ghostty-hammerspoon-stream.sh`. Switching adapters becomes a config edit +
`systemctl --user restart`, not a unit-file edit. Behavior is byte-identical
to today when `source` is unchanged.

### Config additions (`curtain.focus`)

```jsonc
{
  "source": "ghostty-hammerspoon",   // NEW value; "ssh-osascript" stays the
                                     // default + agent-free fallback
  "eventFile": "~/.local/state/status-herald/focus-events", // path ON THE MAC
  "heartbeatSec": 20,                // Mac heartbeat cadence; reader timeout
                                     // derives from it (2*n+5)
  // unchanged: ssh.{host,connectTimeout}, terminalApp, titleStripPrefixes
  // pollMs: now consumed ONLY by the poll adapter
}
```

`lib/config.mjs` gains the new keys with defaults. The committed default
`source` stays `"ssh-osascript"` (agentless — right for OSS newcomers with no
Mac agent); this operator's local config sets `"ghostty-hammerspoon"`.

## Design decisions (recorded so nobody re-litigates)

- **Event source = Hammerspoon**, not a native Swift/ObjC helper. Zero build,
  no code-signing friction, already spiked, battle-tested `hs.window.filter`.
  A native helper is the fallback only if Hammerspoon is refused.
- **Transport = T1 streaming subscription** (Manjaro pulls a Mac event stream
  over the existing Manjaro→Mac SSH direction), not reverse-push (T2) or a
  socket (T3). T1 reuses the proven, multiplexed SSH direction; keeps
  lifecycle ownership (arm-all / reveal-all) on Manjaro; needs no new inbound
  reachability and no open ports.
- **Manjaro keeps lifecycle ownership.** `arm-all` / `reveal-all` stay on the
  service (`ExecStartPre` / `ExecStopPost`). The Mac emitter is a pure signal
  source with no knowledge of curtain state.
- **Poll adapter stays** as a config-selectable fallback and the agent-free
  default. This extends the OSS "configurable trigger adapters" framing —
  event-driven is one adapter, poll is another; the box does not care which.
- **Heartbeat + read-timeout** is the dead-Hammerspoon detector. SSH
  keepalive only detects a dead *connection*; an app-level heartbeat is the
  only way to detect a live connection with a dead event source.
- **Emitter dedups; box is idempotent.** Duplicate `focus` on the same title
  is cheap and safe, but the emitter suppresses it at the source anyway.

## Alternatives considered and rejected

- **Keep polling, lower pollMs / cheaper read** — cannot beat the poll-interval
  floor and does nothing about the idle duty cycle. (Offered as the
  no-Mac-agent option; declined in favor of event-driven.)
- **T2 reverse SSH push** — Hammerspoon runs `ssh manjaro herald curtain
  focus` per event. Simpler Manjaro side but needs Mac→Manjaro reachability,
  moves "who is authoritative" onto the Mac, and strands cards (no
  `reveal-all`) if the Mac agent dies — requiring a Manjaro watchdog to
  compensate. Rejected for the extra reachability + lifecycle-split cost.
- **T3 socket/daemon** — a TCP channel between the machines. Ports, firewall,
  discovery, new failure modes; against the project's no-socket ethos.
  Rejected unless T1 and T2 both fail.
- **Native Swift/ObjC AXObserver helper** — self-contained, no third-party
  app, but a build toolchain, code-signing, and more code to maintain.
  Rejected vs Hammerspoon on cost; kept as the documented fallback if
  Hammerspoon is unacceptable.

## Test plan

- **Unit (`node --test`)**: `lib/config.mjs` resolves the new `source`,
  `eventFile`, and `heartbeatSec` (defaults applied when absent; overrides
  honored); the `ssh-osascript` path and every existing default are
  unchanged. Shell adapters and the Lua emitter are not `node`-testable — the
  Node surface here is thin by design.
- **Integration checklist (manual, documented in the plan)**:
  1. Install Hammerspoon + `herald-focus.lua`; `hs.reload()`.
  2. Arm sessions; switch Ghostty windows → reveal < 120 ms (target ≈70–100).
  3. Switch tabs *within* one window → reveal (proves `windowTitleChanged`).
  4. Focus Safari → every armed session covers.
  5. `killall Hammerspoon` → reader hits read-timeout, systemd restarts,
     startup sync restores correct state; relaunch Hammerspoon → live again.
  6. Confirm no `osascript` poll process idling on the Mac (event mode only
     reads on startup + reconnect).
- **Regression**: existing 171 tests stay green; `biome check` clean; classic
  theme byte-identical (untouched).

## Done criteria

- [ ] Perceived reveal on a Ghostty focus change ≤ ~100 ms (measured).
- [ ] Zero idle `osascript` polling on the Mac in event mode.
- [ ] Non-Ghostty focus covers all armed sessions within the same budget.
- [ ] Dead Hammerspoon / dropped SSH → automatic restart + resync (no card
      stuck beyond one restart cycle; no reveal-all flash mid-blip).
- [ ] `source: "ssh-osascript"` still works unchanged (fallback intact).
- [ ] `node --test` green, `biome check` clean.
- [ ] `plans/README.md` status row added for 015.

## Rollout / safety

Standing constraint (verbatim, in force): *"for some reason all my tmuxes
suddenly diued. so do not make such stuff for me. a lot of stuff are running
sessions."* — every step non-destructive; back up config before mutating;
never kill or disturb running tmux sessions.

- **Config**: back up `~/.config/status-herald/config.json` before editing.
- **Poll → stream cutover**: `systemctl --user stop` (its `ExecStopPost`
  reveals all — no stuck cards) → flip `source` → `start`. The dispatcher
  makes this a config-only change.
- **Hammerspoon `.app` install** on the Mac is an outward action on the
  operator's machine — **confirm before doing it live**; the spec treats it as
  a documented, gated step, not an automatic one.
- **No push / no PR** unless the operator asks.

## STOP conditions

Stop and report (do not improvise) if:

- The Hammerspoon spike does **not** fire distinct events on a tab/window
  switch (e.g. Ghostty tabs coalesce into one AXWindow with no
  `windowTitleChanged`) — the event source is unviable; report before
  building the adapter.
- Mac→Manjaro or Manjaro→Mac SSH behaves differently than the poll assumed
  (auth, mux, reachability) — transport assumption broke; report.
- The cutover would require stopping/restarting anything other than the
  `status-herald-curtain.service` — do not touch other services or sessions.

## Maintenance notes

- If Ghostty ever changes how window titles reflect the active tmux
  live-window (or the mosh title passthrough changes), both the poll and the
  stream adapters are affected identically — the title contract is upstream
  of both.
- The `eventFile` path is defined once in herald config; the Lua emitter's
  default must track it. If the operator overrides `eventFile`, update the Lua
  constant too (or re-run the templating installer).
- If a second Mac terminal app is ever added, `terminalApp` gates both
  adapters; the Hammerspoon app-filter would need the same app name.

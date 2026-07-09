# status-herald (HERALD)

Heads-up engine for terminal status surfaces.

## Curtain (phase 1)

Covers a working Claude Code pane in a tmux grid with an opaque status card;
focus a card to open the live session.

### Install

```bash
npm install            # dev deps only (biome); zero runtime deps
npm link               # put `herald` on PATH
herald curtain install # wire Claude Code hooks into ~/.claude/settings.json
```

`install` wires one command, `herald curtain hook`, onto `UserPromptSubmit`,
`SubagentStart`, `SubagentStop`, `Stop` and `Notification`, and removes the
older `herald curtain event <state>` hooks if it finds them. Hook changes only
take effect in Claude Code sessions started afterwards.

### Use

```bash
herald curtain up --slots 2 --cmd claude   # build the grid on Manjaro
# from the Mac: ssh manjaro -t 'tmux attach -t grid'
herald curtain doctor                      # verify wiring
herald curtain down                        # tear down
```

While a session works and its pane is unfocused it shows `● WORKING m:ss`;
finished panes show `✅ DONE`; blocked panes show `⚠ NEEDS YOU`. Click a card
to reveal the live session; click away to re-cover it while it is still
working.

### What the card knows about subagents

A Claude Code session is a main agent plus whatever subagents and background
shells it has dispatched, so "the turn ended" and "the work finished" are not
the same event. Claude Code's `Stop` hook means the first one: it fires once
per user prompt, even while `background_tasks` still lists running work, and
it never fires again when a completing task wakes the agent back up.

`herald curtain hook` therefore reads each hook's stdin payload rather than
trusting its name:

- **subagents still running** at `Stop` → stays `● WORKING · 2 subagents`,
  because a subagent keeps the main agent busy and you cannot act yet.
- **background shells still running** at `Stop` → `✅ DONE · 1 shell in bg`.
  A CI watch or a long build does not hold you up; the card just says so.
- `Notification` splits on `notification_type`: a `permission_prompt` is
  `⚠ NEEDS YOU`, an `idle_prompt` is `✅ DONE` — and never overrides a
  permission prompt that is still waiting on you.

One caveat, by design: a turn resumed by its finishing subagents emits no
second `Stop`, so the card holds `WORKING` until Claude Code's idle
notification lands (~60s). Being a minute late to `DONE` beats being a minute
early, which is what sends you to a tab that is still working.

Grind Mode (Mac idle-nag) is phase 2 — separate spec.

## Per-tab curtain (mosh)

Each Ghostty tab is a separate mosh'd tmux session. The curtain covers a
backgrounded tab with its status card and reveals the tab you switch to.
The box exposes these commands:

```bash
herald curtain arm [<session>]   # add a card window to a session (run inside it, or name it)
herald curtain disarm [<session>]  # remove it (run inside, or name it)
herald curtain cover <session>   # show the card (if working/done/needs)
herald curtain reveal <session>  # show the live session
herald curtain focus "<title>"   # reveal the tab whose label == title, cover the rest
herald curtain reveal-all        # panic: reveal everything
herald curtain arm-all           # arm every session matching config's autoArm.sessionGlob
```

Fail-open: pressing any key in a card reveals its session, so a dead agent
never traps you. Idle sessions are never covered.

### The adapter model

The box never polls anything itself — it just reacts to `herald curtain
focus "<title>"`. What decides *when* to call that command, and with what
title, is an external **focus adapter**: any process, on any machine, that
can (a) learn which terminal tab/window is currently frontmost and (b) shell
out that one command (locally, or via `ssh <box> herald curtain focus ...`)
whenever the frontmost tab changes.

status-herald ships one reference adapter
(`scripts/focus-agent/ghostty-ssh-poll.sh`, below) that polls a Mac over ssh.
It is not the only way to drive the curtain — see "write your own adapter".

**Contract:** adapters always send the **raw** tab title. The box — not the
adapter — normalizes it via `curtain.focus.titleStripPrefixes` (stripping a
transport prefix like mosh's `"[mosh] "` and trimming) before matching it
against a session's window label. An adapter that pre-strips the title will
break matching for anyone whose config uses a different prefix.

A terminal's title follows tmux's *active* window, so a covered session would
otherwise advertise itself as `_curtain` — and focusing that tab would tell the
adapter "no session matches", covering everything instead of revealing the tab
you just clicked. To prevent that, `arm` pins the session's `set-titles-string`
so it always reports the **live** window's name, card or no card; `disarm`
removes the override. A covered tab therefore keeps its normal title, and
focusing it reveals it.

### Config reference

Config lives at `$HERALD_CONFIG`, else
`${XDG_CONFIG_HOME:-~/.config}/status-herald/config.json`. Missing file or
bad JSON ⇒ the defaults below (hook-safe, never throws). A config file only
needs to set the keys it wants to override — everything else deep-merges
from defaults. Run `herald config` to print the effective merged config.

The `curtain` block, with its defaults:

```json
{
  "enabled": true,
  "coverableStates": ["working", "done", "needs"],
  "focus": {
    "source": "ssh-osascript",
    "pollMs": 350,
    "ssh": { "host": "mac-music", "connectTimeout": 4 },
    "terminalApp": "ghostty",
    "titleStripPrefixes": ["[mosh] "]
  },
  "autoArm": { "enabled": true, "sessionGlob": "*" }
}
```

- `enabled` — kill switch; when `false` every per-tab verb (`arm`, `disarm`,
  `cover`, `reveal`, `reveal-all`, `focus`, `arm-all`) no-ops.
- `coverableStates` — session states eligible to be covered by a card.
- `focus.source` — label for which trigger mechanism is in play (informational;
  doesn't change box behavior). The reference adapter is `"ssh-osascript"`.
- `focus.pollMs` — how often the reference ssh-poll adapter re-reads the
  frontmost tab title.
- `focus.ssh.host` / `focus.ssh.connectTimeout` — the ssh target (an ssh
  config alias or `user@host`) and its connect timeout, in seconds.
- `focus.terminalApp` — the macOS app name the adapter checks is frontmost
  (`osascript`'s `name of fp`) before reading its window title.
- `focus.titleStripPrefixes` — ordered list of prefixes the box strips (first
  match wins) before comparing an incoming title to session window labels.
- `autoArm.enabled` / `autoArm.sessionGlob` — whether `herald curtain arm-all`
  is allowed to run, and which tmux sessions it arms (`*` = all,
  `prefix*` = glob-matched, or an exact name).

### ssh-poll quickstart

The reference adapter (`scripts/focus-agent/ghostty-ssh-poll.sh`) is plain
bash + `ssh` + `node` (for zero-dep JSON parsing of `herald config`) — no
runtime deps beyond what the box already requires.

```bash
# 1. Grant macOS Accessibility to the ssh path: System Settings -> Privacy &
#    Security -> Accessibility -> add /usr/sbin/sshd. That's the process
#    that runs the remote `osascript` call when a command arrives over ssh,
#    and it needs permission to read window titles via System Events.
# 2. Make sure `ssh.host` (or its ssh-config alias, e.g. `mac-music`)
#    resolves and logs in non-interactively (BatchMode=yes, key-based auth).
# 3. Verify the read path end-to-end -- no tmux/curtain mutation:
scripts/focus-agent/ghostty-ssh-poll.sh --once
# -> prints the Mac's frontmost Ghostty tab title (blank if Ghostty isn't
#    frontmost)
```

Once `--once` prints a title, the same script with no flags runs the
unbounded poll loop used by the systemd unit below. `--sentinel FILE` (exit
once `FILE` disappears) and `--max SEC` (exit after a time budget) are for
bounded/manual test runs.

### systemd install (opt-in)

```bash
mkdir -p ~/.local/share/status-herald ~/.config/systemd/user
cp scripts/focus-agent/ghostty-ssh-poll.sh ~/.local/share/status-herald/
cp contrib/systemd/status-herald-curtain.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now status-herald-curtain

systemctl --user status status-herald-curtain   # confirm active
journalctl --user -u status-herald-curtain -f   # watch it poll
```

The unit's `ExecStartPre` runs `herald curtain arm-all` on every start so
newly created sessions get armed automatically per `autoArm.sessionGlob`;
`Restart=on-failure` keeps the poller alive across transient ssh drops.

### Write your own adapter

The box's whole surface area is `herald curtain focus "<title>"` (plus
`arm`/`disarm`/`cover`/`reveal`/`reveal-all`/`arm-all` for setup and
recovery) — any adapter that calls it on tab-focus-change qualifies. Poll,
or subscribe to native OS events; run on the box itself, over ssh, or push
through a queue. Only rule: send the **raw** title and let the box normalize.

`mac/herald-spike.lua` documents the alternative: a Hammerspoon
(`hs.window.filter`) event-driven adapter that watches Ghostty title/focus
changes on the Mac natively, with no polling and no ssh round trip — at the
cost of a Hammerspoon dependency on the Mac. Wire its callback to shell out
`ssh <box> herald curtain focus "<title>"` (or run `herald` directly if the
adapter lives on the box) in place of the spike's `print(...)` stub.

Test it over mosh without any adapter:

```bash
herald curtain arm syndcast
tmux set -t syndcast @herald_state working
ssh <box> herald curtain cover syndcast   # flip to the syndcast tab -> card
ssh <box> herald curtain reveal syndcast  # -> live session
```

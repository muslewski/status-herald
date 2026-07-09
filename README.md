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

Grind Mode (Mac idle-nag) is phase 2 — separate spec.

## Per-tab curtain (mosh)

Each Ghostty tab is a separate mosh'd tmux session. The curtain covers a
backgrounded tab with its status card and reveals the tab you switch to.
The trigger comes from a Mac Hammerspoon agent (see "Mac install"); the box
exposes these commands:

```bash
herald curtain arm [<session>]   # add a card window to a session (run inside it, or name it)
herald curtain disarm            # remove it
herald curtain cover <session>   # show the card (if working/done/needs)
herald curtain reveal <session>  # show the live session
herald curtain focus "<title>"   # reveal the tab whose label == title, cover the rest
herald curtain reveal-all        # panic: reveal everything
```

Fail-open: pressing any key in a card reveals its session, so a dead agent
never traps you. Idle sessions are never covered.

Test it over mosh without the Mac agent:

```bash
herald curtain arm syndcast
tmux set -t syndcast @herald_state working
ssh <box> herald curtain cover syndcast   # flip to the syndcast tab -> card
ssh <box> herald curtain reveal syndcast  # -> live session
```

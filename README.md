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

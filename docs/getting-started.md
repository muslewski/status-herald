---
title: "Getting started"
description: "Install status-herald, wire hooks, verify with doctor, arm a session or grid."
section: guide
order: 10
---

# Getting started

Curtain cards and native bars for agent panes. Four steps, then you have a stage.

## 1. Install

```bash
npm install -g status-herald
# bins: herald | status-herald
```

Requires **Node ≥ 20**. From a git checkout:

```bash
npm install
npm link
```

## 2. Wire hooks

```bash
herald curtain install         # ~/.claude/settings.json (Claude + Grok compat)
# or native Grok only:
herald curtain install grok    # ~/.grok/hooks/herald.json
```

`install` writes an **absolute** `node …/bin/herald curtain hook` command so hooks work outside your interactive PATH.

## 3. Doctor

```bash
herald curtain doctor
```

Expect hooks wired, tmux available, and (when inside tmux) a sensible session picture. Fix anything red before dogfooding.

## 4. Arm or grid

**Existing session (per-tab / mosh case):**

```bash
# inside the tmux session with your agent pane(s):
herald curtain arm
# or: herald curtain arm mysess
# or: herald curtain arm-all
```

**Fresh grid:**

```bash
herald curtain up --slots 2 --cmd grok     # or --cmd claude
```

Focus / tab switch (via your focus adapter) drives `herald curtain focus "title"` so background panes show the card and the front tab stays live.

Useful chrome:

```bash
herald curtain pause    # hold open (× off on status-right)
herald curtain resume
herald curtain pet      # cycle denizen species (↻ pet)
herald curtain status
herald curtain inspect
```

## Attention sound (optional)

By default Herald is **silent**. When you opt in, it can play a short cue on this machine, a remote host (e.g. SSH to a laptop), and/or ntfy on attention edges:

- **`needs`** — approval / permission (⚠ NEEDS YOU). Rare if the CLI is in always-approve / yolo mode.
- **`done`** — turn finished after work (your turn to type). Useful for Grok with `permission_mode = "always-approve"`, where approval hooks almost never fire.

Default product events list is `["needs"]` only; add `"done"` when you want your-turn wakes.

```bash
# 1. Add backends under curtain.sound in ~/.config/status-herald/config.json
# 2. Enable and pick intensity:
herald curtain sound enable
herald curtain sound day      # or night | off
herald curtain sound test     # fire backends now (no NEEDS required)
herald curtain sound          # status
```

Example backend (SSH to a Mac that can `afplay`):

```json
{
  "curtain": {
    "sound": {
      "enabled": true,
      "mode": "day",
      "events": ["needs", "done"],
      "onlyWhenCovered": true,
      "backends": [
        {
          "type": "ssh",
          "host": "mac-music",
          "day": "afplay /System/Library/Sounds/Glass.aiff",
          "night": "afplay /System/Library/Sounds/Sosumi.aiff"
        }
      ]
    }
  }
}
```

`onlyWhenCovered: true` keeps the focused live pane quiet. Disable anytime with `herald curtain sound disable` or `mode: "off"`. If you previously used a personal `ping-mac-music.sh` Notification hook, turn that off after Herald sound works to avoid double chimes.

## Bars and gauges (optional siblings)

Herald’s **tmux status-right** account segments (`account5h` / `accountWeekly`) and Claude statusline gauges read rate-limit / usage data from **[token-oracle](https://github.com/muslewski/token-oracle)** via `~/.local/share/token-oracle/forecast.json` (`HERALD_TOKEN_FEED` can override the ingest path). Without oracle installed and publishing that file, those gauges stay blank — curtain cards still work.

Optional **agentic-sage** fleet/zone extras and **llm-armory** launch model lines are documented in [Works with](./works-with.md). None are required.

## Agent path

If an agent is installing for you, follow the machine-oriented runbook:

→ **[`AGENTS.md`](../AGENTS.md)** (hooks, Grok vs Claude, arm/grid, providers)

## Next

- [Bestiary](./BESTIARY.md) — denizens and poses
- [Works with](./works-with.md) — fleet map
- [README](../README.md) — full feature surface and config sketches

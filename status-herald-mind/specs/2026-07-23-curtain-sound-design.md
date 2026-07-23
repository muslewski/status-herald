---
type: spec
summary: "Curtain sound — default-off attention audio fired on transition into NEEDS; pluggable backends (local/ssh/ntfy/command); day|night|off intensity; CLI + doctor; Manjaro→Mac is one profile, not the product default."
tags: [curtain, sound, notify, needs, backends, config]
status: approved
created: 2026-07-23
updated: 2026-07-23
origin: brainstorm session (closed-eyes wake + productize personal ping-mac stack)
related:
  - "[[curtain-core]]"
  - "[[config]]"
  - "[[curtain-ops]]"
  - "[[focus-host]]"
sources: []
---

## Problem

Operators need a **wake signal** when an agent is blocked on them (approval / permission), including when they are not looking at the pane. Herald already turns those events into `⚠ NEEDS YOU` curtain state; audio is still a personal side-script (`~/.claude/hooks/ping-mac-music.sh` + `notify-mode.conf`) wired only for some hosts, Mac-centric, and easy to desync from the card.

Requirements:

1. **Closed-eyes test** — sound only when the human must act (NEEDS), not on DONE/tool spam.
2. **Default silent** — most users (and every fresh install) hear nothing until they opt in.
3. **Customizable delivery** — Manjaro session → MacBook SSH is one profile; local Linux, pure Mac, ntfy-only are others.
4. **Easy disable** — config master switch + mode `off` + CLI, same spirit as other optional curtain features.
5. **Single truth with the card** — Herald owns *when*; backends own *how*; fail-open always.

## Non-goals (v1)

- Full curtain soundtrack (WORKING/DONE chimes) — config may list events later; v1 only `needs`.
- Card bottom-right mute button (card chrome hit targets are still incomplete; status-right glyph is optional later).
- Shipping proprietary sound files or assuming Tailscale/Mac hostnames.
- Replacing OS notification centers or agent-native UI sounds.

## Design

### Product rule

**Herald fires attention sound only on the edge into `needs`.**  
`prevState !== needs` AND `nextState === needs`. Staying in `needs` does not re-fire every Notification tick (dedupe window still applies as belt).

Intensity is orthogonal to *when*:

| Mode | Intent |
|------|--------|
| `off` | Silent (even if `enabled: true`) |
| `day` | Short soft cue (Glass / paplay / ntfy) |
| `night` | Loud wake (user-configured night command) |

Master switch: `curtain.sound.enabled` default **`false`**.

### Config shape

Under `curtain.sound` (deep-merged with defaults):

```json
{
  "enabled": false,
  "mode": "day",
  "events": ["needs"],
  "onlyWhenCovered": false,
  "dedupeSec": 8,
  "backends": []
}
```

**Backend objects** (ordered; all matching fire fire-and-forget):

| type | Fields | Notes |
|------|--------|--------|
| `command` | `day`, `night` (shell strings; empty = skip that mode) | Local shell on the machine running the hook |
| `ssh` | `host`, `day`, `night`, optional `connectTimeout` | `ssh -o BatchMode=yes -o ConnectTimeout=N host -- <remote>` |
| `ntfy` | `topic`, optional `title`, `body`, `tags` | HTTPS POST to ntfy.sh (or full URL if topic looks like URL); typically day |
| `local` | same as `command` | Alias of `command` for readability |

Empty `backends` ⇒ silent even when enabled (safe default).

**Example — Manjaro → MacBook (operator profile, not shipped default):**

```json
{
  "curtain": {
    "sound": {
      "enabled": true,
      "mode": "day",
      "onlyWhenCovered": true,
      "backends": [
        {
          "type": "ssh",
          "host": "mac-music",
          "day": "afplay /System/Library/Sounds/Glass.aiff",
          "night": "osascript -e 'tell application \"QuickTime Player\" to open POSIX file \"/Users/…/Music/quebo.m4a\"' …"
        },
        {
          "type": "ntfy",
          "topic": "your-private-topic",
          "title": "Herald — needs you",
          "body": "Agent waiting on approval / decision."
        }
      ]
    }
  }
}
```

### Runtime

1. `stampFromHook` computes `next` as today.
2. After state is known, call pure `shouldFireSound(soundCfg, { prev, next, covered })`.
3. If true, `fireSound(soundCfg, { nowSec, session }, deps)`:
   - resolve mode commands per backend
   - spawn detached (`stdio` ignore, no await beyond spawn)
   - never throw into the hook path
4. Record last-fire time per session via tmux opt `@herald_sound_last` (unix sec) for dedupe.
5. If `onlyWhenCovered: true`, skip when `@herald_covered !== "1"` (focused live pane stays quiet).

Inject `spawn` / `exec` in tests; production uses `child_process.spawn` with `detached: true` + `unref()`.

### CLI

```text
herald curtain sound              # print mode + enabled + backend count
herald curtain sound day|night|off
herald curtain sound enable|disable
herald curtain sound test         # fire backends for current mode (no NEEDS required)
```

Mode/enable writes merge into the user config file (`HERALD_CONFIG` or XDG `…/status-herald/config.json`), creating the file if missing. Never clobber unrelated keys.

### Doctor

Soft check (not hard-fail):

- sound disabled → `sound: off (default silent)` ok
- enabled + mode off → ok with detail
- enabled + no backends → soft fail / fixHint: add backends or disable
- enabled + backends → ok with summary `day via ssh:mac-music, ntfy`

### Migration from personal ping

| Old | New |
|-----|-----|
| `ping-mac-music.sh` on Notification | Herald NEEDS edge (after `herald curtain install`) |
| `notify-mode.conf` MODE | `curtain.sound.mode` + CLI |
| Grok `ui.notifications.hooks` ping | Optional leave in place **or** remove once Herald sound works (double-fire risk — document disable of old hook) |
| Bar ☀️/🌙/🔕 from Claude conf | Keep reading Claude conf for statusline segment; CLI can later dual-write (v1: Herald config is source of truth for curtain sound) |

### Invariants

- Default install: **no audio**.
- Hook path fail-open: sound errors never change `@herald_state`.
- No Mac / afplay / quebo assumptions in DEFAULTS.
- v1 events list is `["needs"]` only; other values ignored until a later spec.
- Deduped edge fire only (not every second on the card loop).

## Testing

- Pure unit: `shouldFireSound` matrix (enabled/mode/edge/covered/dedupe/events).
- Pure unit: backend command builders for command/ssh/ntfy.
- Integration-style: `fireSound` with mock spawn records argv; bad backend does not throw.
- Config defaults present and mergeable.
- CLI mode write + read in temp config dir.
- Doctor soft lines with fixtures.
- Existing hook/session tests remain green; stamp path gets one test that sound is invoked on needs edge when enabled.

## Docs / recollection

- Public: short section in `docs/getting-started.md` (optional sound) + CHANGELOG.
- Atlas: extend `config` + `curtain-core` zone cards; decision note if backend taxonomy is non-obvious.
- Spec/plan live under `status-herald-mind/` (not public `docs/`).

## Open questions (resolved in brainstorm)

| Q | Decision |
|---|----------|
| When? | NEEDS edge only (closed-eyes) |
| Where? | Pluggable backends; no universal default host |
| Who fires? | Herald curtain stamp path (hybrid: product owns when) |
| Disable UX | `enabled` + `mode: off` + CLI; chrome later |
| Card buttons | Not required for v1 |

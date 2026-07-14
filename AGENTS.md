# Herald (status-herald) — Agent Runbook

HERALD provides tmux "curtain" cards (`● WORKING m:ss`, `✅ DONE`, `⚠ NEEDS YOU`) that cover agent panes when unfocused. It reacts to hook events from the agent CLI running inside the tmux pane.

It is deliberately multi-agent: first-class for Grok Build + Claude Code, neutral for others.

## Quick Start (any agent)

```bash
cd /path/to/status-herald
npm install
npm link
herald curtain doctor   # check tmux + hooks
```

## For Grok Build (fixes "tmux bottom bar / curtain not working")

Grok emits the same core hook events as Claude (UserPromptSubmit, Stop, Notification, SubagentStart/Stop) but with camelCase fields in JSON (`hookEventName`, `notificationType`) and uses `approval_required` for NEEDS.

Herald normalizes these.

### Setup steps for beautiful Grok tmux cards

1. Wire hooks (two equivalent paths):

   **Compat (recommended, simplest — Grok always reads ~/.claude/settings.json):**
   ```bash
   herald curtain install
   # installs "herald curtain hook" into ~/.claude/settings.json
   # (Grok loads it via its compat layer; no Claude Code required)
   ```

   **Native Grok (clean, no .claude dir):**
   ```bash
   herald curtain install grok
   # or: herald curtain install --grok
   # writes ~/.grok/hooks/herald.json (global, always trusted)
   ```

2. Verify:
   ```bash
   herald curtain doctor
   # expects: ✓ hooks wired (claude compat or grok native)
   #          ✓ inside tmux
   #          ✓ tmux available
   ```

3. In your tmux session (the one containing Grok panes), launch or arm:

   **Grid (multiple side-by-side Grok sessions):**
   ```bash
   herald curtain up --slots 2 --cmd grok
   # (or --slots N; inside grid panes launch with `grok`)
   ```

   **Per-tab / mosh / existing session (the common "bottom bar" case):**
   ```bash
   # inside the tmux session that has your grok pane(s):
   herald curtain arm          # arm current session
   # or
   herald curtain arm mysess   # by name
   herald curtain arm-all      # if autoArm configured
   ```

   The focus adapter (e.g. ghostty-ssh-poll on Mac side) will then drive `herald curtain focus "title"` to cover/reveal.

4. Use:
   - When Grok is working in an unfocused pane → card appears with timer + subagent count (approx for Grok).
   - `⚠ NEEDS YOU` on approval_required notifications.
   - Any key in card → reveals the live Grok TUI.
   - `herald curtain status` (from inside a pane) shows current `@herald_state`.

5. Teardown:
   ```bash
   herald curtain disarm
   herald curtain down   # for grid
   ```

Grok sessions get the exact same cards as Claude because:
- Hook command is called with TMUX_PANE inherited.
- `parseHookPayload` + `stampFromHook` normalize + synthesize sub counts from Subagent* events.
- tmux focus hooks + curtain windows are CLI-agnostic.

## For Claude Code

Same as above, but default:
```bash
herald curtain install   # ~/.claude/settings.json
herald curtain up --cmd claude
herald curtain arm
```

Claude payloads use `hook_event_name`, full `background_tasks[]`, `permission_prompt`/`idle_prompt`.

## Updating / Uninstall

```bash
herald curtain uninstall        # claude compat
herald curtain uninstall grok   # native
```

Re-arm sessions after upgrade for sub counts: `herald curtain disarm && herald curtain arm`

## Troubleshooting "no cards / bottom status for grok"

- `herald curtain doctor` — hooks must show wired.
- Confirm hooks loaded in Grok: inside Grok TUI run `/hooks` or Ctrl+L → Hooks tab. Look for "herald curtain hook" on the events.
- Is the pane inside tmux? `echo $TMUX_PANE` must be set when hooks fire.
- Check state: from pane run `herald curtain status`
- Manually force: `herald curtain arm && tmux set -t <sess> @herald_state working && herald curtain cover <sess>`
- Grok config may suppress some notifs — ensure `ui.notifications.events` includes approval if you want NEEDS cards.
- Payload shape: recent Grok uses `hookEventName`; herald handles both + env `GROK_HOOK_EVENT`.
- If sub count always 0 on Grok: expected (synthesized); Stop will still mark DONE unless a SubagentStart has been seen for that session since arm.
- **Grok has no `idle_prompt`.** Claude holds WORKING after the last SubagentStop until idle (~60s). Grok (synthesis-only, never saw `background_tasks`) settles to DONE on the last SubagentStop when the id set drains. Claude task-list sessions still wait for idle.
- **Synthetic UserPromptSubmit** (`promptId: task-completed-*` or `<system-reminder>` task-complete injects) does **not** re-assert WORKING after DONE.
- Stuck WORKING with leftover `syn-*` ids: SubagentStart without matching SubagentStop; next human prompt clears the set, or `herald curtain disarm && arm` on that session.

## Config

See README "Config reference". Curtain works the same regardless of agent.

## How it works (internals)

- `bin/herald curtain hook` (called by agent on events): reads JSON stdin → `parseHookPayload` (normalizes) → `stampFromHook` (nextState + bg counts) → sets tmux `@herald_*` session opts.
- `scripts/curtain-card-session.sh` (in _curtain window) re-renders every sec from opts.
- tmux `pane-focus-in/out` hooks + orchestrator swap live/curtain panes.
- Install uses safe merge + backup (never clobbers foreign hooks).

## Adding support for another agent

- Ensure it emits equivalent events on stdin JSON (or env).
- Extend `normalizeEventName` / `normalizeNotificationType` + key fallbacks in `lib/curtain/hook.mjs`.
- If it has no sub counts, the SubagentStart/Stop synthesis in `stampFromHook` usually suffices.
- Document in this file + README.
- `herald curtain install` path stays claude-compat; add native writer if needed.

See also: `herald curtain --help` equiv via source, tests in `test/hook.test.mjs`.

Keep Claude perfect; add Grok/other without breaking.

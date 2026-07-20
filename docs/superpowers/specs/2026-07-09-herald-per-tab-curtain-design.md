# HERALD Per-Tab Curtain — Design

**Status:** approved design, pre-plan
**Date:** 2026-07-09
**Supersedes trigger model of:** phase-1 grid curtain (`docs/superpowers/plans/2026-07-08-herald-curtain.md`)

## Goal

Auto-cover a backgrounded Ghostty tab (each tab = one mosh'd tmux session running Claude) with a HERALD status card, and reveal the tab you switch to — so multiple AI sessions stop being passively doom-watchable. Keep mosh.

## Background

Phase-1 built the Curtain as a **grid**: one tmux `grid` session of side-by-side panes, cover/reveal driven by tmux `pane-focus-in/out` hooks. Live probing (2026-07-09) proved the load-bearing assumption false for the user's real setup:

- The user's fleet is **mosh, one session per Ghostty tab** (`mosh <host> -- repo-session <repo> --claude`; see `~/.local/bin/repo-session`). Each tab = a separate mosh connection = a separate tmux session (`syndcast`, `syndcast-2`, `agentic-sage`, …).
- **mosh 1.4.0 drops terminal focus events** (DECSET 1004). tmux never sees tab focus in/out. So the whole focus-hook trigger is dead over mosh. Confirmed: an armed `pane-focus-in/out` hook logged zero events across repeated tab switches; the same hook + logger worked when invoked directly.

Therefore the "which tab is active" signal must come from the **Mac side**, where Ghostty knows its focused tab. The user confirmed: sessions are **separate Ghostty tabs**, and Ghostty updates the **window title** on tab switch (title = the Claude label set by `session-sync.py` = the tmux active window name). That title change is the signal Hammerspoon can observe.

Phase-1's lower layers are reused wholesale (render core, card surface, state helpers, tmux argv wrappers, the card-loop). Only the **trigger** (Mac agent instead of tmux focus hooks) and the **cover mechanism** (per-session window switch instead of grid pane swap) are new. The phase-1 grid mode remains in the tree as a secondary mode; per-tab becomes the primary.

## Architecture

```
 MAC (Hammerspoon, Lua)                     BOX (herald + tmux, Node)
 ──────────────────────                     ─────────────────────────
 observe focused Ghostty                    each ARMED session S has:
 tab title (AXTitleChanged                    win: live claude
 + app focus)                                 win _curtain: status card loop
        │                                      @herald_state (session-scoped)
   on change:                                  @herald_live_win, @herald_covered
     ssh box \                    ssh
       'herald curtain    ────────────────►  herald curtain focus "<title>":
        focus "<title>"'   (ControlMaster)      • reveal armed session whose
                                                  label == title
   left Ghostty →                               • cover every OTHER armed session
     focus ""                                    whose state ∈ {working,done,needs}
```

**Single contract call.** Every tab switch (or leaving Ghostty) sends exactly one `herald curtain focus "<title>"`. The Mac never needs session names — it forwards the focused tab's title string (empty when Ghostty is not frontmost). The box resolves title → session and performs reveal-one, cover-the-rest. The call is idempotent and re-evaluates the **whole** armed set each time, so a backgrounded session that has since started working gets covered on the next tab switch.

## Component 1 — Box engine (built + tested first, native)

New module `lib/curtain/session.mjs`; new CLI subcommands under the existing `herald curtain` verb. Reuses `render.mjs`, `curtain-card.mjs`, `state.mjs`, `tmux.mjs`, and the card-loop script.

### Per-session state (tmux options, all session-scoped, never `-g`)

| Option | Meaning |
|---|---|
| `@herald_armed` | `1` on sessions that have a curtain card window |
| `@herald_state` | `idle`\|`working`\|`done`\|`needs` — stamped by the Claude hook |
| `@herald_since` | epoch seconds when `working` began (for the elapsed timer) |
| `@herald_covered` | `1` while the session is showing its card window |
| `@herald_live_win` | window id of the live claude window, remembered so `reveal` restores it |

### CLI

- `herald curtain arm` — run inside a session. Creates a hidden `_curtain` window running the card-loop, sets `@herald_armed 1`, records the current (live) window in `@herald_live_win`, initial `@herald_state idle`. Idempotent.
- `herald curtain disarm` — remove the `_curtain` window and herald options from this session.
- `herald curtain cover <sess>` — if `@herald_state` is coverable and not already covered: refresh `@herald_live_win` to the current active window, `select-window` to `_curtain`, set `@herald_covered 1`.
- `herald curtain reveal <sess>` — if covered: `select-window` back to `@herald_live_win`, clear `@herald_covered`.
- `herald curtain focus "<title>"` — the Mac call. Enumerate armed sessions; find the one whose live-window label equals `<title>`; reveal it; cover every other armed session whose state is coverable. Empty/no-match title ⇒ reveal nothing, cover all coverable.
- `herald curtain reveal-all` — panic: reveal every covered armed session.

### State stamping (reuse phase-1 hooks)

The existing Claude hooks (`herald curtain event working|done|needs`, wired into `~/.claude/settings.json`) keep working. `event` is adapted to stamp `@herald_state`/`@herald_since` at **session scope** (derive the session from `$TMUX_PANE`). No cover/reveal happens on `event` — the card window already repaints the new state, and the next `focus` call re-covers as needed. This keeps cover/reveal driven solely by focus (simpler, YAGNI).

### Cover mechanism

`select-window` between the live claude window and the `_curtain` card window, remembering the live window id. Chosen over phase-1's `swap-pane`/`_holding` mirror because per-session window switching is simpler, needs no paired holding session, and restores cleanly. mosh-safe: it is a server-side window change that mosh syncs to the client normally.

### Card window + fail-open keypress

`_curtain` runs an adapted card-loop that reads **this session's own** `@herald_state`/`@herald_since` (no peer needed) and repaints once a second via `herald render --surface curtain-card`. The loop waits with `read -t 1 -n1` instead of `sleep 1`: **any keypress reveals the session** (`herald curtain reveal <thisSession>`), so a dead Mac agent can never trap you behind a card. Combined with `reveal-all`, the failure mode is always "you see live," never "frozen card."

## Component 2 — Mac Hammerspoon agent (built second, user-installed)

A Hammerspoon config (Lua) that:

1. Watches the frontmost app and Ghostty's focused-window title via an `AXTitleChanged` observer plus `hs.application.watcher` for app focus.
2. On any change, computes the current focused title (the active Ghostty tab's title), or empty string when Ghostty is not frontmost.
3. Debounces (~75 ms) and runs `ssh box 'herald curtain focus "<title>"'`.

### Transport — ssh + ControlMaster

`~/.ssh/config` on the Mac uses `ControlMaster auto` + `ControlPersist` so each focus event reuses one persistent connection (~10–30 ms), not a fresh handshake. Requires an existing passwordless key Mac → box (**assumption — confirm**; the fleet already ssh/moshes to the box).

### Wiring

- `repo-session` gains an opt-in that runs `herald curtain arm` after creating a `--claude` session, so new tabs auto-arm. (Manual `herald curtain arm` works meanwhile.)
- ControlMaster block documented in the README + the Mac install steps.

## Data flow (one tab switch)

1. User switches to the `syndcast` tab. Ghostty updates its window title to that tab's label.
2. Hammerspoon's title observer fires → title = `"Syndcast Backlog"`.
3. `ssh box 'herald curtain focus "Syndcast Backlog"'` over the ControlMaster socket.
4. Box: armed sessions = {syndcast, agentic-sage, token-oracle}. Match live-window label `"Syndcast Backlog"` → session `syndcast`. `reveal syndcast` (select-window to its live claude window). For agentic-sage & token-oracle: if coverable, `cover` (select-window to `_curtain`).
5. mosh syncs syndcast's live window to the tab → user sees live Claude; the others are already showing cards.

## Title → session mapping

The observed title is the tmux **active window name** (the Claude label from `session-sync.py`), not the session name. `focus` resolves it by matching each armed session's live-window name against `<title>`. Ambiguity (two tabs with identical labels) resolves to the most-recently-active / attached session, and is flagged if it bites in practice. (A future hardening: embed the session name in the title.)

## Error handling

- **Box CLI is hook-safe** (phase-1 discipline): every path swallows tmux/exec errors and exits 0; a broken tmux call is a no-op, never a thrown error into a Claude hook.
- **ssh failure / dead Mac agent:** sessions simply are not re-covered; you keep seeing live sessions. Never stuck: keypress-reveal + `reveal-all`.
- **Unarmed session:** `cover`/`reveal`/`focus` skip it (no `@herald_armed`).

## Testing

- **Box side (here, automated):** unit tests for `session.mjs` pure logic (focus resolution: which session matches, which get covered, coverable filter) with an injected tmux double. Integration test on an **isolated tmux server** (`TMUX_TMPDIR`, as in phase-1): `arm` → `cover`/`reveal`/`focus` change the active window correctly; `reveal-all` clears all; unarmed sessions untouched. Full suite stays green; zero runtime deps; biome clean.
- **Box side (manual, over real mosh):** `ssh box herald curtain cover syndcast` → flip to the tab → see the card; `reveal` → live. Proves the mechanic before any Lua exists.
- **Mac side:** not unit-testable from the box. Validated by the Phase-0 spike + manual acceptance.

## Phase 0 — load-bearing spike (gate, before the Mac agent)

Mirror the phase-1 discipline: prove the risky assumption before building on it. **Does Hammerspoon actually fire on Ghostty *tab* switches** (title change within one window), not only window/app switches? A minimal Hammerspoon snippet logs the focused title on every change; the user switches tabs; we confirm distinct titles arrive. Pass ⇒ build the agent. Fail ⇒ find another Ghostty focus signal (IPC / keybind action) first, before writing the full agent.

## Build order (vertical slices)

1. **Box engine + CLI** — `session.mjs`, the six subcommands, adapted card-loop with keypress-reveal, session-scoped `event` stamping, tests. Deliverable: manual `ssh box herald curtain …` cover/reveal/focus works over the user's real mosh.
2. **Phase-0 Hammerspoon spike** — confirm tab-switch detection on the user's Mac.
3. **Mac agent + wiring** — Hammerspoon title watcher → ssh; ControlMaster ssh config; `repo-session` auto-arm; README/install docs.

## Global constraints

- **Box side:** zero runtime dependencies; ESM `.mjs`; `node:*` builtins only; Node ≥ 20; `node:test`; biome dev-only. All hook/CLI paths hook-safe (swallow errors, exit 0). tmux options/hooks **session-scoped, never `-g`** for anything behavior-changing. **No reliance on terminal focus events reaching the box** (mosh drops them). Reuse phase-1 lower layers; do not fork them.
- **Mac side:** Hammerspoon (Lua); ssh with ControlMaster; passwordless key Mac → box; no secrets committed.
- **Naming:** card window `_curtain`; options `@herald_armed|state|since|covered|live_win`; focus keyed by title string.

## Out of scope

- **Grid-of-splits layout** (`ghostty-grid` all-visible in one window): macOS accessibility can't see which split is focused, and mosh drops split focus too — no viable signal. Explicitly unsupported in v1.
- **Grind Mode** (Mac idle-nag) — phase 2, separate spec; shares the Mac-agent infra.
- **Daemon/stream transport** — deferred; ControlMaster is enough for v1.
- **Title-collision hardening** beyond newest/attached.

## Assumptions to confirm

1. Passwordless ssh key Mac → box already exists (fleet uses it).
2. Ghostty's focused-window title reflects the active tab and changes on switch (user-confirmed) and is observable via Hammerspoon `AXTitleChanged` (Phase-0 spike verifies).
3. macOS Accessibility permission can be granted to Hammerspoon (one-time).

---

## Addendum (2026-07-09): OSS productionization — configurable trigger adapters

**Status:** design decision, supersedes the Hammerspoon-only trigger of Component 2. Driven by the Phase-0 spike outcome on real hardware.

### Product framing

status-herald ships as an **open-source UI toolkit for agentic development** — a family of terminal status surfaces (tmux status bar, Claude Code statusline, the tab **curtain**, more later) sharing one config and one engine. Every surface must be **enable/disable/customizable** and must not hardcode one user's environment. This addendum makes the per-tab curtain conform; the statusline/status-bar surfaces are **future work** (separate specs, same config file).

### Phase-0 outcome & pivot

The spike ran against the real Mac. Findings: Hammerspoon was **not installed**, there was **no Homebrew** to install it, and `osascript` accessibility was initially denied. But the box already reaches the Mac over a passwordless ssh alias (`mac-music`, used by the notify hooks), and once macOS **Accessibility** was granted, `osascript` over that ssh channel reads the frontmost Ghostty tab title reliably. Proven end-to-end on live data: focused tab `"[mosh] BTW questions about advisor plans"` → normalize → `"BTW questions about advisor plans"` → resolves to box session `syndcast-3`.

This is exactly the spec's Phase-0 fallback ("Fail ⇒ find another Ghostty focus signal"). The trigger is therefore **not Hammerspoon-specific**.

### Trigger = pluggable focus-source adapters

The box contract is unchanged and is the integration seam: **`herald curtain focus "<title>"`**. Anything that can name the focused terminal tab can drive the curtain. status-herald ships reference adapters; users pick one or write their own:

| Adapter | Mechanism | Best for |
|---|---|---|
| **ssh-osascript poll** (reference) | box polls the Mac's frontmost terminal-tab title over ssh (`osascript` + Accessibility), normalizes, calls `focus` on change | macOS + ssh already set up (mosh fleets); zero Mac install |
| **Hammerspoon** (alternative) | Mac-resident `AXTitleChanged`/focus observer pushes `focus` to the box | users who run Hammerspoon; event-driven, no polling |
| (community) | kitty remote-control, tmux-local focus, WezTerm, … | other terminals |

**Normalization** lives in the adapter (it knows its transport's quirks — e.g. mosh's `[mosh] ` title prefix). Adapters emit the **clean tmux window-name string**; the box `focus` stays exact-match against `windowNameOf(liveWin)` — a clean, adapter-agnostic contract. The strip list is config-driven so a user can tune it without editing code.

### Configuration

Zero-dependency JSON at `${XDG_CONFIG_HOME:-~/.config}/status-herald/config.json` (override with `HERALD_CONFIG`). Absent file ⇒ built-in defaults, so the tool works out of the box. Relevant curtain keys:

```json
{
  "curtain": {
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
}
```

- `curtain.enabled` — master switch; when false the CLI verbs no-op and the agent exits.
- `coverableStates` — which states cover (idle always excluded).
- `focus.source` — which adapter the agent launcher runs (`ssh-osascript` | `hammerspoon` | `manual`).
- `focus.pollMs`, `focus.ssh.*`, `focus.terminalApp`, `focus.titleStripPrefixes` — parameters for the ssh-poll adapter.
- `autoArm` — whether `repo-session` (or `arm-all`) arms sessions, and which.

A `herald config` command prints the resolved config (defaults + overrides) for debugging. The loader is `lib/config.mjs`, zero-dep, hook-safe (bad JSON ⇒ defaults + a stderr warning, never a throw).

### Deployment

- **Agent launcher:** `scripts/focus-agent/ghostty-ssh-poll.sh` — the reference adapter, reads config, loops `read focused title → normalize → herald curtain focus`. Bounded/`--once` mode for testing; unbounded for the service.
- **Service (opt-in):** a `systemd --user` unit **template** (`contrib/systemd/status-herald-curtain.service`) documented in the README; the user installs it (`systemctl --user enable --now`). Not force-installed.
- **Arming:** `herald curtain arm-all` arms every current session matching `autoArm.sessionGlob`; `repo-session` gains an opt-in `herald curtain arm` on new `--claude` tabs. Both honor `curtain.enabled`.

### Fail-open, unchanged

Keypress-reveal in the card loop + `herald curtain reveal-all` remain the safety net. If the ssh poll stalls (Mac asleep/off-network) the loop simply produces no focus changes; sessions keep their last state and nothing is stranded.

### Out of scope (this increment)

- Statusline and tmux status-bar surfaces (future specs; will reuse `lib/config.mjs`).
- The Hammerspoon adapter's full build (kept as documented alternative; the ssh-poll adapter is the shipped default).
- Non-macOS / non-Ghostty adapters (community).

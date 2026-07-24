---
type: spec
status: active
summary: "Fix broken status-bar curtain chrome: clickable pause/resume toggle, paused ▶ glyph, installable mouse binds. Click-only — no status-interval delay cost."
tags: [curtain, mouse, status-bar, pause, chrome]
created: 2026-07-24
updated: 2026-07-24
---

# Status chrome click (pause / resume)

## Goal

Operators can **disable** (pause) herald curtains with a cursor click on the
tmux status bar, and when paused see a **clickable re-enable** affordance.
Card chrome stays as secondary. **No extra work on `status-interval` / settle /
card frame paths.**

## Root cause (why it felt broken)

Runtime tmux binds pointed at missing surfaces:

- `herald curtain status-click` — not implemented in CLI
- `scripts/status-chrome-menu.sh` — file missing

Docs/AGENTS claimed status-right × off; card chrome existed but instant-focus
rarely keeps you on `_curtain`.

## Semantics

| Control | Action | State |
|---------|--------|--------|
| **Off / toggle when live** | `pause` | `@herald_paused=1`, live stays, no auto-cover; still armed |
| **On / toggle when paused** | `resume` | `@herald_paused=0`; covers may return |
| **Pet** | `cycleDenizen` | unchanged |
| Full tear-down | CLI `disarm` only | not default click |

## Surfaces

### Primary — status bar (click-only)

1. **`MouseDown1Status`** → `herald curtain status-click <range> <session>`  
   - Default action: **toggle** pause ↔ resume for that session (range ignored for toggle).
2. **`MouseDown1StatusRight`** → `herald curtain status-menu <session>`  
   - `display-menu`: × off, ▶ on, ↻ pet (and optional pause-all / resume-all later).

Binds installed idempotently from `arm` / `arm-all` via absolute herald path
(`run-shell -b`). Fail-open if session unarmed.

### Secondary — card chrome

Existing `[× off]` / `[↻ pet]` / keys / wheel — unchanged.

### Paused affordance (re-enable)

When paused, session status shows static glyph via tmux option (no `#()` shell):

- `@herald_chrome_hint` = `#[fg=yellow]▶ curtain#[default] ` while paused, else empty
- Session `status-right` (or left) includes `#{@herald_chrome_hint}` slot, injected once like wash bar-line (save/restore user format)
- Click status → **resume** when paused

## Non-goals

- No hit-test or chrome paint inside status-interval / session-sync / wash sample loop
- No change to settle TTLs or card `frame_ms`
- No default click = disarm

## Acceptance

1. Status click on armed session pauses curtain (live visible, no re-cover).
2. Paused glyph visible; status click resumes.
3. Status menu offers pause / resume / pet.
4. Card chrome still works.
5. Unit tests for resolve + pause/resume chrome slot; CLI smoke for status-click / status-menu.
6. `herald curtain arm` installs binds; missing-script path gone.

## Files

| Path | Role |
|------|------|
| `lib/curtain/status-chrome.mjs` | pure resolve + applyPauseChrome + bind install args |
| `lib/curtain/session.mjs` | pause/resume/disarm call applyPauseChrome; arm installs binds |
| `lib/cli.mjs` | `status-click`, `status-menu` |
| `scripts/status-chrome-menu.sh` | optional thin wrapper → CLI status-menu (compat with old binds) |
| `test/status-chrome.test.mjs` | unit tests |
| docs BESTIARY / README | correct primary path |

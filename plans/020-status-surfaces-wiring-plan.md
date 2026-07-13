# Plan 020: Status surfaces + side-effects + wiring (tmux + claude bars)

> **For the executor:** REQUIRED — TDD. Write the failing test, run it red, implement minimal, run green, commit. Steps use `- [ ]`. This is sub-plan 3 of the Slice 2 program (`plans/017-herald-native-bars.md`). It wires the two real surfaces on top of 019's compute layer. All tests must be hermetic (temp dirs, no live tmux writes, no mutation of real ~/.claude/settings or real status-right). The code added here must be callable without side effects in tests.

**Goal:** Implement `tmux-status` and `claude-statusline` render surfaces, the shared side-effects module (window options, session mirrors, model/state badges, safe tmux writes), the concrete segment registry with exact parity strings, config extension for `bars.*`, CLI wiring for the new surfaces, and `status doctor` (or extended doctor) checks. Safe install/uninstall patterns for the bar hooks (modeled on curtain).

**Architecture:** 
- Pure segment definitions live in `lib/status/segments.mjs` (or a thin registry loader) using the engine from 018.
- `lib/status/compute.mjs` (from 019) supplies the data ctx.
- `lib/status/side-effects.mjs` performs the idempotent tmux writes (never in unit tests).
- `lib/status/tmux-status.mjs` orchestrates discovery/side-effects + renders the account gauges line (the part that goes into status-right #( )).
- `lib/status/claude-statusline.mjs` reads Claude's stdin JSON, persists effort sidecar, feeds token-forecast snapshot (via bridge), and renders (or blanks) the statusline.
- Config and CLI are extended merge-friendly and fail-open.
- Doctor reports on bar wiring without ever clobbering foreign status-right/statusLine.

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, biome. Use only node:fs, node:child_process (for the feed exec hook), and tmux via exec when doing real side-effects (gated in tests).

## Global Constraints (from Plan 017 + prior plans)
- **Zero runtime dependencies.** No new npm packages.
- **Verify:** `node --test` and `./node_modules/.bin/biome check lib/status/*.mjs test/status-*.test.mjs lib/cli.mjs lib/config.mjs`. NEVER `npx biome`.
- **Fail-open everywhere on render paths** — any error → empty stdout + exit 0.
- **Hermetic tests only** — use temp dirs for sessions/, session-meta/, usage-cache fixtures, snapshot fixtures. Never read/write the operator's live ~/.claude or run real `tmux set` in tests (mock or skip side-effects).
- **Defaults reproduce today's exact look** — ACCOUNT on (in interim sense), model off for Claude bar, etc. The new config "bars" section defaults must make an absent config a no-op for visuals.
- **Parity** — context segment, slider, badge strings, @ctxbar written at both window + session scope, window rename uses tmux session name (not Claude label), etc.
- **Never disturb live sessions in this plan** — 020 code + tests touch nothing outside temp dirs. Real wiring (install) is best-effort with .bak + abort-on-foreign.
- Performance: side-effect writes must be idempotent (read-before-write like the Python sync_windows).

## Parity anchors (must hold in 020 surfaces)
From earlier Python + 017:
- @ctxbar at WINDOW scope **and** SESSION scope (for covered _curtain windows).
- Window rename: prefer `#{session_name}` (user-controlled via prefix+$); fall back to label only if unreadable.
- Context segment exact shape (emoji + #[fg=colour...] bar pct% used/win 💬 n).
- Account _slider: `🕐 #[fg=...]████░░░░ 2.7M/57.0M#[default]` (color by 50/85/100/120 thresholds; cyan/green/yellow/orange/red).
- Model badge short: "Opus 🧠xhigh", "Grok xhigh", "Sonnet".
- Claude statusline: full-width bg (WAIT_BG / WORK_BG) + padding using COLUMNS, silent "" when CLAUDE_BAR=off (but still write sidecar + feed).
- Effort sidecar atomic write path and shape unchanged.
- Snapshot feed is best-effort exec (the hook).
- Gauge roles and colors already in 018 ROLES.

Exact visible strings and roles must be asserted in tests using the fixture data.

## Module layout (additive)
New / extended files:
- `lib/status/segments.mjs` (extend 018): add the concrete registry + per-segment render fns that take compute ctx and return Item|null.
- `lib/status/side-effects.mjs` (new): `syncWindows(sessions, computeFor)`, `setSessionAndWindowOpts(name, opts)`, `writeUsageGauges?` (mostly the tmux-status will call these idempotently).
- `lib/status/tmux-status.mjs` (new): `renderTmuxStatus({panePid?})` → does side effects for live sessions + returns the account gauges string for stdout.
- `lib/status/claude-statusline.mjs` (new): `renderClaudeStatusline(stdinJson)` → writes meta + feed + returns the bar or "".
- `lib/config.mjs` (extend): add `bars: { tmux: {enabled, background?}, claude: {enabled, silentCapture}, segments: { context: {enabled, priority}, ... } }`
- `lib/cli.mjs` (extend): `runRender` supports `--surface tmux-status|claude-statusline`. Add or extend `status doctor`.
- Tests: `test/status-surfaces.test.mjs` (or split), using temp fixtures. Integration smoke that stays hermetic.
- Possibly a small `lib/status/util.mjs` for shared builders (ctx emoji, slider, etc.) if it keeps segments clean.

The segment registry is the single source of truth (as in 017). Both surfaces ask `orderSegments(registry, config)` then map to items via their renderers, then `renderLine`.

## Interfaces this plan PRODUCES (021+ will rely on these)
```js
// lib/status/segments.mjs (additions)
export const REGISTRY; // or getSegmentsRegistry(config)
export const buildContextItem(data); // {id:'context', text, short?, role, priority}
export const buildAccountSliderItem(type, blockOrWeekly); // 'account5h' | 'accountWeekly'
export const buildModelItem(badge);
export const buildStateItem(glyph); // ▶ / ⏸  (role accent/dim)

// lib/status/side-effects.mjs
export const writeWindowOpts(target, { ctxbar, model, state, color });
export const writeSessionOpts(sessionName, { ctxbar });
export const syncAllLive(opts); // best-effort, idempotent, never throws

// lib/status/tmux-status.mjs
export const renderTmuxStatus({ sessionsDir?, projectsDir?, panePid? } = {});
// returns the stdout string (account gauges when enabled) and has performed side-effects

// lib/status/claude-statusline.mjs
export const renderClaudeStatusline(jsonFromStdin, { metaDir?, feedCommand? } = {});
// returns the bar string (or "") and has done sidecar + optional feed

// lib/config.mjs (added to DEFAULTS and load)
export const DEFAULTS.bars = { tmux: {enabled:true}, claude:{enabled:true, silentCapture:false}, segments: { ... } };

// CLI
herald render --surface tmux-status [--pane-pid N]
herald render --surface claude-statusline   # reads stdin
herald status doctor   # or extends existing doctor
```

## Files touched / created
- Modify: `lib/status/segments.mjs`, `lib/config.mjs`, `lib/cli.mjs`
- Create: `lib/status/side-effects.mjs`, `lib/status/tmux-status.mjs`, `lib/status/claude-statusline.mjs`
- Create: `test/status-surfaces.test.mjs` (hermetic), additional fixtures if needed (e.g. claude-stdin-sample.json)
- Possibly small updates to README or bin/herald help text (minimal).

## Tasks

### Task 1 — Extend config with bars model + segment toggles (pure)

- [ ] **Step 1 (red):** in `test/status-surfaces.test.mjs` (or a config test), assert that `loadConfig()` with no file gives `bars.segments.context.enabled === true`, `account5h.enabled === false` (or match the "reproduce today" defaults decided in 017), and that a partial override only affects the listed keys.
- [ ] **Step 2:** run → fails (no bars in DEFAULTS yet).
- [ ] **Step 3:** add `bars` to DEFAULTS in `lib/config.mjs`. Use the shape from 017:
  ```json
  "bars": {
    "tmux": { "enabled": true },
    "claude": { "enabled": true, "silentCapture": false },
    "segments": {
      "context": { "enabled": true, "priority": 100 },
      "model":   { "enabled": false, "priority": 60 },
      "state":   { "enabled": true, "priority": 90 },
      "account5h": { "enabled": false, "priority": 30 },
      "accountWeekly": { "enabled": false, "priority": 20 },
      "clock": { "enabled": true, "priority": 10 },
      "notify": { "enabled": true, "priority": 40 }
    }
  }
  ```
  Keep merge behavior.
- [ ] **Step 4:** green. Add test that unknown segment keys are ignored.
- [ ] **Step 5:** commit `feat(status): bars config section with per-segment toggles + priorities`.

### Task 2 — Segment item builders + registry (pure, parity strings)

- [ ] **Step 1 (red):** tests with fixture compute data:
  - `buildContextItem({used:351000, win:1000000, pct:35, messages:5})` produces text containing "😬", "35%", "351k/1M", "💬 5" and role from gaugeRole(35).
  - Short form when present.
  - Account slider has correct emoji, bar length 8, color, tokens.
  - Model badge uses shortModelBadge.
  - orderSegments + registry produces enabled list in order.
- [ ] **Step 2:** run → red.
- [ ] **Step 3:** implement builders in `lib/status/segments.mjs` (or a new `segment-builders.mjs` if cleaner). Port exact emoji list `_CTX_EMOJI`, `_BAR_W=8`, color logic from Python (map to roles). Define a `REGISTRY` object whose `render` fns call the builders with data from ctx.
- [ ] **Step 4:** green + assert visibleWidth of produced plain text (before tmuxColor) matches expectations. Tie-break and drop tests using renderLine from 018.
- [ ] **Step 5:** commit `feat(status): segment builders + registry with exact parity strings`.

### Task 3 — Side-effects module (idempotent writes, no real tmux in tests)

- [ ] **Step 1 (red):** tests that call the functions with a mock `tmuxExec` spy. Assert that identical values are not re-written (read current, skip if same). Assert both window and session scope writes for ctxbar.
- [ ] **Step 2:** run → red.
- [ ] **Step 3:** implement `lib/status/side-effects.mjs`:
  - `getTmux(target, fmt)` / `setWindow(target, opt, val)` / `setSession(sess, opt, val)` wrappers (best-effort, swallow errors).
  - `writeCtxbar(target, bar, sessName?)` — writes @ctxbar at window, and also at session scope if sessName.
  - `writeModelAndState(target, modelBadge, glyph, color?)`.
  - `syncWindows(liveSessions, {getDataFor})` — for each, compute desired, read current, write only on change (like Python).
  - Never rename to Claude label if session_name is available.
- [ ] **Step 4:** green. Add a "covered window" test path (session option is written even if no window opt).
- [ ] **Step 5:** commit `feat(status): side-effects with idempotent tmux writes + session mirror`.

### Task 4 — tmux-status surface

- [ ] **Step 1 (red):** test `renderTmuxStatus({sessionsDir: tmp, ...})` returns the expected account gauges string when ACCOUNT conceptually on, calls side-effects (via spy), and respects config bars.segments.account* enabled.
- [ ] **Step 2:** run → red.
- [ ] **Step 3:** implement `lib/status/tmux-status.mjs`:
  - Use 019 `discoverLiveClaudeSessions` + grok paths.
  - For each, `buildPerSessionData` + grok detect.
  - Call side-effects.sync.
  - Build items for enabled segments that belong in the stdout (primarily the account ones; the per-session ctx is side-effected into @ctxbar).
  - `renderLine(items, {mode:'tmux', width: null})` or limited.
  - Return the joined string (fail-open to "").
- [ ] **Step 4:** green. Test narrow width drop for the gauges line if we expose width.
- [ ] **Step 5:** commit `feat(status): tmux-status surface (side effects + account gauges stdout)`.

### Task 5 — claude-statusline surface

- [ ] **Step 1 (red):** test with sample stdin JSON (model, effort, session_id, rate_limits, COLUMNS). Assert:
  - sidecar written (model + effort).
  - feedSnapshot called (spy).
  - when CLAUDE_BAR=off in temp conf or via flag, output is exactly "" but sidecar+feed still happened.
  - full render includes the bg, chip ("your turn" / "▶ working"), forecasts, model badge, notify icon, padding.
- [ ] **Step 2:** run → red.
- [ ] **Step 3:** implement `lib/status/claude-statusline.mjs`:
  - Parse stdin or {}.
  - Always `writeSessionMeta`.
  - Call `feedSnapshot` via the bridge (best effort).
  - If silent (config or explicit), return "".
  - Else compute status/elapsed from discovery or neutral, get account blocks, build model_nm, render using the Python logic ported (bg, padding by COLUMNS counting double-width).
  - Use role colors where appropriate, but the bar has its own special bg chips.
- [ ] **Step 4:** green. Test reset_note path, idle vs busy, bad COLUMNS.
- [ ] **Step 5:** commit `feat(status): claude-statusline surface (capture + render + silent mode)`.

### Task 6 — CLI integration + doctor

- [ ] **Step 1 (red):** tests or manual:
  - `node bin/herald render --surface tmux-status` succeeds and produces output (or "").
  - `node bin/herald render --surface claude-statusline` (pipe JSON) works.
  - Unknown surface still errors as before.
  - `herald doctor` (or `herald status doctor`) reports something about bar wiring (even if not yet installed).
- [ ] **Step 2:** run → red.
- [ ] **Step 3:** extend `runRender` in `lib/cli.mjs`. Add a `runStatus` or extend doctor with bar-specific checks (does the command look like herald render ... ?). Add help text.
- [ ] **Step 4:** green. Keep curtain doctor behavior unchanged.
- [ ] **Step 5:** commit `feat(status): cli render surfaces + doctor hooks for bars`.

### Task 7 — Full verification, hermetic tests, biome, parity

- [ ] **Step 1:** `node --test` → all green (including new surface tests).
- [ ] **Step 2:** `./node_modules/.bin/biome check` on changed + new files → 0 after `--write` if only formatting.
- [ ] **Step 3:** Manual parity spot-check: feed a real-ish transcript fixture + snapshot fixture through the builders + renderLine; compare plain text to Python reference on same numbers.
- [ ] **Step 4:** Confirm no live tmux was invoked during the test run (grep the test code or use a global mock guard if added).
- [ ] **Step 5:** commit `feat(status): surfaces + wiring + doctor (020 complete)`.
- [ ] **Step 6 (bonus):** Add one guarded live-smoke test (only runs with HERALD_TEST_LIVE=1) that exercises the real compute on this machine's sessions — document it.

## Done criteria
- `node --test` exits 0.
- Biome clean on the files.
- New surfaces exported and wired in CLI.
- All segment renders + side-effect paths have hermetic tests.
- Config "bars" section is merge-friendly and documented in the plan.
- Exact parity strings and @ctxbar dual-scope behavior asserted.
- No test ever mutates real ~/.claude or executes tmux set outside mocks.

## STOP conditions
- If a test would require a live attached tmux client or real status-right to pass, STOP and use mocks/fixtures instead.
- If implementing the full animated background (status-style bg) — that is Plan 022. 020 may stub the hook but must not implement the breathing wash.
- Do not touch the operator's real settings.json or tmux.conf.

## Risks & notes for 021
- Concurrent status-right invocations from multiple clients will all run the sync; idempotence is the only guard (same as today).
- The cutover (021) will point status-right at `herald render --surface tmux-status` and Claude's statusLine at the new surface, plus the ownership lock so Python can no-op.
- Grok panes will only ever get the tmux-status path (no claude-statusline stdin).

## Next after this plan
Plan 021 (cutover, gated, with rollback) and 022 (animated bg) can proceed in either order after 020 lands. Operator review required before any live flip.

This plan is intentionally additive and test-only for side effects so it can land on the live branch without risk.

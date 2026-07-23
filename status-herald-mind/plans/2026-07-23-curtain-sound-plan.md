# Curtain Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Ship default-off, pluggable curtain attention sound fired on NEEDS edge, with CLI + doctor, without assuming Mac or any backend.

**Architecture:** Pure policy + backend builders in `lib/curtain/sound.mjs`; fire-and-forget spawn from `stampFromHook` after state decision; config under `curtain.sound`; CLI mutates user config JSON safely.

**Tech Stack:** Node ESM, `node:test`, existing herald config/session/cli/doctor patterns.

**Spec:** `status-herald-mind/specs/2026-07-23-curtain-sound-design.md`

## Global Constraints

- Default `curtain.sound.enabled: false`; empty `backends: []`
- Fire only on edge into `needs` (and only if `events` includes `needs`)
- Fail-open: never throw from sound into hook path; never block hooks
- No Mac/afplay/hostname in DEFAULTS
- Dedupe via `@herald_sound_last` + `dedupeSec` (default 8)
- Tests hermetic: mock spawn; temp config dirs
- Spec/plan under mind; public docs soft update only

## File map

| File | Role |
|------|------|
| `lib/config.mjs` | DEFAULTS.curtain.sound |
| `lib/curtain/sound.mjs` | **new** pure shouldFire + buildCmds + fireSound + config mode helpers |
| `lib/curtain/session.mjs` | call fire after next state |
| `lib/cli.mjs` | `herald curtain sound …` |
| `lib/curtain/doctor.mjs` | soft sound check |
| `test/sound.test.mjs` | **new** unit tests |
| `test/config.test.mjs` | defaults assert |
| `test/session.test.mjs` or sound integration | edge fires spawn mock |
| `test/doctor.test.mjs` | soft line |
| `docs/getting-started.md` | optional sound section |
| `CHANGELOG.md` | Unreleased entry |
| Atlas zone cards | config + curtain-core |

---

### Task 1: Config defaults + pure sound module + unit tests

**Files:**
- Modify: `lib/config.mjs`
- Create: `lib/curtain/sound.mjs`
- Create: `test/sound.test.mjs`
- Modify: `test/config.test.mjs`

**Interfaces:**
- `export const SOUND_MODES = new Set(["day","night","off"])`
- `shouldFireSound(cfg, ctx) → boolean`  
  ctx: `{ prevState, nextState, covered, nowSec, lastFireSec }`
- `commandsForBackends(backends, mode) → string[]` shell command lines to run locally
- `fireSound(cfg, ctx, deps) → { fired: boolean, commands: string[] }`  
  deps: `{ spawn, setLastFire }` optional
- `normalizeSoundCfg(raw) → full sound cfg`
- `readSoundStatus(cfg) → { enabled, mode, backendCount }`
- `patchSoundConfig(path, patch) → { ok, path }` merge into JSON file

- [ ] **Step 1:** Add defaults to `lib/config.mjs`:

```js
sound: {
  enabled: false,
  mode: "day",
  events: ["needs"],
  onlyWhenCovered: false,
  dedupeSec: 8,
  backends: [],
},
```

- [ ] **Step 2:** Write `test/sound.test.mjs` covering:
  - shouldFire false when disabled / mode off / no backends / wrong edge / onlyWhenCovered && !covered / within dedupe
  - shouldFire true on working→needs with enabled + backends + day
  - commandsForBackends: command, ssh, ntfy, local alias; empty day skips
  - fireSound calls spawn once per command, never throws on spawn error
  - patchSoundConfig creates/merges file

- [ ] **Step 3:** Implement `lib/curtain/sound.mjs` minimal to pass.

- [ ] **Step 4:** Assert defaults in `test/config.test.mjs`.

- [ ] **Step 5:** `node --test test/sound.test.mjs test/config.test.mjs` green; commit.

---

### Task 2: Wire stampFromHook

**Files:**
- Modify: `lib/curtain/session.mjs`
- Modify: `test/session.test.mjs` (or add cases)

**Interfaces:**
- After computing `next`, before/after setSessOpt state:
  - read covered, lastFire
  - if shouldFire → fireSound; set `@herald_sound_last`

- [ ] **Step 1:** Failing test: mock tmux + mock sound deps; stamp Notification permission_prompt from idle/working with sound enabled → spawn called; second stamp same needs within dedupe → not called again.

- [ ] **Step 2:** Wire `stampFromHook` to import and call sound helpers; pass `cfg.sound` from curtain cfg.

- [ ] **Step 3:** Tests green; commit.

---

### Task 3: CLI + doctor + docs

**Files:**
- Modify: `lib/cli.mjs`
- Modify: `lib/curtain/doctor.mjs`
- Modify: `test/doctor.test.mjs`, `test/curtain-cli.test.mjs` if present
- Modify: `docs/getting-started.md`, `CHANGELOG.md`, `AGENTS.md` brief
- Atlas: zone cards config + curtain-core

- [ ] **Step 1:** CLI `sound` subcommand: status / day|night|off / enable|disable / test
- [ ] **Step 2:** Doctor soft check
- [ ] **Step 3:** Docs + changelog
- [ ] **Step 4:** Full `npm test`; commit

---

### Task 4: Operator profile note (no auto-enable on user machine in code)

Document how to enable Manjaro→Mac in getting-started. Do **not** write the user's private ntfy topic or music path into the repo. Optional: if implementing live enable for the user machine, only via local config outside git.

# HERALD Motion Language, Flexible Bars, Look Packs & OSS Eyes — Program Design

**Status:** approved design (brainstorming 2026-07-14); umbrella program — pre-plan / pre-execute  
**Date:** 2026-07-14  
**Branch at design:** `design/herald-per-tab-curtain`  
**Approach:** full program umbrella (capture everything); implement **Phase 1 (eyes-first)** first  
**Repo plan tree:** executable phase plans will land under `plans/` after writing-plans (023+)

## Goal

Make HERALD feel like a **premium terminal product**: one shared **motion language** driven by curtain state, projected at high resolution onto **curtain cards** and at low resolution onto **tmux (and Claude) status bars**, with **look packs**, **local/remote animation profiles**, and an **OSS-first** path that looks expensive without config — while staying **lightweight over mosh / Tailscale / VPN**, **zero runtime deps**, and **fail-open**.

This is a **program design**, not a single executable plan. Phase 1 is the first build; later phases are locked here so compaction and context loss cannot erase them.

## Product sentence

HERALD is the status layer for agent terminals — glanceable cards and bars so you know WORKING / DONE / NEEDS YOU without babysitting panes. Themes and look packs are how users take identity; adapters and cutover are how fleets stay correct.

## Why this exists

### Operator ask (2026-07-14)

- Flexible bottom bar shared by **Claude statusline** and **tmux bar**.
- **Tmux by default** in the product stance (fleet + Grok-capable).
- When the curtain shows WORKING (etc.), the **tmux bar should animate** (gradient/breathing wash) accordingly.
- Polish **curtain animations**; treat UX as primary (“eyes are the judge”).
- Presets / configuration flexibility for open source (thousands of GitHub stars ambition).
- Lightweight for: Manjaro local tmux, MacBook mosh over Tailscale, occasional commercial VPN.

### Current state (verified at design time)

| Layer | Status |
|-------|--------|
| Curtain flipbook (frames, `settleAfter`, covered-only ~2 fps) | Shipped (014/016) |
| Themes `classic` / `minimal` / `forge` | Shipped |
| Curtain ↔ bar chrome (`curtain.tmuxBar.whenCovered`) | Shipped |
| Bar segment engine + `tmux-status` / `claude-statusline` (020) | **Library + CLI only** — not fleet-installed |
| Bar breathing wash (Plan 022 sketch in 017) | **Not built** |
| Safe bar cutover (Plan 021 sketch in 017) | **Not built** |
| Shared motion language card ↔ bar | **Missing** — bars use Claude busy/idle, not `@herald_state` for wash |
| Demo/preview CLI, look packs, animation profiles | **Missing** |

### Research inputs (2026-07-14)

Eight agents (5 codebase + 3 web research) converged on:

1. **One state machine → two FPS budgets** (card ~2 fps covered; bar ~1 Hz).
2. **Whole-bar `status-style` wash**, not spatial gradients (window-list gap).
3. **Unify 016 + 022 `status-style` ownership** or cover/reveal will fight wash.
4. **Post-settle throttle + skip identical frames** before raising FPS.
5. **Persistent per-window card runtime** (not global daemon) as the real perf investment.
6. **JSON-only themes**; look packs as overlays; no 002–006 marketplace revival.
7. **OSS wins on demo + defaults + README GIF**, not focus-adapter cleverness.
8. **Accessibility:** soft luminance pulses; never hard red strobe ≥3 Hz (WCAG 2.3.1).

## Principles (non-negotiable)

1. **Eyes first.** Correct logic is required; the card and bar are what people star.
2. **One motion language.** States mean the same emotion on every surface.
3. **Paint state instantly; tick the clock slowly.** Hooks stamp; loops sample.
4. **Fail-open always.** Any key reveals; paint never traps; hooks never block agents.
5. **Zero runtime deps.** Themes = JSON data; never `eval` / dynamic import of themes.
6. **Progressive enhancement.** Local richer; remote degrades motion without feature death.
7. **Classic path stays safe.** Empty config remains today’s classic behavior unless a versioned launch-defaults decision says otherwise.
8. **Two product lanes.** Day-1 = local wow; Advanced = mosh + Mac focus + fleet cutover.
9. **No daemons for animation.** Per-card long-lived process is OK; global animation agent is not.
10. **Never `status off` for cover.** Geometry reflow is forbidden; style-only coupling only.

## Non-goals (whole program)

- Reviving Plans 002–006 generic provider/preset marketplace.
- JS community theme modules / code execution.
- Spatial truecolor rainbows across the full tmux bar as v1.
- Global animation daemon coordinating all sessions.
- Requiring Ghostty, mosh, Hammerspoon, or a personal SSH host on day 1.
- Breaking classic golden tests without an explicit launch-defaults decision.
- Implementing full 021 fleet cutover inside Phase 1.

---

## Architecture

### Motion authority

```
Agent hooks
  → stampFromHook → @herald_state / @herald_since / bg counts
                        │
        ┌───────────────┴────────────────┐
        ▼                                ▼
 Curtain card path                  Bar surfaces
 (covered ~2 fps; uncovered 1 Hz)   (≤1 Hz via status-interval)
        │                                │
        └──────── motion module ─────────┘
                 pure: state + since + now
                 → phase, palette step, settle flag
```

**Rule:** Curtain `@herald_state` + `@herald_since` is the **motion source of truth**.

- Bar binary busy/idle (`▶`/`⏸`) may remain for Python-parity glyphs until cutover.
- **Wash, attention pulse, and “alive” bar mood** read herald state, not only Claude session JSON.
- When herald state is unavailable (unarmed session), bars fall back to idle/static (fail-open).

### New module: motion language

**Path (recommended):** `lib/motion.mjs` (or `lib/status/background.mjs` for bar-only + shared export from `lib/motion.mjs`).

**Contract (pure, hermetic, zero I/O):**

```
input:  { state, sinceMs|sinceSec, nowMs, cfg }
output: {
  mode: "static" | "loop" | "settle",
  barBg: "default" | colour|hex,   // for status-style
  barFg?: ...,
  settled: boolean,                 // past done settle window
  cardHints?: { fgCycleIndex?, bgCycleIndex? },
  periodSec, amp, hueFamily
}
```

### Default motion table

| State | Emotion | Bar (~1 Hz) | Card (~2 fps when covered) |
|-------|---------|-------------|----------------------------|
| `idle` | Calm | `bg=default` / no wash | Static / minimal |
| `working` | Flow | Slow amber luminance wash, period ~8s, small amp | Richer frames; optional soft `bgCycle` on solid themes |
| `done` | Settle | Soft green pulse ~`doneFlashSec` (default 3) then hold calm | `settleAfter` frames → freeze **and throttle repaint** |
| `needs` | Attention | Soft rose pulse, period ~3s — **never** saturated red hard blink | Multi-frame soft pulse (not single static `/!\`) |
| `compacting` | Pressure | Cool steel / violet-gray slow dim cycle | Existing press art + polish |

**Accessibility:**

- Amplitude limited (prefer ± luminance on a mid-dark base).
- No full-bar flash >3 hard transitions/s.
- Config `animated: false` / reduced-motion → static semantic colors + glyphs only.
- Color is never the only signal (glyphs/labels remain).

### `status-style` ownership (016 × 022 unified)

**Problem:** Plan 016 save/restores full `status-style` on cover/reveal; Plan 022 continuously sets bar bg. Without one owner, cover clobbers wash or restore strands wash under transparent.

**Single compositor** (session/side-effects helper):

```
effectiveStatusStyle =
  userBase                          // saved once when first mutating
  compose breathBg?                 // phase color when wash enabled && not suppressed
  compose coverTransparent?         // while covered: force bg=default (016)
```

Rules:

1. **Cover transparent wins** over breath while covered (card owns the visual field).
2. **Reveal:** restore `userBase`, then reapply breath from pure phase (idempotent).
3. **Phase is a pure function of (state, since, wall clock)** so multi-session `#()` invokers compute the same color.
4. Only write tmux when the computed style **string differs** from current (reduce churn).
5. Crash path: existing card EXIT trap → reveal → restore (016) still holds.

### Curtain card path (existing + extensions)

Keep:

- Pure `renderCard(state, elapsed, cols, rows, bg, theme, tick)`.
- Theme data frames + `settleAfter`.
- Covered-only hot `@herald_frame_ms`; uncovered 1 Hz.
- Rename-safe untargeted `show-options`.
- Fail-open keypress + EXIT trap.
- No `\x1b[2J` full clear.

Add:

- **Post-settle throttle** in loop/runtime after `tick > settleAfter` (or motion `settled`).
- **Skip write if frame bytes === last** (mosh-friendly).
- Richer theme data (Phase 1); optional `fgCycle`/`bgCycle` for solid themes.
- Later: **persistent per-window Node runtime** (bash owns key/trap).

### Bar surfaces path (existing + extensions)

Keep:

- `segments.mjs` registry, roles, priority width-drop.
- `bars.segments.*` enable/priority config.
- Fail-open empty stdout exit 0.
- `tmux-status` side-effects for `@ctxbar` / `@model` / `@state` (session mirror for covered `_curtain`).

Add:

- Read `@herald_state` / `@herald_since` for wash (Phase 1).
- `bars.tmux.background: { animated, doneFlashSec }` (default **animated: false** until pack/user enables — classic-safe).
- Clock/notify injection or default-off until real (Phase 3 honesty).
- `min(client_width)` into `renderLine` (Phase 3).
- Safe install/cutover (Phase 3).

Claude statusline:

- Remains optional paint surface; may keep WAIT/WORK chips.
- Feed shared registry segments where it reduces drift.
- Wash is **tmux-primary**; Claude chips already encode busy/idle mood.

---

## Flexible bars product model

### Tmux-first stance

| Surface | Product role |
|---------|----------------|
| **tmux status** | Default fleet bar; Claude + Grok; owns breathing wash |
| **Claude statusline** | Optional; effort sidecar + feed still valuable; `silentCapture` supported |

“Tmux by default” does **not** mean “disable Claude for everyone.” It means:

1. Install/cutover docs and tooling prioritize `status-right` → `herald render --surface tmux-status`.
2. Claude `statusLine` is a second, explicit step (or opt-in flag).
3. Defaults keep Claude paint enabled when that surface is installed, unless user sets silent/off.

### Segment model (v1)

- Fixed registry (017 DECISION 1) — **not** a generic provider engine.
- Per-segment `enabled` + `priority` + `order`.
- Width drop: shorten then drop lowest priority (already implemented).
- Community “content presets” deferred; **look packs** may carry segment *deltas* only.

### Cutover safety (Phase 3 — high risk)

Harvest Plan 017/021 sketches:

| Requirement | Detail |
|-------------|--------|
| Abort-on-foreign | Non-empty non-herald `status-right` / `statusLine` → refuse rewrite |
| Marker block | Exact herald-owned block + `.bak` |
| Fail-open wrapper | Empty + exit 0 on any error |
| Ownership lock | Python dual-writers no-op when herald owns |
| Canary | Single session → fleet |
| Rollback | One-command restore from backup |
| Doctor deep | Marker, absolute node+herald, snapshot path, suggested next command |

**STOP:** Phase 1 does not rewrite live fleet `status-right`. Wash code is additive; operator canary may point one session at herald manually.

---

## Curtain animation polish

### What feels crude today (fix targets)

1. Forge working is a 3-frame flipbook at 2 fps (stop-motion).
2. NEEDS is almost static (weakest motion on the most important state).
3. Minimal WORKING is static while compacting/done move.
4. DONE freezes art but still full-repaints at hot rate (waste + no calm).
5. No shared bar mood with the card.

### Phase 1 data polish

| Change | Scope |
|--------|--------|
| Richer forge `working` frames (6–12), same anvil motif | `themes.mjs` |
| NEEDS multi-frame soft pulse on forge + minimal | `themes.mjs` |
| Light minimal `working` animation | `themes.mjs` |
| Post-settle throttle in card loop | `curtain-card-session.sh` and/or runtime |
| Skip identical frame write | loop/runtime |
| Optional solid `bgCycle` / `fgCycle` | theme schema + compositor |
| Document settle timing vs fps (`settleAfter` ticks at configured fps) | docs; optional `settleAfterMs` later |

### classic invariant

- **classic** remains glyph/label solid black, **no** required multi-frame, golden tests green.
- New motion richness lives on forge/minimal/signal and user themes.

### Runtime roadmap (Phase 2)

```
_curtain window
  curtain-card-session.sh   # trap + key → reveal
    └─ long-lived node card-runtime.mjs
         read @herald_* → tick → render → write if changed → sleep(pace)
```

Benefits: remove per-tick Node boot; safe local 3–4 fps; mosh quieter with byte-skip.

Deferred: dirty-row paint, fifo-wake on cover, cross-state morph.

### Safe FPS policy

| Link | Card covered | Card uncovered | Bar wash |
|------|--------------|----------------|----------|
| Local | 2 fps default (3–4 after Phase 2) | 1 Hz | 1 Hz if on |
| Mosh/Tailscale | 1–2 fps (`remote` profile → 1) | 1 Hz | 1 Hz or off |
| VPN degraded | 1 fps / static after settle | 1 Hz+ | off or rare |

Hard cap via `animation.maxFps` (optional) and profile clamps.

---

## Config: profiles, look packs, themes

### Animation profiles

```json
"curtain": {
  "animation": {
    "fps": 2,
    "profile": "local"
  }
}
```

| Profile | Intent | Policy |
|---------|--------|--------|
| `local` | Desktop / low latency | Hot covered rate from `fps`; full multi-frame |
| `remote` | Mosh fleet | Cap ≤ 1 Hz covered; keep frames but slow |
| `minimal` | Quiet / battery | Static cadence; wash off preference |

**Explicit `fps` always wins** over profile-derived rates when set.

### Look packs (visual overlays — not 006 content presets)

**Resolution:** `DEFAULTS ← look pack fragment ← user JSON` (user last).

**Default `look`:** unset / `classic` with **empty overlay** ⇒ identical to today’s `loadConfig`.

Built-in packs:

| Pack | Curtain theme | `tmuxBar.whenCovered` | Bar wash | Segment deltas |
|------|---------------|------------------------|----------|----------------|
| `classic` | classic | keep | off | none |
| `forge` | forge | transparent | optional on | none required |
| `pulse` | minimal/soft | transparent | **on** | aesthetic only |
| `zen` | minimal | transparent | off | optional hide noisy segments |
| `signal` | brand solid + semantic (optional Phase 4/5) | transparent | soft | OSS default candidate |

Config keys (additive):

```json
{
  "look": "forge",
  "lookBySession": {},
  "looks": {
    "ops": {
      "curtain": {
        "theme": "forge",
        "animation": { "profile": "local", "fps": 2 },
        "tmuxBar": { "whenCovered": "transparent" }
      },
      "bars": {
        "tmux": { "background": { "animated": true, "doneFlashSec": 3 } },
        "segments": { "model": { "enabled": true } }
      }
    }
  },
  "curtain": {
    "theme": "classic",
    "themeBySession": {},
    "themes": {},
    "animation": { "fps": 2, "profile": "local" },
    "tmuxBar": { "whenCovered": "keep" }
  },
  "bars": {
    "tmux": {
      "enabled": true,
      "background": { "animated": false, "doneFlashSec": 3 }
    },
    "claude": { "enabled": true, "silentCapture": false },
    "segments": { }
  }
}
```

### Community themes (safe)

- **JSON only** + structural `validateTheme` (frame caps: e.g. ≤32 frames, ≤24 lines, ≤120 cols, size cap).
- Install path: merge into `curtain.themes.<name>` or later `~/.config/status-herald/themes/*.json` via JSON.parse only.
- **Never** load theme `.mjs` / Function / eval.
- CLI: `list` / `preview` / `set` / `validate`.

### Custom frames today (already works)

Users can define `curtain.themes.<name>.states.*.frames` + `settleAfter` in config.json. Look packs and validate are progressive layers on this.

---

## OSS eyes & defaults

### Day-1 path (Lane A)

```bash
npm i -g status-herald
herald curtain install && herald curtain doctor
herald curtain demo
# optional wow grid:
herald curtain up --slots 2 --cmd claude   # or grok
```

### Required CLI (Phase 1)

| Command | Purpose |
|---------|---------|
| `herald curtain demo` | Full-screen fake state cycle without agent hooks |
| `herald curtain preview [--theme] [--state] [--tick]` | Authoring / screenshots |
| Grouped help / doctor next-step line | Onboarding |

Phase 4/5 adds: `theme list|set|validate`, `look list|show`, packaging hygiene.

### Defaults strategy (two layers)

1. **Compat defaults (code, Phase 1–4):** keep `curtain.theme: classic`, `tmuxBar.whenCovered: keep`, wash `animated: false` so no-config operators see no surprise.
2. **Launch defaults (Phase 5 decision):** optional switch to forge/`signal` + transparent cover for OSS 0.1.0 — **explicit decision**, not silent Phase 1 change.

**Neutralize personal DEFAULTS in product docs and preferably in code defaults over time:** no required `mac-music` / Ghostty-only happy path. Mac focus adapters = Advanced / profile `remote-mac`.

### Docs structure (Phase 5, sketched now)

```
README.md              # product page: hero GIF, 3 commands, themes
docs/GETTING-STARTED.md
docs/CURTAIN.md
docs/THEMES.md
docs/FOCUS-ADAPTERS.md # advanced
docs/BARS.md
docs/CONFIG.md
```

Plans under `plans/` remain engineer-facing; README must describe **shipped** reality only.

---

## Use cases encoded

| Setup | Profile / pack guidance |
|-------|-------------------------|
| Manjaro local tmux | `local` + `forge` + wash on |
| MacBook mosh → Manjaro (Tailscale) | `remote` + `minimal` or forge@1fps; event-driven focus preferred |
| + commercial VPN | `minimal`; wash off or rare; settle throttle mandatory |
| Multi ~10–15 tabs | Covered-only hot path + settle throttle non-negotiable |

Focus path remains optional for day-1 grid; multi-tab mosh remains Advanced.

---

## Phased delivery

| Phase | Name | Delivers | Risk | Depends |
|-------|------|----------|------|---------|
| **1** | **Motion + eyes** | `motion` pure module; bar wash from `@herald_*`; unified status-style compose; richer frames + NEEDS pulse; settle throttle; skip identical frame; `demo`/`preview`; look-pack schema + classic/forge packs; profile knobs; tests | Med | 016, 020 |
| **2** | **Card runtime perf** | Persistent per-window renderer; optional fifo-wake; safer higher local fps | Med | Phase 1 |
| **3** | **Bar cutover** | Safe install, abort-on-foreign, doctor deep, clock/notify real, width min-client, ownership lock, canary/rollback | **High** — operator-gated | Phase 1; 017/021 harvest |
| **4** | **Look packs + community** | pulse/zen/signal packs; themes dir; validate CLI; gallery | Low | Phase 1 |
| **5** | **OSS launch** | README/GIF/VHS; packaging ≥0.1.0; launch-defaults decision; CONTRIBUTING themes; neutralize personal defaults | Product | Phase 1+ demo; ideally Phase 3 if marketing bars |

### Phase 1 success criteria (must pass before claiming “eyes-first done”)

- [ ] When `@herald_state=working` and wash enabled, **tmux bar bg flows** (slow amber) at ≤1 Hz while surface runs.
- [ ] DONE: card settles; bar green pulse then calm; **card repaint throttles** after settle.
- [ ] NEEDS: card multi-frame soft pulse; bar soft rose wash (no hard red strobe).
- [ ] Covered-only hot tick retained; fleet spawn math not worse than today.
- [ ] `herald curtain demo` shows the language without hooks/tmux arm.
- [ ] No look pack / classic path: **unchanged** default behavior (golden classic green).
- [ ] status-style cover transparent **composes** with wash without stranding.
- [ ] `node --test` green; biome clean on touched files.
- [ ] **No** live fleet `status-right` rewrite in Phase 1 executors.

### Phase 1 STOP conditions

- Executor must not run `herald curtain …` against live operator sessions, edit `~/.config` / `~/.tmux.conf`, or touch Mac focus units.
- If session `status-style` wash leaks globally on operator tmux version → disable wash default, leave feature behind flag, document STOP.
- If wash + cover compose fails hermetic tests → fix compose before shipping wash.

---

## Relationship to prior plans

| Plan | Relationship |
|------|----------------|
| 014 themes | Keep model; extend frames and optional cycles |
| 016 anim + bar coupling | Keep covered gate, settle, transparent cover; **compose** with wash |
| 017 native bars umbrella | Harvest; this program absorbs 022 into Phase 1 and 021 into Phase 3 |
| 018–020 | Keep segments/compute/surfaces; wire wash + later cutover |
| 021 cutover | **Phase 3** of this program (write executable plan when starting Phase 3) |
| 022 background | **Phase 1** motion/bar wash (executable plan under Phase 1 writing-plans) |
| 002–006 presets | Still YAGNI as marketplace; look packs only |
| 011–012 OSS/brand | Phase 5 |

Executable plans after this design:

- `plans/023-…` (or dated superpowers plan) for **Phase 1** only first.
- Later phases get their own plans when dispatched.

---

## Testing strategy

| Layer | Tests |
|-------|--------|
| Motion pure | Phase colors, settle boundaries, reduced-motion static, idempotent phase at fixed `now` |
| Theme frames | NEEDS multi-frame; forge working length; classic byte-identical |
| status-style compose | cover+wash, reveal restore, keep mode, no stranded bg |
| Card loop | settle throttle + (where feasible) skip-identical; bash -n |
| Surfaces | wash no-op when disabled; fail-open |
| Config | look pack merge; empty look ≡ DEFAULTS; profile clamps |

No flaky wall-clock tests: inject `now`.

---

## Open decisions (explicit)

### Launch default (Phase 5 — not Phase 1)

Choose at OSS launch, document in Phase 5 plan:

1. Keep classic code DEFAULTS forever; recommend `look: forge` in README, **or**
2. At 0.1.0 switch DEFAULTS to forge + transparent cover, **or**
3. Introduce `signal` brand default; classic/forge remain named.

**Phase 1 decision:** leave code DEFAULTS as classic/keep/wash-off. Operator may set `look: forge` + wash on in their config without waiting for launch.

### Module path naming

Prefer `lib/motion.mjs` as shared pure language; bar-specific apply may live in `lib/status/background.mjs` importing motion. Final names chosen in Phase 1 plan without changing this design’s contracts.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| 016/022 status-style fight | Single compose helper + tests first |
| Node spawn storm on multi-tab | Keep covered gate; settle throttle; Phase 2 persistent runtime |
| Mosh jank | remote profile 1 fps; skip identical frames; transparent themes preferred |
| Live bar cutover blanks fleet | Phase 3 only; abort-on-foreign; canary; operator gate |
| OSS bounce on Mac/mosh story | Lane A demo/local first; adapters Advanced |
| Scope explosion | Umbrella here; **only Phase 1** implements after writing-plans |
| Compaction loss | This file is the durable map; commit on design branch |

---

## Implementation sequence after this design

1. **User reviews this spec file** (gate).
2. **writing-plans** → detailed Phase 1 executable plan (TDD, file paths, tasks).
3. Execute Phase 1 in worktrees; no Phase 2–5 code until those plans exist and are approved.
4. Operator-only: enable wash + forge on personal fleet when Phase 1 lands.

---

## Appendix A — Research north stars (compressed)

- *Paint state instantly, tick the clock once per second, never reflow, never block the paint path — on remote links, color carries more meaning than motion.*
- *tmux status is a 1 Hz strip; continuous animation belongs in the curtain pane.*
- *Whole-bar wash > spatial gradient for state mood.*
- *Time-to-wow &lt; 30s; demo CLI + GIF; default must look designed.*
- *Themes as data; look packs as overlays; user config always last.*

## Appendix B — Suggested operator config after Phase 1 (not code defaults)

```json
{
  "look": "forge",
  "curtain": {
    "animation": { "profile": "remote", "fps": 1 },
    "tmuxBar": { "whenCovered": "transparent" }
  },
  "bars": {
    "tmux": {
      "background": { "animated": true, "doneFlashSec": 3 }
    }
  }
}
```

Local Manjaro without mosh tax: `"profile": "local", "fps": 2`.

## Appendix C — Checklist for future self / compacted sessions

If context was compacted, recover from this file:

1. Program goal + principles  
2. Motion authority = `@herald_state`  
3. Phase 1 vs 2–5 table  
4. status-style compose rules  
5. Look pack merge order  
6. Non-goals and STOP conditions  
7. Open launch-defaults decision deferred to Phase 5  

Do **not** re-brainstorm from zero; amend this design if product intent changes.

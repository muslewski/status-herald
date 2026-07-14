# Herald Motion Language Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shared pure motion language, wire tmux bar breathing wash from `@herald_state`, polish curtain frames (especially NEEDS), harden resize + settle + motion-off, and add demo/preview + look-pack config — without live fleet cutover.

**Architecture:** Pure `lib/motion.mjs` maps state + timestamps → bar palette phase and settle flags. Card path stays pure `renderCard` + bash loop (geometry-dirty force repaint, settle throttle, skip-identical). Bar wash applies via composed `status-style` in session/side-effects so cover-transparent (016) and breath (022) do not fight. Look packs and animation profiles are deep-merge overlays; defaults remain classic-safe.

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, local biome, bash card loop, tmux session options.

**Spec:** `docs/superpowers/specs/2026-07-14-herald-motion-surfaces-program-design.md`  
**Also indexed as:** `plans/023-motion-language-phase1.md` (pointer)

## Global Constraints

- Zero runtime npm dependencies (biome dev-only).
- Fail-open: paint/hooks never throw to agents; card key always reveals.
- classic theme golden path stays byte-identical when no look pack / motion extras fire on classic.
- `bars.tmux.background.animated` defaults **false**; wash opt-in via config or look pack.
- No live `status-right` / `~/.tmux.conf` rewrite (Phase 3 only).
- No executor touches live operator tmux, `~/.config`, or Mac focus units.
- Covered-only hot tick retained; uncovered stays ≤1 Hz.
- Accessibility: no hard red strobe ≥3 Hz; soft rose for needs.
- User config always merges last over look packs.

## File map (create / modify)

| Path | Role |
|------|------|
| **Create** `lib/motion.mjs` | Pure motion language + phase → bar bg |
| **Create** `lib/looks.mjs` | Builtin look packs + `applyLook` / `resolveEffectiveConfig` |
| **Create** `test/motion.test.mjs` | Motion unit tests |
| **Create** `test/looks.test.mjs` | Look pack merge tests |
| **Modify** `lib/config.mjs` | animation.enabled/profile/reducedMotion; bars.tmux.background; look keys |
| **Modify** `lib/curtain/themes.mjs` | Richer forge/minimal frames; NEEDS pulse |
| **Modify** `lib/surfaces/curtain-card.mjs` | Honor motion-disabled tick (static frame); optional cycles |
| **Modify** `lib/curtain/session.mjs` | `composeStatusStyle` / wash + cover; stampTheme respects motion off |
| **Modify** `lib/status/tmux-status.mjs` | Apply wash from herald state (injectable) |
| **Modify** `lib/status/side-effects.mjs` | Optional `setSession status-style` helper if needed |
| **Modify** `scripts/curtain-card-session.sh` | geometry dirty, settle throttle, skip-identical, motion-off pace |
| **Modify** `lib/cli.mjs` | `demo`, `preview`; help text |
| **Modify** tests: `config`, `themes`, `curtain-card`, `session`, `status-surfaces`, loop grep tests |

---

### Task 1: Config defaults — animation knobs + bar background + look keys

**Files:**
- Modify: `lib/config.mjs`
- Modify: `test/config.test.mjs`

**Interfaces:**
- Produces: `DEFAULTS.curtain.animation = { enabled: true, fps: 2, profile: "local", reducedMotion: false, maxFps: 4 }`
- Produces: `DEFAULTS.bars.tmux.background = { animated: false, doneFlashSec: 3 }`
- Produces: `DEFAULTS.look = undefined` omitted; use no `look` key or `look: null` — prefer **omit** so merge is clean. Document that missing `look` ≡ classic. Add `looks: {}` empty object.
- Consumes: existing `merge` / `loadConfig`

- [ ] **Step 1: Write the failing tests**

Add to `test/config.test.mjs`:

```js
test("animation defaults include enabled, profile, reducedMotion, maxFps", () => {
  const c = loadConfig(join(tmpdir(), "nope-herald-anim-xyz.json")).curtain
    .animation;
  assert.equal(c.enabled, true);
  assert.equal(c.fps, 2);
  assert.equal(c.profile, "local");
  assert.equal(c.reducedMotion, false);
  assert.equal(c.maxFps, 4);
});

test("bars.tmux.background defaults wash off", () => {
  const b = loadConfig(join(tmpdir(), "nope-herald-wash-xyz.json")).bars.tmux
    .background;
  assert.equal(b.animated, false);
  assert.equal(b.doneFlashSec, 3);
});

test("user can enable wash and disable motion via merge", () => {
  const cfg = merge(DEFAULTS, {
    curtain: { animation: { enabled: false, reducedMotion: true } },
    bars: { tmux: { background: { animated: true } } },
  });
  assert.equal(cfg.curtain.animation.enabled, false);
  assert.equal(cfg.curtain.animation.reducedMotion, true);
  assert.equal(cfg.bars.tmux.background.animated, true);
  assert.equal(cfg.bars.tmux.background.doneFlashSec, 3);
});
```

- [ ] **Step 2: Run tests — expect FAIL** (missing keys)

Run: `node --test test/config.test.mjs`  
Expected: FAIL on new assertions.

- [ ] **Step 3: Implement DEFAULTS**

In `lib/config.mjs`, replace `animation: { fps: 2 }` with:

```js
animation: {
  enabled: true,
  fps: 2,
  profile: "local", // "local" | "remote" | "minimal"
  reducedMotion: false,
  maxFps: 4,
},
```

Under `bars.tmux`:

```js
tmux: {
  enabled: true,
  background: { animated: false, doneFlashSec: 3 },
},
```

Add top-level (sibling of curtain/bars):

```js
looks: {},
// look is optional string; omit from DEFAULTS so merge(DEFAULTS, {look:"forge"}) works
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test test/config.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/config.mjs test/config.test.mjs
git commit -m "feat(config): animation profiles, reducedMotion, bar wash defaults"
```

---

### Task 2: Pure motion module

**Files:**
- Create: `lib/motion.mjs`
- Create: `test/motion.test.mjs`

**Interfaces:**
- Produces:
  - `export const motionDisabled = (animCfg) => boolean`
  - `export const effectiveFps = (animCfg) => number` // 0 or static → treat as 1 Hz stamp
  - `export const sampleMotion = ({ state, sinceSec, nowSec, backgroundCfg, animCfg }) => { mode, settled, barBg, barFg, periodSec }`
  - `barBg`: `"default"` | tmux-compatible colour string like `colour234` or `#1a1408` — **use 256 colourN for portability in v1**
- Consumes: none (pure)

**Palette (fixed constants in motion.mjs):**

```js
// Mid-dark bases; soft amp via discrete steps (N=8)
const PALETTES = {
  working: ["colour233", "colour234", "colour235", "colour236", "colour235", "colour234", "colour233", "colour232"],
  done: ["colour233", "colour235", "colour237", "colour235", "colour233", "colour232", "colour232", "colour232"],
  needs: ["colour52", "colour88", "colour52", "colour236", "colour52", "colour88", "colour52", "colour236"],
  compacting: ["colour233", "colour234", "colour235", "colour234", "colour233", "colour232", "colour233", "colour234"],
  idle: null, // → barBg "default"
};
const PERIOD = { working: 8, done: 3, needs: 3, compacting: 5, idle: 0 };
```

- [ ] **Step 1: Write failing tests** (`test/motion.test.mjs`)

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  effectiveFps,
  motionDisabled,
  sampleMotion,
} from "../lib/motion.mjs";

test("motionDisabled true when enabled false or reducedMotion", () => {
  assert.equal(motionDisabled({ enabled: false }), true);
  assert.equal(motionDisabled({ reducedMotion: true }), true);
  assert.equal(motionDisabled({ enabled: true, reducedMotion: false }), false);
});

test("effectiveFps respects profile remote cap and maxFps", () => {
  assert.equal(effectiveFps({ enabled: false, fps: 2 }), 0);
  assert.equal(effectiveFps({ enabled: true, fps: 2, profile: "local", maxFps: 4 }), 2);
  assert.equal(effectiveFps({ enabled: true, fps: 4, profile: "remote", maxFps: 4 }), 1);
  assert.equal(effectiveFps({ enabled: true, fps: 2, profile: "minimal", maxFps: 4 }), 1);
});

test("idle → default bg, not settled loop", () => {
  const m = sampleMotion({
    state: "idle",
    sinceSec: 100,
    nowSec: 110,
    backgroundCfg: { animated: true, doneFlashSec: 3 },
    animCfg: { enabled: true, reducedMotion: false },
  });
  assert.equal(m.barBg, "default");
  assert.equal(m.mode, "static");
});

test("working wash steps through palette with wall clock", () => {
  const a = sampleMotion({
    state: "working",
    sinceSec: 0,
    nowSec: 0,
    backgroundCfg: { animated: true, doneFlashSec: 3 },
    animCfg: { enabled: true },
  });
  const b = sampleMotion({
    state: "working",
    sinceSec: 0,
    nowSec: 4,
    backgroundCfg: { animated: true, doneFlashSec: 3 },
    animCfg: { enabled: true },
  });
  assert.equal(a.mode, "loop");
  assert.match(a.barBg, /^colour\d+$/);
  // phase advanced — may or may not differ by 4s; force enough delta
  const c = sampleMotion({
    state: "working",
    sinceSec: 0,
    nowSec: 0,
    backgroundCfg: { animated: true, doneFlashSec: 3 },
    animCfg: { enabled: true },
  });
  const d = sampleMotion({
    state: "working",
    sinceSec: 0,
    nowSec: 8,
    backgroundCfg: { animated: true, doneFlashSec: 3 },
    animCfg: { enabled: true },
  });
  // full period: same step index 0
  assert.equal(c.barBg, d.barBg);
  assert.notEqual(a.barBg, b.barBg); // mid-period shift at 4s of 8s period with 8 steps
});

test("done settles after doneFlashSec", () => {
  const early = sampleMotion({
    state: "done",
    sinceSec: 100,
    nowSec: 101,
    backgroundCfg: { animated: true, doneFlashSec: 3 },
    animCfg: { enabled: true },
  });
  const late = sampleMotion({
    state: "done",
    sinceSec: 100,
    nowSec: 110,
    backgroundCfg: { animated: true, doneFlashSec: 3 },
    animCfg: { enabled: true },
  });
  assert.equal(early.settled, false);
  assert.equal(late.settled, true);
  assert.equal(late.mode, "static");
});

test("wash off or motion disabled → default bg even when working", () => {
  const m = sampleMotion({
    state: "working",
    sinceSec: 0,
    nowSec: 5,
    backgroundCfg: { animated: false, doneFlashSec: 3 },
    animCfg: { enabled: true },
  });
  assert.equal(m.barBg, "default");
  const m2 = sampleMotion({
    state: "working",
    sinceSec: 0,
    nowSec: 5,
    backgroundCfg: { animated: true, doneFlashSec: 3 },
    animCfg: { enabled: false },
  });
  assert.equal(m2.barBg, "default");
});

test("needs uses soft rose colour family not pure red strobe", () => {
  const colors = new Set();
  for (let t = 0; t < 12; t++) {
    const m = sampleMotion({
      state: "needs",
      sinceSec: 0,
      nowSec: t,
      backgroundCfg: { animated: true, doneFlashSec: 3 },
      animCfg: { enabled: true },
    });
    colors.add(m.barBg);
    assert.notEqual(m.barBg, "red");
    assert.notEqual(m.barBg, "colour196");
  }
  assert.ok(colors.size >= 2, "pulse uses more than one step");
});
```

Adjust the working mid-period assertion if step math differs — period 8s, 8 steps → step = floor((now%8)/1) so now=0 and now=4 differ.

- [ ] **Step 2: Run — expect FAIL** (module missing)

Run: `node --test test/motion.test.mjs`

- [ ] **Step 3: Implement `lib/motion.mjs`**

```js
// Pure motion language for curtain + bar. No fs, no tmux, no Date.now inside
// helpers that take nowSec — caller injects time.

export const motionDisabled = (anim = {}) =>
  anim.enabled === false || anim.reducedMotion === true;

export const effectiveFps = (anim = {}) => {
  if (motionDisabled(anim)) return 0;
  let fps = Number(anim.fps);
  if (!Number.isFinite(fps) || fps <= 0) fps = 2;
  const profile = anim.profile || "local";
  if (profile === "remote" || profile === "minimal") fps = Math.min(fps, 1);
  const max = Number(anim.maxFps);
  if (Number.isFinite(max) && max > 0) fps = Math.min(fps, max);
  return Math.max(1, Math.round(fps));
};

const PERIOD = { working: 8, done: 3, needs: 3, compacting: 5, idle: 0 };
const PALETTES = {
  working: ["colour233", "colour234", "colour235", "colour236", "colour235", "colour234", "colour233", "colour232"],
  done: ["colour233", "colour235", "colour237", "colour235", "colour233", "colour232", "colour232", "colour232"],
  needs: ["colour52", "colour88", "colour52", "colour236", "colour52", "colour88", "colour52", "colour236"],
  compacting: ["colour233", "colour234", "colour235", "colour234", "colour233", "colour232", "colour233", "colour234"],
};

const stepIndex = (nowSec, periodSec, n) => {
  if (!periodSec || n <= 0) return 0;
  const t = Math.max(0, Number(nowSec) || 0);
  const u = t % periodSec;
  return Math.min(n - 1, Math.floor((u / periodSec) * n));
};

/**
 * @returns {{ mode: "static"|"loop"|"settle", settled: boolean, barBg: string, periodSec: number }}
 */
export const sampleMotion = ({
  state,
  sinceSec,
  nowSec,
  backgroundCfg = {},
  animCfg = {},
} = {}) => {
  const st = state || "idle";
  const washOn =
    backgroundCfg.animated === true && !motionDisabled(animCfg);
  if (!washOn || st === "idle") {
    return { mode: "static", settled: true, barBg: "default", periodSec: 0 };
  }
  const periodSec = PERIOD[st] ?? 8;
  const palette = PALETTES[st];
  if (!palette) {
    return { mode: "static", settled: true, barBg: "default", periodSec: 0 };
  }
  if (st === "done") {
    const flash = Number(backgroundCfg.doneFlashSec);
    const doneFlashSec = Number.isFinite(flash) && flash >= 0 ? flash : 3;
    const since = Number(sinceSec) || 0;
    const now = Number(nowSec) || 0;
    const elapsed = Math.max(0, now - since);
    if (elapsed >= doneFlashSec) {
      return {
        mode: "static",
        settled: true,
        barBg: palette[palette.length - 1],
        periodSec: doneFlashSec,
      };
    }
    const idx = stepIndex(elapsed, doneFlashSec, palette.length);
    return {
      mode: "settle",
      settled: false,
      barBg: palette[idx],
      periodSec: doneFlashSec,
    };
  }
  const idx = stepIndex(nowSec, periodSec, palette.length);
  return {
    mode: "loop",
    settled: false,
    barBg: palette[idx],
    periodSec,
  };
};

/** Build status-style string from user base + optional wash bg + cover transparent. */
export const composeStatusStyle = ({
  userBase = "",
  barBg = "default",
  coverTransparent = false,
} = {}) => {
  const parts = [];
  if (userBase) parts.push(userBase);
  if (coverTransparent) parts.push("bg=default");
  else if (barBg && barBg !== "default") parts.push(`bg=${barBg}`);
  else if (!userBase) parts.push("bg=default");
  // If userBase set and barBg default and not cover: keep userBase only
  if (!coverTransparent && (barBg === "default" || !barBg) && userBase)
    return userBase;
  if (!coverTransparent && (barBg === "default" || !barBg) && !userBase)
    return "";
  return parts.join(",");
};
```

Tune `composeStatusStyle` carefully in tests (Task 4) — the logic above is a sketch; final behavior:

- coverTransparent → always end with `bg=default` (append to userBase like today).
- else if wash colour → append `bg=colourN` to userBase (or set if empty).
- else restore pure userBase / empty.

- [ ] **Step 4: Run tests — PASS** (fix compose tests in Task 4 if needed)

Run: `node --test test/motion.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add lib/motion.mjs test/motion.test.mjs
git commit -m "feat(motion): pure state→phase language for bar wash"
```

---

### Task 3: Look packs (classic empty + forge overlay)

**Files:**
- Create: `lib/looks.mjs`
- Create: `test/looks.test.mjs`
- Modify: `lib/cli.mjs` only if needed later (Task 8)

**Interfaces:**
- `export const BUILTIN_LOOKS = { classic: {}, forge: { curtain: {...}, bars: {...} } }`
- `export const resolveConfig = (userOverlay, defaults = DEFAULTS) => config`  
  Actually: `resolveEffectiveConfig(rawUser = {}, defaults = DEFAULTS)`:
  1. `packName = rawUser.look`
  2. `pack = BUILTIN_LOOKS[packName] || rawUser.looks?.[packName] || {}`
  3. return `merge(merge(defaults, packAsConfig(pack)), rawUser)` without double-applying look key issues — strip `look`/`looks` from pack application carefully.

Simpler approach matching design:

```js
export const packFragment = (name, userLooks = {}) => {
  if (!name || name === "classic") return {};
  return BUILTIN_LOOKS[name] || userLooks[name] || {};
};

export const resolveEffectiveConfig = (path) => {
  // load raw JSON if file exists, else {}
  const user = readUserObject(path);
  const frag = packFragment(user.look, user.looks);
  return merge(merge(DEFAULTS, frag), user);
};
```

**Important:** `loadConfig` today is used everywhere. Either:
- **(A)** Change `loadConfig` to apply look packs, or  
- **(B)** Keep `loadConfig` as pure DEFAULTS←user and add `loadConfigWithLooks` used by surfaces.

**Choose (A)** with classic empty: if no `look` key, fragment `{}` → identical to today.

```js
// inside loadConfig after parse:
const user = JSON.parse(...);
const frag = packFragment(user.look, user.looks);
return merge(merge(DEFAULTS, frag), user);
```

Builtin forge pack:

```js
forge: {
  curtain: {
    theme: "forge",
    animation: { profile: "local", fps: 2 },
    tmuxBar: { whenCovered: "transparent" },
  },
  bars: {
    tmux: { background: { animated: true, doneFlashSec: 3 } },
  },
},
```

- [ ] **Step 1: Failing tests** — no look ≡ deep equal structure of DEFAULTS for curtain.theme classic; look forge sets theme forge and wash animated true; user override theme wins last.

- [ ] **Step 2: Implement looks + wire loadConfig**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(config): look packs classic/forge with user-last merge"
```

---

### Task 4: status-style compose — cover + wash (session.mjs)

**Files:**
- Modify: `lib/curtain/session.mjs` (`applyBar` → use compose)
- Modify: `lib/motion.mjs` (`composeStatusStyle` finalized)
- Modify: `test/session.test.mjs`
- Modify: `test/motion.test.mjs` (compose unit tests)

**Interfaces:**
- Produces: `applyBar(sess, covered, t, cfg, wash = { barBg })` or read wash from cfg+session state inside applyBar
- Design rule: while covered + transparent mode → `bg=default` wins; while revealed + wash → append wash bg; save **userBase** once (original status-style before herald mutations)

**Refactor applyBar:**

1. On first herald mutation of status-style, ensure `@herald_user_status_style` saved (user base). Keep `@herald_prev_status_style` for 016 compat OR migrate:
   - Prefer: `@herald_user_status_style` = true user base never containing herald wash tokens.
2. When covering with transparent: set style = compose(userBase, coverTransparent=true)
3. When revealing: set style = compose(userBase, coverTransparent=false, barBg from sampleMotion)
4. New export `applyBarWash(sess, t, fullCfg)` called from tmux-status: if not covered, compose wash onto user base.

**Hermetic tests:**

```js
test("compose: cover transparent wins over wash colour", () => {
  assert.equal(
    composeStatusStyle({
      userBase: "bg=colour234,fg=white",
      barBg: "colour236",
      coverTransparent: true,
    }),
    "bg=colour234,fg=white,bg=default",
  );
});

test("compose: wash appends when not covered", () => {
  assert.equal(
    composeStatusStyle({
      userBase: "fg=white",
      barBg: "colour236",
      coverTransparent: false,
    }),
    "fg=white,bg=colour236",
  );
});
```

Existing transparent cover/reveal tests must still pass.

- [ ] Implement + test + commit

```bash
git commit -m "feat(curtain): compose status-style for cover transparent + wash"
```

---

### Task 5: Wire wash into tmux-status surface

**Files:**
- Modify: `lib/status/tmux-status.mjs`
- Modify: `test/status-surfaces.test.mjs`

**Behavior:**

After side-effects / before or after stdout gauges:

1. If `bars.tmux.background.animated !== true` → skip wash (existing).
2. For **current session** if known: read `@herald_state`, `@herald_since`, `@herald_covered` via injectable exec.
3. `sampleMotion(...)`; if covered and tmuxBar transparent, skip wash write (cover owns bg).
4. `composeStatusStyle` + set session `status-style` only if changed.
5. Multi-session: Phase 1 may wash **only the session that invoked** status (env `TMUX` / display) OR iterate armed sessions — prefer **all sessions with `@herald_armed=1`** using pure phase (idempotent), same pattern as syncWindows.

**Injectables for tests:** `getSessOpt`, `setSessOpt`, `listArmed`, `now`.

```js
test("renderTmuxStatus applies wash bg when animated and working", async () => {
  const sets = [];
  await renderTmuxStatus({
    config: merge(DEFAULTS, {
      bars: { tmux: { background: { animated: true } } },
    }),
    skipSideEffects: true, // still allow wash path — use skipSideEffects only for window sync; OR add applyWash: true
    now: 1000,
    // inject wash deps
    wash: {
      sessions: [{ name: "s1", state: "working", since: 990, covered: false }],
      setStyle: (sess, style) => sets.push([sess, style]),
    },
  });
  assert.ok(sets.some(([s, st]) => s === "s1" && /bg=colour/.test(st)));
});
```

Design the inject surface cleanly so tests stay hermetic without real tmux.

- [ ] Implement + PASS + commit

```bash
git commit -m "feat(status): tmux bar wash from @herald_state motion"
```

---

### Task 6: Theme polish — forge/minimal frames + NEEDS pulse

**Files:**
- Modify: `lib/curtain/themes.mjs`
- Modify: `test/themes.test.mjs` and/or `test/curtain-card.test.mjs`

**Requirements:**

1. **forge.working:** expand to 6–9 frames (keep anvil motif, 7-wide rows where possible).
2. **forge.needs:** ≥3 frames soft pulse (e.g. grow/shrink `/!\` or intensity spaces) — not a single static frame only.
3. **minimal.needs:** ≥2 frames pulse.
4. **minimal.working:** ≥2 frames (subtle).
5. **classic:** unchanged (no new frames).

```js
test("forge needs has multi-frame pulse", () => {
  const n = BUILTINS.forge.states.needs.frames;
  assert.ok(Array.isArray(n) && n.length > 1);
});

test("classic working still has no frames", () => {
  assert.equal(BUILTINS.classic.states.working.frames, undefined);
});
```

- [ ] Implement frames carefully (visual craft).
- [ ] Run: `node --test test/themes.test.mjs test/curtain-card.test.mjs`
- [ ] Commit

```bash
git commit -m "feat(themes): richer forge/minimal motion; NEEDS pulse frames"
```

---

### Task 7: Card loop — geometry dirty, settle throttle, skip-identical, motion off

**Files:**
- Modify: `scripts/curtain-card-session.sh`
- Modify: `lib/curtain/session.mjs` (`stampTheme` uses `effectiveFps` / `motionDisabled`)
- Modify: `test/curtain-card-session.test.mjs` (grep-style) and `test/session.test.mjs`

**Bash loop additions:**

```bash
prev_cols=; prev_rows=
last_frame=
# after reading state/theme...
cols=$(tput cols 2>/dev/null || echo 80)
rows=$(tput lines 2>/dev/null || echo 24)
geom_dirty=0
if [ "$cols" != "${prev_cols}" ] || [ "$rows" != "${prev_rows}" ]; then
  geom_dirty=1
  prev_cols=$cols
  prev_rows=$rows
fi

# settle throttle: if state is done|compacting and tick high, slow down
# (approx: if theme settleAfter known hard — simpler rule:)
# after tick>12 on done → treat as settled for pace (or pass --force via env)
frame=$(herald render ... ) 
if [ "$geom_dirty" != "1" ] && [ "$frame" = "$last_frame" ]; then
  : # skip write
else
  printf '%s' "$frame"
  last_frame=$frame
fi
```

**Caveat:** capturing full frame in bash variable may strip NUL — ANSI is fine. Use `printf %s`.

**stampTheme:**

```js
import { effectiveFps, motionDisabled } from "../motion.mjs";
// ...
const fps = effectiveFps(cfg.animation || {});
const animated = !motionDisabled(cfg.animation) && isAnimated(theme) && fps > 0;
const ms = animated ? Math.round(1000 / fps) : 1000;
```

**Tests:**

- grep script for `geom_dirty` or `prev_cols`
- grep for skip / last_frame
- stampTheme with `animation.enabled: false` → frame_ms 1000 even for forge

- [ ] Implement + commit

```bash
git commit -m "fix(curtain): resize dirty repaint, settle throttle, skip identical frames"
```

---

### Task 8: CLI demo + preview

**Files:**
- Modify: `lib/cli.mjs`
- Modify: `test/curtain-cli.test.mjs` (or new)

**Commands:**

```
herald curtain demo [--theme forge] [--once]
herald curtain preview [--theme forge] [--state working] [--tick 0] [--cols 80] [--rows 24]
```

**demo behavior:**
- Loop states: idle → working → compacting → needs → done (with increasing tick / fake elapsed).
- No tmux required; write to stdout; `--once` paints one cycle frame sequence and exits.
- Ctrl+C / any key optional (for interactive: raw mode if TTY).

**preview:** single `renderCardFrame` to stdout (wrap existing render path).

```js
test("curtain preview exits 0 and prints WORKING", () => {
  const out = execFileSync(process.execPath, [heraldBin, "curtain", "preview",
    "--theme", "classic", "--state", "working", "--tick", "0",
    "--cols", "40", "--rows", "10"], { encoding: "utf8" });
  assert.match(out.replace(/\x1b\[[0-9;]*m/g, ""), /WORKING/);
});
```

- [ ] Implement + commit

```bash
git commit -m "feat(cli): curtain demo and preview for motion language"
```

---

### Task 9: Integration polish + docs pointer + full suite

**Files:**
- Modify: `README.md` — short “Motion / look packs / demo” subsection (honest: Phase 1; wash needs animated config; no fleet cutover claim)
- Modify: `plans/README.md` or `plans/023-motion-language-phase1.md` pointer to this plan + mark status
- Run full test suite + biome on touched files

- [ ] **Step 1: README snippet**

```markdown
### Motion & looks (Phase 1)

- `herald curtain demo` — preview states without an agent
- `herald curtain preview --theme forge --state needs`
- Config: `"look": "forge"` enables forge art + transparent cover bar + optional wash
- `"curtain": { "animation": { "enabled": false } }` disables multi-frame motion
- Bar wash: `"bars": { "tmux": { "background": { "animated": true } } }` (requires tmux-status surface wired)
```

- [ ] **Step 2: Full verify**

```bash
node --test
./node_modules/.bin/biome check lib/motion.mjs lib/looks.mjs lib/config.mjs lib/curtain/session.mjs lib/curtain/themes.mjs lib/surfaces/curtain-card.mjs lib/status/tmux-status.mjs lib/cli.mjs scripts/curtain-card-session.sh
```

- [ ] **Step 3: Final commit**

```bash
git commit -m "docs: Phase 1 motion language usage notes"
```

---

## Out of scope (do not implement in this plan)

- Phase 2 persistent card runtime / SIGWINCH interrupt
- Phase 3 bar cutover / abort-on-foreign install
- Phase 4 community themes directory / pulse/zen/signal packs beyond forge
- Phase 5 OSS launch GIF / npm 0.1.0 / default theme flip
- Changing classic DEFAULTS to forge

## STOP conditions (executors)

- Do not run `herald curtain arm|cover|focus` against the operator’s live fleet.
- Do not edit `~/.tmux.conf`, `~/.config/status-herald/config.json`, or Mac focus scripts.
- If compose tests cannot reconcile 016 + wash, stop wash shipping and leave behind `animated: false` only.

## Self-review (plan vs spec)

| Spec Phase 1 item | Task |
|-------------------|------|
| motion.mjs | T2 |
| bar wash from @herald_* | T5 |
| unified status-style | T4 |
| richer frames + NEEDS | T6 |
| settle throttle + skip identical | T7 |
| demo/preview | T8 |
| look packs classic/forge | T3 |
| profile knobs | T1 + T2 effectiveFps |
| geometry dirty | T7 |
| motion disable / reducedMotion | T1 + T2 + T7 stampTheme |
| classic-safe defaults | T1 defaults + T3 empty classic |
| no live cutover | Global STOP |

---

## Done criteria (Phase 1)

- All tasks committed; `node --test` green.
- Wash works under test inject when `animated: true`.
- `look: forge` resolves theme forge without breaking no-look classic.
- Resize path forces repaint (script assertions).
- `animation.enabled: false` freezes multi-frame and wash.
- Operator can enable personally via config after merge (not done by executor).

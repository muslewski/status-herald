# Curtain Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the curtain card's look data-driven — themes, per-session binding, a transparent background, and animated per-state ASCII art — without adding a runtime dependency or changing output for anyone who does nothing.

**Architecture:** A theme is a plain data object (built-in JS constant or user JSON under `config.curtain.themes.<name>`). The pure `renderCard` takes a resolved theme + a `tick` integer and returns exactly `rows` lines; animation is `frames[tick % n]`, so render stays deterministic and `node --test`-able. Themes are selected per session by a glob map resolved once at arm time and forwarded to the render CLI. The current hardcoded look becomes the built-in `classic` theme, byte-identical, so existing users and goldens are unaffected.

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, `@biomejs/biome`. Spec: `plans/014-curtain-themes.md`.

## Global Constraints

- **Zero runtime dependencies** — dev-only (`node --test`, biome). No npm packages, no figlet/font libraries.
- **`classic` theme output is byte-identical** to today's `renderCard` for every state. Existing `test/curtain-card.test.mjs` assertions must pass unchanged.
- **Fail-open on render** — bad theme name → fall back to `classic`, never throw.
- **Do not disturb running tmux sessions.** Loop-script (`scripts/curtain-card-session.sh`) changes reach already-armed sessions only via the non-destructive `herald curtain refresh` (respawns the hidden `_curtain` window, preserves every `@herald_*` option). Never kill a live window or session.
- **No new config files** — themes live in the single XDG `config.json` under `curtain.themes.<name>`; deep-merge via the existing `lib/config.mjs` `merge`.
- Test runner: `node --test [file]`. Lint/format: `npx biome check .`.

---

### Task 1: `render.mjs` — SGR-passthrough color + per-line erase

Extend `color()` so a theme can pass a raw SGR code (a number like `33`, or a string like `"1;36"` / `"48;5;234"`) in addition to the existing named colors, and add `eraseLine()` for the transparent-mode anti-ghost discipline. Purely additive; named colors keep working.

**Files:**
- Modify: `lib/render.mjs`
- Test: `test/render.test.mjs` (create)

**Interfaces:**
- Produces: `color(text, { fg, bg, bold })` where `fg`/`bg` accept a named key (`"brightGreen"`, `"black"`), a number (`33`), or a raw SGR digit/semicolon string (`"48;5;234"`); `eraseLine(): string` → `"\x1b[K"`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
// test/render.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { color, eraseLine } from "../lib/render.mjs";

test("color keeps named colors working", () => {
  assert.equal(color("x", { fg: "brightGreen" }), "\x1b[92mx\x1b[0m");
  assert.equal(color("x", { bg: "black" }), "\x1b[40mx\x1b[0m");
});

test("color accepts a raw numeric SGR code as fg", () => {
  assert.equal(color("x", { fg: 33 }), "\x1b[33mx\x1b[0m");
});

test("color accepts a raw SGR string (256-color) for bg", () => {
  assert.equal(color("x", { bg: "48;5;234" }), "\x1b[48;5;234mx\x1b[0m");
});

test("color ignores an unknown named token instead of throwing", () => {
  assert.equal(color("x", { fg: "chartreuse" }), "x");
});

test("eraseLine is the erase-to-end-of-line CSI", () => {
  assert.equal(eraseLine(), "\x1b[K");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.mjs`
Expected: FAIL — `eraseLine` is not exported; `color("x",{fg:33})` returns `"x"`.

- [ ] **Step 3: Write minimal implementation**

In `lib/render.mjs`, add a resolver and rewrite `color`; add `eraseLine`:

```js
// Resolve a color spec to an SGR parameter string: a named key, a raw number
// (30-107 style SGR), or a pre-formed digit/semicolon string ("38;5;208").
const sgrOf = (val, table) => {
  if (val == null) return null;
  if (typeof val === "number") return String(val);
  if (table[val] != null) return String(table[val]);
  if (typeof val === "string" && /^[0-9;]+$/.test(val)) return val;
  return null;
};

export const color = (text, { fg, bg, bold } = {}) => {
  const codes = [];
  if (bold) codes.push(1);
  const f = sgrOf(fg, FG);
  if (f) codes.push(f);
  const b = sgrOf(bg, BG);
  if (b) codes.push(b);
  if (codes.length === 0) return text;
  return `${CSI}${codes.join(";")}m${text}${CSI}0m`;
};

// Erase from the cursor to the end of the line. Emitted after every rendered
// line in transparent mode so a shorter new frame cannot leave the previous
// frame's cells behind (no full-width bg fill overwrites them there).
export const eraseLine = () => `${CSI}K`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/render.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Confirm nothing else regressed + lint**

Run: `node --test && npx biome check .`
Expected: all pass (existing `curtain-card` tests still green — classic uses named colors, whose output is unchanged).

- [ ] **Step 6: Commit**

```bash
git add lib/render.mjs test/render.test.mjs
git commit -m "feat(render): SGR-passthrough color + eraseLine for themes"
```

---

### Task 2: `themes.mjs` — data model, `classic` builtin, resolution

Create the theme registry with the `classic` builtin (byte-identical anchor), plus resolution helpers. `classic` is data-only: glyph/label/fg per state, `background: "solid"`, `bgColor: "black"`. Move `globToRe` and export `merge` from `config.mjs` so theme resolution reuses them without a cycle.

**Files:**
- Create: `lib/curtain/themes.mjs`
- Modify: `lib/config.mjs` (export `merge`; add + export `globToRe`)
- Modify: `lib/curtain/session.mjs` (import `globToRe` from config instead of its local copy)
- Test: `test/themes.test.mjs` (create)

**Interfaces:**
- Produces:
  - `BUILTINS` — object keyed by theme name; `BUILTINS.classic` present.
  - `themeNameFor(sessionName, curtainCfg)` → string theme name (first `themeBySession` glob match, else `theme`, else `"classic"`).
  - `resolveThemeByName(name, curtainCfg?)` → merged theme object (`builtin ← curtainCfg.themes[name] ← top-level background/bgColor/layout overrides`); unknown name falls back to `classic`.
  - `isAnimated(theme)` → boolean (any state has `frames.length > 1`).
- Consumes: `merge`, `globToRe`, `loadConfig` from `lib/config.mjs`.

- [ ] **Step 1: Export `merge` and `globToRe` from `config.mjs`**

In `lib/config.mjs`, change `const merge` to `export const merge`, and add (after `merge`):

```js
// Minimal glob: "*" becomes ".*"; every other char is matched literally.
// Shared by session arming (autoArm.sessionGlob) and theme binding
// (themeBySession) so both use one matcher.
export const globToRe = (g) =>
  new RegExp(
    `^${g
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
```

In `lib/curtain/session.mjs`, delete its local `globToRe` (lines defining it) and import it: change the `config.mjs` import line to `import { loadConfig, stripTitle, globToRe } from "../config.mjs";` — wait, session.mjs currently imports from `./hook.mjs`, `./state.mjs`, `./tmux.mjs`, not config. Add: `import { globToRe } from "../config.mjs";`.

- [ ] **Step 2: Run the suite to verify the move is inert**

Run: `node --test test/session.test.mjs`
Expected: PASS — `armAll`/`armIfMatch` behavior unchanged (same matcher, now imported).

- [ ] **Step 3: Write the failing themes test**

```js
// test/themes.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTINS,
  isAnimated,
  resolveThemeByName,
  themeNameFor,
} from "../lib/curtain/themes.mjs";

test("classic is a solid, glyph/label theme for every state", () => {
  const c = BUILTINS.classic;
  assert.equal(c.background, "solid");
  for (const s of ["working", "compacting", "done", "needs", "idle"])
    assert.ok(c.states[s], `classic missing ${s}`);
  assert.equal(c.states.working.label, "WORKING");
});

test("themeNameFor picks the first matching session glob, else the default", () => {
  const cfg = {
    theme: "minimal",
    themeBySession: { "token-oracle*": "forge", "syndcast*": "neon" },
  };
  assert.equal(themeNameFor("token-oracle-3", cfg), "forge");
  assert.equal(themeNameFor("syndcast-web", cfg), "neon");
  assert.equal(themeNameFor("random", cfg), "minimal");
});

test("themeNameFor defaults to classic when nothing is configured", () => {
  assert.equal(themeNameFor("anything", {}), "classic");
});

test("resolveThemeByName merges user override over the builtin", () => {
  const cfg = { themes: { classic: { states: { working: { fg: 200 } } } } };
  const t = resolveThemeByName("classic", cfg);
  assert.equal(t.states.working.fg, 200); // overridden
  assert.equal(t.states.working.label, "WORKING"); // inherited from builtin
});

test("top-level background override wins and reaches the resolved theme", () => {
  const t = resolveThemeByName("classic", { background: "transparent" });
  assert.equal(t.background, "transparent");
});

test("an unknown theme name falls back to classic", () => {
  assert.equal(resolveThemeByName("does-not-exist", {}).states.done.label, "DONE");
});

test("isAnimated is true only when a state has more than one frame", () => {
  assert.equal(isAnimated(BUILTINS.classic), false);
  assert.equal(isAnimated({ states: { x: { frames: [["a"], ["b"]] } } }), true);
  assert.equal(isAnimated({ states: { x: { frames: [["a"]] } } }), false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/themes.test.mjs`
Expected: FAIL — module `../lib/curtain/themes.mjs` not found.

- [ ] **Step 5: Write `lib/curtain/themes.mjs`**

```js
import { globToRe, loadConfig, merge } from "../config.mjs";

// The current hardcoded look, now expressed as data. Byte-identical: solid
// black background, same glyph/label/fg per state as the old CARDS map. This
// is the default, so a user who configures nothing sees no change.
export const BUILTINS = {
  classic: {
    background: "solid",
    bgColor: "black",
    states: {
      working: { fg: "brightYellow", glyph: "●", label: "WORKING" },
      compacting: { fg: "cyan", glyph: "⟳", label: "COMPACTING" },
      done: { fg: "brightGreen", glyph: "✅", label: "DONE" },
      needs: { fg: "brightRed", glyph: "⚠", label: "NEEDS YOU" },
      idle: { fg: "gray", glyph: "—", label: "" },
    },
  },
};

// Which theme a session wears: first themeBySession glob to match, else the
// global default, else classic. Reuses the arming glob matcher.
export const themeNameFor = (sessionName, cfg = loadConfig().curtain) => {
  const map = cfg?.themeBySession || {};
  for (const glob of Object.keys(map))
    if (globToRe(glob).test(sessionName)) return map[glob];
  return cfg?.theme || "classic";
};

// Resolve a theme NAME to its merged object: builtin base, then the user's
// same-named override/definition, then top-level visual overrides last. An
// unknown name falls back to classic so render never throws on a typo.
export const resolveThemeByName = (name, cfg = loadConfig().curtain) => {
  const base = BUILTINS[name] || BUILTINS.classic;
  const user = (cfg?.themes && cfg.themes[name]) || {};
  const top = {};
  for (const k of ["background", "bgColor", "layout"])
    if (cfg?.[k] !== undefined) top[k] = cfg[k];
  return merge(merge(base, user), top);
};

export const isAnimated = (theme) =>
  Object.values(theme?.states || {}).some(
    (s) => Array.isArray(s?.frames) && s.frames.length > 1,
  );
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/themes.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 7: Full suite + lint**

Run: `node --test && npx biome check .`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/curtain/themes.mjs lib/config.mjs lib/curtain/session.mjs test/themes.test.mjs
git commit -m "feat(curtain): theme registry, classic builtin, resolution helpers"
```

---

### Task 3: `curtain-card.mjs` — theme + tick render, classic byte-identical

Refactor `renderCard`/`renderCardFrame` to take a resolved `theme` and a `tick`, splitting the card into a theme-owned **visual** (art frame, or glyph+label) and herald-owned **info lines** (elapsed / subagents / worked / hints). `classic` (no frames) must reproduce today's output exactly. Add solid vs transparent line construction and the per-line `\x1b[K` frame discipline.

**Files:**
- Modify: `lib/surfaces/curtain-card.mjs`
- Test: `test/curtain-card.test.mjs` (existing assertions must still pass; add new)

**Interfaces:**
- Consumes: `BUILTINS` from `themes.mjs`; `color`, `eraseLine`, `padCenter`, `visibleWidth`, `cursorHome`, `disableWrap`, `enableWrap`, `eraseBelow`, `hideCursor` from `render.mjs`; `formatElapsed` from `state.mjs`.
- Produces:
  - `renderCard(state, elapsedSec, cols, rows, bg = {}, theme = BUILTINS.classic, tick = 0)` → `string[]` of length `rows`.
  - `renderCardFrame({ state, elapsedSec, cols, rows, bg, theme, tick })` → string.
  - `infoLines(state, { elapsed, subagents, shells, worked })` → `string[]` (herald-owned dynamic text).

- [ ] **Step 1: Add tests for the new behavior (existing tests stay)**

Append to `test/curtain-card.test.mjs`:

```js
import { BUILTINS, resolveThemeByName } from "../lib/curtain/themes.mjs";

test("classic renderCard output is unchanged when theme/tick default", () => {
  // The existing tests above already assert classic content; this pins that
  // passing an explicit classic theme + tick 0 yields the same lines.
  const implicit = renderCard("working", 42, 40, 10);
  const explicit = renderCard("working", 42, 40, 10, {}, BUILTINS.classic, 0);
  assert.deepEqual(explicit, implicit);
});

test("an animated theme selects its frame by tick", () => {
  const theme = {
    background: "transparent",
    states: { working: { fg: 33, label: "W", frames: [["AAA"], ["BBB"], ["CCC"]] } },
  };
  const at = (tick) =>
    renderCard("working", 0, 20, 8, {}, theme, tick).map(plain).join("\n");
  assert.match(at(0), /AAA/);
  assert.match(at(1), /BBB/);
  assert.match(at(2), /CCC/);
  assert.match(at(3), /AAA/); // wraps: tick % frames.length
});

test("transparent theme paints no background fill", () => {
  const theme = { background: "transparent", states: { working: { fg: 33, glyph: "●", label: "W" } } };
  const lines = renderCard("working", 0, 20, 6, {}, theme, 0);
  // No line carries a bg SGR (40 = black bg, or 48;5;… = 256 bg).
  for (const l of lines) {
    assert.doesNotMatch(l, /\x1b\[[0-9;]*4[0-9]m/);
    assert.doesNotMatch(l, /\x1b\[48;5;/);
  }
});

test("solid theme paints a full-width background on every line", () => {
  const lines = renderCard("working", 0, 20, 6, {}, BUILTINS.classic, 0);
  for (const l of lines) assert.match(l, /\x1b\[40m/); // black bg present
});

test("renderCardFrame erases to end of line on each row (anti-ghost)", () => {
  const theme = { background: "transparent", states: { done: { fg: 32, glyph: "✓", label: "DONE" } } };
  const out = renderCardFrame({ state: "done", elapsedSec: 0, cols: 20, rows: 6, bg: {}, theme, tick: 0 });
  assert.match(out, /\x1b\[K/); // per-line erase present
  assert.doesNotMatch(out, /\x1b\[2J/); // still no full-screen clear
});
```

- [ ] **Step 2: Run to verify the new tests fail (and old ones still pass)**

Run: `node --test test/curtain-card.test.mjs`
Expected: the five new tests FAIL (renderCard ignores `theme`/`tick`, always solid classic); the original tests PASS.

- [ ] **Step 3: Rewrite `lib/surfaces/curtain-card.mjs`**

```js
import { BUILTINS } from "../curtain/themes.mjs";
import { formatElapsed } from "../curtain/state.mjs";
import {
  color,
  cursorHome,
  disableWrap,
  enableWrap,
  eraseBelow,
  eraseLine,
  hideCursor,
  padCenter,
  visibleWidth,
} from "../render.mjs";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Herald-owned dynamic lines: the live numbers a theme must not rewrite. Same
// text the old CARDS map produced as `sub`, so classic stays byte-identical.
export const infoLines = (state, { elapsed, subagents, shells, worked }) => {
  switch (state) {
    case "working":
      return [
        subagents
          ? `${formatElapsed(elapsed)} · ${plural(subagents, "subagent")}`
          : formatElapsed(elapsed),
      ];
    case "compacting":
      return ["compressing context…"];
    case "done":
      return [
        worked ? `worked ${formatElapsed(worked)}` : "",
        shells
          ? `focus to open · ${plural(shells, "shell")} in bg`
          : "focus to open",
      ];
    case "needs":
      return ["focus to open"];
    default:
      return [""];
  }
};

const bgOf = (theme) =>
  typeof theme.bgColor === "number"
    ? `48;5;${theme.bgColor}`
    : theme.bgColor || "black";

const pickFrame = (st, tick) =>
  Array.isArray(st?.frames) && st.frames.length
    ? st.frames[tick % st.frames.length]
    : null;

// Center an art frame as a RIGID block: one common left margin from the frame's
// widest line, each line's own internal shape preserved (never re-center lines
// individually — that distorts art).
const marginFrame = (frame, cols) => {
  const w = Math.max(0, ...frame.map(visibleWidth));
  const left = Math.max(0, Math.floor((cols - w) / 2));
  const pad = " ".repeat(left);
  return frame.map((line) => pad + line);
};

const fillTo = (s, cols) => {
  const w = visibleWidth(s);
  return w < cols ? s + " ".repeat(cols - w) : s;
};

// A single short line (glyph/label/info), centered. Solid: padCenter + bg fill
// (identical to the old classic path). Transparent: left margin only, no fill.
const textLine = (text, cols, solid, bgSpec, fg, bold) =>
  solid
    ? color(padCenter(text, cols), { bg: bgSpec, fg, bold })
    : " ".repeat(Math.max(0, Math.floor((cols - visibleWidth(text)) / 2))) +
      color(text, { fg, bold });

// A pre-margined art line. Solid: right-fill to cols on the bg. Transparent:
// as-is (the per-line eraseLine in the frame clears the rest).
const artLine = (marginedText, cols, solid, bgSpec, fg) =>
  solid
    ? color(fillTo(marginedText, cols), { bg: bgSpec, fg })
    : color(marginedText, { fg });

const blankLine = (cols, solid, bgSpec) =>
  solid ? color(" ".repeat(cols), { bg: bgSpec }) : "";

// Pure: exactly `rows` strings. Theme owns the visual (art frame, or glyph +
// label); herald owns the info lines. classic (no frames) reproduces the old
// glyph/label/info block, solid, byte-for-byte.
export const renderCard = (
  state,
  elapsedSec,
  cols,
  rows,
  bg = {},
  theme = BUILTINS.classic,
  tick = 0,
) => {
  const st = (theme.states && (theme.states[state] || theme.states.idle)) || {};
  const solid = theme.background !== "transparent";
  const bgSpec = solid ? bgOf(theme) : undefined;
  const fg = st.fg;

  const frame = pickFrame(st, tick);
  const art = frame ? marginFrame(frame, cols) : [];
  const info = infoLines(state, {
    elapsed: elapsedSec,
    subagents: Number(bg.subagents) || 0,
    shells: Number(bg.shells) || 0,
    worked: Number(bg.worked) || 0,
  });
  // With frames, the label (if any) rides below the art; without frames it is
  // the classic glyph + label pair.
  const text = (frame ? (st.label ? [st.label] : []) : [st.glyph, st.label])
    .concat(info)
    .filter((l) => l !== "" && l != null);

  const blockLen = art.length + text.length;
  const top = Math.max(0, Math.floor((rows - blockLen) / 2));
  const out = [];
  for (let r = 0; r < rows; r++) {
    const bi = r - top;
    if (bi >= 0 && bi < art.length) {
      out.push(artLine(art[bi], cols, solid, bgSpec, fg));
    } else if (bi >= art.length && bi < blockLen) {
      const line = text[bi - art.length];
      const bold = st.label !== "" && st.label != null && line === st.label;
      out.push(textLine(line, cols, solid, bgSpec, fg, bold));
    } else {
      out.push(blankLine(cols, solid, bgSpec));
    }
  }
  return out;
};

// Repaint in place: home the cursor, overwrite each row, erase to end-of-line
// after every row (clears a shorter transparent frame's ghosts; a no-op after a
// full-width solid line), then erase below for a shrunk frame. Wrap off/on so a
// wide glyph clips at the margin instead of wrap-scrolling the block.
export const renderCardFrame = ({ state, elapsedSec, cols, rows, bg, theme, tick }) =>
  hideCursor() +
  disableWrap() +
  cursorHome() +
  renderCard(state, elapsedSec, cols, rows, bg, theme, tick)
    .map((l) => l + eraseLine())
    .join("\r\n") +
  eraseBelow() +
  enableWrap();
```

- [ ] **Step 4: Run the card tests**

Run: `node --test test/curtain-card.test.mjs`
Expected: PASS — original classic assertions AND the five new ones.

- [ ] **Step 5: Full suite + lint**

Run: `node --test && npx biome check .`
Expected: all pass. (`cli.mjs` still calls `renderCardFrame` without `theme`/`tick`; defaults make it classic — Task 6 wires the flags.)

- [ ] **Step 6: Commit**

```bash
git add lib/surfaces/curtain-card.mjs test/curtain-card.test.mjs
git commit -m "feat(curtain): theme+tick render, art frames, transparent mode"
```

---

### Task 4: `config.mjs` — theme defaults

Add the theme knobs to `DEFAULTS.curtain`. Do **not** default the top-level `background`/`bgColor`/`layout` override keys (they must stay absent so a theme's own background wins unless the user sets a global override).

**Files:**
- Modify: `lib/config.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**
- Produces: `loadConfig().curtain` gains `theme: "classic"`, `themeBySession: {}`, `themes: {}`, `animation: { fps: 2 }`.

- [ ] **Step 1: Write the failing test**

Append to `test/config.test.mjs`:

```js
test("curtain defaults carry the theme knobs", () => {
  const c = loadConfig("/nonexistent/does-not-exist.json").curtain;
  assert.equal(c.theme, "classic");
  assert.deepEqual(c.themeBySession, {});
  assert.deepEqual(c.themes, {});
  assert.equal(c.animation.fps, 2);
  // No global background override is defaulted (themes decide their own).
  assert.equal(c.background, undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/config.test.mjs`
Expected: FAIL — `c.theme` is `undefined`.

- [ ] **Step 3: Extend `DEFAULTS.curtain`**

In `lib/config.mjs`, add these keys inside `DEFAULTS.curtain` (alongside `enabled`, `coverableStates`, `focus`, `autoArm`):

```js
    theme: "classic",
    themeBySession: {},
    themes: {},
    animation: { fps: 2 },
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Full suite + lint + commit**

```bash
node --test && npx biome check .
git add lib/config.mjs test/config.test.mjs
git commit -m "feat(config): curtain theme/themeBySession/themes/animation defaults"
```

---

### Task 5: `session.mjs` — store resolved theme + frame interval

`arm` and `refreshCards` resolve the session's theme name and its repaint interval and store them as tmux options, so the loop and the render CLI read them per tick. Animated themes get a faster interval; static themes keep 1 s (mosh-traffic aware).

**Files:**
- Modify: `lib/curtain/session.mjs`
- Test: `test/session.test.mjs`

**Interfaces:**
- Consumes: `themeNameFor`, `resolveThemeByName`, `isAnimated` from `themes.mjs`; `loadConfig` from `config.mjs`.
- Produces: on `arm`/`refreshCards`, sets `@herald_theme` (name) and `@herald_frame_ms` (integer ms: `round(1000/fps)` if animated, else `1000`).

- [ ] **Step 1: Write the failing test**

Append to `test/session.test.mjs` (uses the file's existing in-memory tmux double; if the helper is named differently, match it):

```js
test("arm stores the resolved theme name and frame interval", () => {
  const opts = {};
  const t = fakeTmux({ opts }); // existing double in this test file
  arm("token-oracle-1", t);
  assert.equal(t.getSessOpt("token-oracle-1", "@herald_theme"), "classic");
  assert.equal(t.getSessOpt("token-oracle-1", "@herald_frame_ms"), 1000);
});
```

If `test/session.test.mjs` has no reusable `fakeTmux`, define a minimal one at the top of the test file:

```js
const fakeTmux = ({ opts = {}, armed = [] } = {}) => ({
  getSessOpt: (s, k) => opts[`${s} ${k}`],
  setSessOpt: (s, k, v) => {
    opts[`${s} ${k}`] = v;
  },
  unsetSessOpt: (s, k) => {
    delete opts[`${s} ${k}`];
  },
  activeWindowId: () => "@1",
  windowNameOf: () => "main",
  newCardWindow: () => {},
  killWindow: () => {},
  selectWindow: () => {},
  listArmed: () => armed,
  listSessions: () => armed.map((a) => a.name),
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/session.test.mjs`
Expected: FAIL — `@herald_theme` is `undefined`.

- [ ] **Step 3: Implement in `session.mjs`**

Add the import near the top:

```js
import { loadConfig } from "../config.mjs";
import { isAnimated, resolveThemeByName, themeNameFor } from "./themes.mjs";
```

Add a helper above `arm`:

```js
// Resolve and store which theme a session wears and how fast its card repaints.
// Animated themes tick faster (default 2 fps); static themes keep the 1 s tick
// so a fleet of mosh'd sessions is not repainted 2x for no visual change.
const stampTheme = (sess, t) => {
  const cfg = loadConfig().curtain;
  const name = themeNameFor(sess, cfg);
  t.setSessOpt(sess, "@herald_theme", name);
  const animated = isAnimated(resolveThemeByName(name, cfg));
  const ms = animated ? Math.round(1000 / (cfg.animation?.fps || 2)) : 1000;
  t.setSessOpt(sess, "@herald_frame_ms", ms);
};
```

In `arm`, after the existing `setSessOpt(... "@herald_armed" ...)` block (before it returns), add `stampTheme(sess, t);` — place it just before `t.setSessOpt(sess, "@herald_armed", "1");`.

In `refreshCards`, inside the loop, add `stampTheme(name, t);` before the `killWindow`/`newCardWindow` pair so a config change (new binding) is picked up on refresh:

```js
export const refreshCards = (t = realTmux) => {
  for (const { name } of t.listArmed()) {
    stampTheme(name, t);
    const covered = t.getSessOpt(name, "@herald_covered") === "1";
    t.killWindow(`${name}:${CARD_WIN}`);
    t.newCardWindow(name, CARD_WIN, LOOP);
    if (covered) t.selectWindow(`${name}:${CARD_WIN}`);
  }
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/session.test.mjs`
Expected: PASS. If an existing arm test asserts the exact set of options written, extend it to allow `@herald_theme`/`@herald_frame_ms` (they are additive).

- [ ] **Step 5: Full suite + lint + commit**

```bash
node --test && npx biome check .
git add lib/curtain/session.mjs test/session.test.mjs
git commit -m "feat(curtain): arm/refresh store resolved theme + frame interval"
```

---

### Task 6: `cli.mjs` — `render --theme`/`--tick`

Thread the theme name and tick from the loop into the pure renderer. `--theme` resolves via `resolveThemeByName` (loads config for user overrides); omitting it yields classic, so existing callers are unaffected.

**Files:**
- Modify: `lib/cli.mjs`
- Test: `test/curtain-card.test.mjs` (CLI section) or `test/curtain-cli.test.mjs`

**Interfaces:**
- Consumes: `resolveThemeByName` from `themes.mjs`.
- Produces: `herald render --surface curtain-card --theme <name> --tick <n> …` renders that theme's `frames[n % len]`.

- [ ] **Step 1: Write the failing test**

Add to `test/curtain-card.test.mjs`:

```js
test("CLI render selects the themed frame by --theme and --tick", () => {
  const run = (theme, tick) =>
    execFileSync(
      "node",
      [
        "bin/herald", "render", "--surface", "curtain-card",
        "--state", "working", "--since", "0",
        "--cols", "24", "--rows", "8",
        "--theme", theme, "--tick", String(tick),
        "--color", "always",
      ],
      { encoding: "utf8" },
    ).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  // 'classic' has no frames — WORKING is always present regardless of tick.
  assert.match(run("classic", 0), /WORKING/);
  assert.match(run("classic", 7), /WORKING/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/curtain-card.test.mjs`
Expected: FAIL — `runRender` does not accept `--theme`/`--tick` (unknown flags are parsed but ignored; the test fails only once you assert a themed frame — for classic it may pass, so ALSO add a forge-frame assertion after Task 8, or assert here that the process exits 0 with the flags present). Minimum: assert `run("classic", 0)` contains `WORKING` and the command does not error.

- [ ] **Step 3: Implement in `runRender`**

Add the import: `import { resolveThemeByName } from "./curtain/themes.mjs";`

In `runRender`, extend the `renderCardFrame` call:

```js
  process.stdout.write(
    renderCardFrame({
      state: f.state || "idle",
      elapsedSec: computeElapsed(nowSec, f.since),
      cols: Number(f.cols) || 80,
      rows: Number(f.rows) || 24,
      bg: { subagents: f.subagents, shells: f.shells, worked: f.worked },
      theme: resolveThemeByName(f.theme || "classic"),
      tick: Number(f.tick) || 0,
    }),
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/curtain-card.test.mjs`
Expected: PASS.

- [ ] **Step 5: Full suite + lint + commit**

```bash
node --test && npx biome check .
git add lib/cli.mjs test/curtain-card.test.mjs
git commit -m "feat(cli): render --theme/--tick threading"
```

---

### Task 7: `curtain-card-session.sh` — tick counter + variable interval

The loop reads the session's `@herald_theme` and `@herald_frame_ms`, forwards them to `herald render`, increments a tick each repaint, and sleeps for the theme's interval (fractional seconds for animation). Bash is not unit-tested; the render contract is covered by Task 6, and this task ends with a live, non-destructive verification.

**Files:**
- Modify: `scripts/curtain-card-session.sh`

**Interfaces:**
- Consumes: tmux options `@herald_theme`, `@herald_frame_ms`; `herald render --theme/--tick`.

- [ ] **Step 1: Rewrite the loop**

```bash
#!/usr/bin/env bash
# Runs inside a session's _curtain window. Repaints the card from THIS session's
# @herald_* options. Any keypress reveals the session (fail-open). Never exits.
set -u
sess=$(tmux display -p '#{session_name}' 2>/dev/null)
[ -n "$sess" ] || exit 0
printf '\033[?25l'
tick=0
while :; do
  state=$(tmux show -t "$sess" -v @herald_state 2>/dev/null)
  since=$(tmux show -t "$sess" -v @herald_since 2>/dev/null)
  subs=$(tmux show -t "$sess" -v @herald_bg_subagents 2>/dev/null)
  shells=$(tmux show -t "$sess" -v @herald_bg_shells 2>/dev/null)
  worked=$(tmux show -t "$sess" -v @herald_worked 2>/dev/null)
  theme=$(tmux show -t "$sess" -v @herald_theme 2>/dev/null)
  frame_ms=$(tmux show -t "$sess" -v @herald_frame_ms 2>/dev/null)
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --subagents "${subs:-0}" --shells "${shells:-0}" \
    --worked "${worked:-0}" \
    --theme "${theme:-classic}" --tick "$tick" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  tick=$((tick + 1))
  # Repaint interval: @herald_frame_ms (default 1000) → seconds for read -t.
  ms=${frame_ms:-1000}
  case "$ms" in
    "" | *[!0-9]*) secs=1 ;;
    *) secs=$(awk "BEGIN{printf \"%.3f\", $ms/1000}" 2>/dev/null || echo 1) ;;
  esac
  if read -rsn1 -t "$secs" 2>/dev/null; then
    herald curtain reveal "$sess" >/dev/null 2>&1 || true
  fi
done
```

- [ ] **Step 2: Verify the loop script parses**

Run: `bash -n scripts/curtain-card-session.sh`
Expected: no output, exit 0 (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add scripts/curtain-card-session.sh
git commit -m "feat(curtain): card loop forwards theme + animates via frame interval"
```

- [ ] **Step 4: Live, non-destructive rollout (do NOT skip; do NOT kill sessions)**

The loop change only reaches already-armed sessions when their hidden `_curtain` window is respawned. Take a before/after live-window snapshot to PROVE no live window or session is disturbed, then refresh:

```bash
# BEFORE: record every live (non-_curtain) window id + name
tmux list-windows -a -F '#{session_name}:#{window_id} #{window_name}' | grep -v ' _curtain$' | sort > /tmp/curtain-before.txt
herald curtain refresh
# AFTER: same snapshot; the diff must be empty (only _curtain windows changed)
tmux list-windows -a -F '#{session_name}:#{window_id} #{window_name}' | grep -v ' _curtain$' | sort > /tmp/curtain-after.txt
diff /tmp/curtain-before.txt /tmp/curtain-after.txt && echo "OK: no live window disturbed"
herald curtain inspect   # confirm armed count + states preserved
```

Expected: empty diff, `OK: no live window disturbed`, and `inspect` shows the same armed sessions with their prior states. A covered session stays covered.

---

### Task 8: Built-in themes `minimal` and `forge` (animated hammer)

Add the two remaining builtins: `minimal` (transparent glyph/label — "let my Ghostty background through") and `forge` (transparent + the animated hammer on WORKING, small static art elsewhere).

**Files:**
- Modify: `lib/curtain/themes.mjs`
- Test: `test/themes.test.mjs`

**Interfaces:**
- Produces: `BUILTINS.minimal`, `BUILTINS.forge`; `isAnimated(BUILTINS.forge) === true`.

- [ ] **Step 1: Write the failing test**

Append to `test/themes.test.mjs`:

```js
test("minimal is transparent glyph/label", () => {
  assert.equal(BUILTINS.minimal.background, "transparent");
  assert.equal(BUILTINS.minimal.states.done.label, "DONE");
  assert.ok(!BUILTINS.minimal.states.working.frames);
});

test("forge is a transparent, animated theme", () => {
  assert.equal(BUILTINS.forge.background, "transparent");
  assert.ok(BUILTINS.forge.states.working.frames.length >= 2);
  assert.equal(isAnimated(BUILTINS.forge), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/themes.test.mjs`
Expected: FAIL — `BUILTINS.minimal`/`forge` are `undefined`.

- [ ] **Step 3: Add the builtins**

In `lib/curtain/themes.mjs`, add to `BUILTINS` (art is placeholder-quality by design — the operator tunes the pixels; the mechanism is what ships):

```js
  minimal: {
    background: "transparent",
    states: {
      working: { fg: "brightYellow", glyph: "●", label: "WORKING" },
      compacting: { fg: "cyan", glyph: "⟳", label: "COMPACTING" },
      done: { fg: "brightGreen", glyph: "✅", label: "DONE" },
      needs: { fg: "brightRed", glyph: "⚠", label: "NEEDS YOU" },
      idle: { fg: "gray", glyph: "—", label: "" },
    },
  },
  forge: {
    background: "transparent",
    states: {
      working: {
        fg: "brightYellow",
        label: "WORKING",
        // Hammer taps down onto the anvil, then sparks. Constant 5-row grid so
        // the anvil (widest, last line) anchors the block; the head drops a row.
        frames: [
          ["   ___", "  |,,,|", "  |___|", "   |_|", " ========="],
          ["", "   ___", "  |,,,|", "  |___|", " ========="],
          ["", "   ___", "  |,,,| *", " *|___|", " ========="],
        ],
      },
      compacting: {
        fg: "cyan",
        label: "COMPACTING",
        frames: [["  ( ⟳ )"], ["  ( ⟲ )"]],
      },
      done: { fg: "brightGreen", label: "DONE", frames: [["  ✓ ✓ ✓"]] },
      needs: { fg: "brightRed", label: "NEEDS YOU", frames: [["  /!\\", "  ! !"]] },
      idle: { fg: "gray", glyph: "—", label: "" },
    },
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/themes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Eyeball the animation (optional, non-destructive)**

```bash
for tick in 0 1 2; do
  echo "--- forge working tick $tick ---"
  herald render --surface curtain-card --state working --since 0 \
    --theme forge --tick $tick --cols 30 --rows 8 --color always
done
```

Expected: the hammer head/sparks change across ticks; no black fill (terminal background shows through).

- [ ] **Step 6: Full suite + lint + commit**

```bash
node --test && npx biome check .
git add lib/curtain/themes.mjs test/themes.test.mjs
git commit -m "feat(curtain): minimal + forge (animated hammer) builtin themes"
```

---

### Task 9: Docs, config example, plan status

Document the feature and record status. No code behavior change.

**Files:**
- Modify: `README.md` (or `docs/` config section, wherever curtain config is documented)
- Modify: `plans/README.md` (flip 014 row `SPEC` → `DONE`)
- Modify: `plans/014-curtain-themes.md` (add a "Shipped" note)

- [ ] **Step 1: Add a config example to the README**

Under the curtain configuration docs, add:

````markdown
### Curtain themes

Themes control the card's look. Pick a default and bind themes to sessions by
name glob:

```json
{
  "curtain": {
    "theme": "minimal",
    "themeBySession": {
      "token-oracle*": "forge",
      "syndcast*": "minimal"
    },
    "animation": { "fps": 2 }
  }
}
```

Built-ins: `classic` (solid black, the default), `minimal` (transparent —
your terminal background shows through), `forge` (transparent + animated art).
Author your own under `curtain.themes.<name>`:

```json
{
  "curtain": {
    "theme": "mine",
    "themes": {
      "mine": {
        "background": "transparent",
        "states": {
          "working": { "fg": 33, "label": "WORKING",
            "frames": [["  >>>  "], ["  >>>> "]] }
        }
      }
    }
  }
}
```

`frames` is an array of frames; each frame is an array of lines. A single-frame
state is static. Paste art from `figlet`/`toilet` or draw your own. After
changing a theme, run `herald curtain refresh` to reach already-armed sessions.
````

- [ ] **Step 2: Flip the plan status rows**

In `plans/README.md`, change the 014 row Status from `SPEC` to `DONE`. In `plans/014-curtain-themes.md`, change the header `**Status**` line to note it shipped, and add a one-line "Shipped 2026-07-11" section.

- [ ] **Step 3: Final full verification**

```bash
node --test && npx biome check .
```

Expected: all green, zero lint findings.

- [ ] **Step 4: Commit**

```bash
git add README.md plans/README.md plans/014-curtain-themes.md
git commit -m "docs(curtain): themes config + plan 014 status"
```

---

## Self-Review

**Spec coverage** (checked against `plans/014-curtain-themes.md`):
- Toggle background → Task 3 (`background: transparent` path) + Task 8 (`minimal`/`forge`). ✓
- Per-state ASCII art + animation → Task 3 (`frames[tick%n]`, rigid block centering) + Task 8 (hammer). ✓
- Themes as data / built-ins → Task 2 (`classic`) + Task 8 (`minimal`/`forge`). ✓
- Per-session binding → Task 2 (`themeNameFor`) + Task 5 (`@herald_theme` at arm). ✓
- Resolution order (builtin ← user ← top-level) → Task 2 (`resolveThemeByName`) + Task 4 (no defaulted overrides). ✓
- Transparent anti-ghost (`\x1b[K`) → Task 1 (`eraseLine`) + Task 3 (`renderCardFrame`). ✓
- 256-color / SGR passthrough → Task 1. ✓
- Animation cadence, traffic-aware → Task 5 (`@herald_frame_ms`, animated-only) + Task 7 (variable `read -t`). ✓
- Back-compat byte-identical classic → Task 2 (data), Task 3 (default params + solid path), Task 6 (default `--theme classic`). ✓
- Non-destructive rollout → Task 7 Step 4 (snapshot diff + `refresh`). ✓
- CLI `--theme`/`--tick` → Task 6. ✓

**Placeholder scan:** No "TBD"/"handle edge cases" — every code step has full content. The hammer art is intentionally simple, labelled as operator-tunable (not a placeholder for missing logic). ✓

**Type consistency:** `themeNameFor`/`resolveThemeByName`/`isAnimated`/`BUILTINS` names match across Tasks 2, 5, 6, 8. `renderCard(state, elapsedSec, cols, rows, bg, theme, tick)` signature is consistent in Tasks 3 and 6. `@herald_theme`/`@herald_frame_ms` option names match across Tasks 5 and 7. `eraseLine` matches across Tasks 1 and 3. ✓

**Ordering / dependencies:** 1 → 2 → 3 → (4) → 5, 6 → 7 → 8 → 9. Task 4 (config defaults) is independent and can land any time before Task 5. Task 6's forge-frame assertion is strengthened after Task 8 exists.

# HERALD Curtain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover a working Claude Code pane in a tmux grid with an opaque status card (`● WORKING m:ss` / `✅ DONE` / `⚠ NEEDS YOU`); focus a card to reveal the live session, unfocus while still working to re-cover.

**Architecture:** A zero-dependency Node CLI (`herald`) rendering a full-pane `curtain-card` surface, plus a tmux orchestrator that swaps a live pane with a mirror-layout "holding window" curtain pane. State flows from Claude Code hooks (`UserPromptSubmit`→working, `Stop`→done, `Notification`→needs) stamped on tmux pane options keyed by `$TMUX_PANE`. All Manjaro-side, no Mac hop.

**Tech Stack:** Node ≥20 (ESM `.mjs`, `node:test`, `node:child_process`, `node:fs` — builtins only), tmux 3.x, bash.

## Global Constraints

- **Zero runtime dependencies** — `lib/` and `bin/` import only `node:*` builtins. Hard invariant. (biome is a dev dependency only.)
- **ESM only** — all source files are `.mjs`, `"type": "module"`.
- **Node ≥20** — `node:test`, `??=`, top-level features.
- **Hooks must never break Claude** — every hook-invoked path (`herald curtain event …`, `focus-in`, `focus-out`) swallows all errors and exits 0.
- **Safe settings.json merge** — before first write back up to `<file>.bak`; abort untouched on malformed JSON; skip if the exact wiring is already present; never remove or reorder unrelated keys.
- **v1 grid is fixed** — N equal-width slots (default N=2), `even-horizontal` layout, no runtime add/remove.
- **tmux session name** = `grid`; **holding window name** = `_holding`.
- **Pane option keys** (verbatim): `@herald_role` ∈ {`live`,`curtain`}, `@herald_slot` (int), `@herald_peer` (pane id), `@herald_state` ∈ {`idle`,`working`,`done`,`needs`}, `@herald_since` (epoch seconds).
- **The `render.mjs` core slice must stay forward-compatible** with the full plan-002 render core (same export shape) so it is later superseded, not rewritten.

---

## File Structure

```
package.json                          # bootstrap: bin, type:module, test/lint scripts
biome.json                            # lint/format config (dev only)
bin/herald                            # executable entrypoint → lib/cli.mjs
lib/
  cli.mjs                             # arg dispatch: render | curtain | --version
  render.mjs                          # ANSI slice: color, visibleWidth, padCenter, clearScreen, hideCursor
  surfaces/curtain-card.mjs           # renderCard(state, elapsed, cols, rows) → string[]; renderCardFrame()
  curtain/
    state.mjs                         # STATES, isState, formatElapsed, computeElapsed
    tmux.mjs                          # thin tmux wrappers: getOpt/setOpt/windowNameOf/swapPanes/selectPane/isFocused
    orchestrator.mjs                  # cover/reveal/onEvent/onFocusIn/onFocusOut (tmux injected for tests)
    grid.mjs                          # gridUp/gridDown: build session + holding mirror + hooks
    install.mjs                       # settings.json safe-merge + doctor checks
scripts/curtain-card-loop.sh          # 1 Hz render loop run inside each curtain pane
test/
  render.test.mjs
  state.test.mjs
  curtain-card.test.mjs
  orchestrator.test.mjs               # DI unit tests (fake tmux)
  install.test.mjs                    # temp-file safe-merge tests
  grid.integration.test.mjs           # headless real-tmux swap test (skips if no tmux)
docs/superpowers/
  specs/2026-07-08-herald-curtain-design.md   # (exists)
  plans/2026-07-08-herald-curtain.md          # (this file)
```

---

## Task 0: Phase 0 spike — de-risk swap-pane (MANUAL GATE)

**This task gates the whole plan.** Prove the risky tmux interaction with a real Claude alt-screen TUI before building anything. No production code.

**Files:**
- Create: `scripts/spike/swap-spike.sh` (throwaway; delete after)

- [ ] **Step 1: Write the spike script**

```bash
#!/usr/bin/env bash
# THROWAWAY SPIKE. Proves: swap-pane preserves a live alt-screen TUI and
# focus-events fire through Ghostty+SSH+mouse. Run from Manjaro; attach from
# the Mac Ghostty via: ssh manjaro -t 'tmux attach -t spike'
set -euo pipefail
tmux kill-session -t spike 2>/dev/null || true
tmux new-session -d -s spike -n grid 'claude'      # slot 0 = real Claude
tmux split-window -h -t spike:grid 'htop || top'   # slot 1 = any TUI
tmux select-layout -t spike:grid even-horizontal
tmux new-window -d -n _holding -t spike: 'printf "\033[2J\033[H CURTAIN A "; sleep 100000'
tmux split-window -h -t spike:_holding 'printf "\033[2J\033[H CURTAIN B "; sleep 100000'
tmux select-layout -t spike:_holding even-horizontal
tmux set -g mouse on
tmux set -g focus-events on
tmux set-hook -g pane-focus-in  'run-shell "tmux display-message \"focus-in #{pane_id}\""'
tmux set-hook -g pane-focus-out 'run-shell "tmux display-message \"focus-out #{pane_id}\""'
echo "Attach from Mac: ssh manjaro -t 'tmux attach -t spike'"
echo "Then: click panes (watch focus-in/out messages), and run:"
echo "  tmux swap-pane -s <claude-pane> -t <curtain-pane>   # cover"
echo "  tmux swap-pane -s <curtain-pane> -t <claude-pane>   # reveal"
echo "List pane ids: tmux list-panes -a -F '#{window_name} #{pane_id} #{pane_current_command}'"
```

- [ ] **Step 2: Run the spike and attach from the Mac**

Run on Manjaro: `bash scripts/spike/swap-spike.sh`
From the Mac Ghostty: `ssh manjaro -t 'tmux attach -t spike'`

- [ ] **Step 3: Verify the three gate criteria by hand**

1. **Focus events fire**: clicking a pane prints `focus-in #{pane_id}` / `focus-out` messages. → PASS/FAIL
2. **Alt-screen survives swap**: `tmux swap-pane` the live Claude pane to `_holding` and back — Claude redraws cleanly (no blank/garbage), still interactive. → PASS/FAIL
3. **No visible reflow**: because layouts are mirrored (`even-horizontal` both windows), the swap shows no size jump. → PASS/FAIL

- [ ] **Step 4: Record the decision and STOP condition**

- All three PASS → proceed to Task 1 with the swap-pane design as specced.
- **STOP** if any FAIL: do not build the orchestrator as-is. Report which criterion failed. Fallback design = `resize-pane -Z` auto-zoom (focused pane fills window, others hidden), which replaces the swap mechanism in Tasks 5–7. Re-open the spec before continuing.

- [ ] **Step 5: Tear down the spike**

```bash
tmux kill-session -t spike 2>/dev/null || true
rm -f scripts/spike/swap-spike.sh
```

(No commit — spike is throwaway. Its outcome is recorded in the task review.)

---

## Task 1: Bootstrap skeleton

**Files:**
- Create: `package.json`, `biome.json`, `bin/herald`, `lib/cli.mjs`, `test/smoke.test.mjs`

**Interfaces:**
- Produces: `main(argv: string[]) → void` in `lib/cli.mjs` (sets `process.exitCode`); `herald --version` prints `herald 0.0.0`.

- [ ] **Step 1: Write the failing smoke test**

`test/smoke.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("herald --version prints version line", () => {
  const out = execFileSync("node", ["bin/herald", "--version"], { encoding: "utf8" });
  assert.match(out, /^herald \d+\.\d+\.\d+/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/smoke.test.mjs`
Expected: FAIL (`bin/herald` does not exist / cannot find module).

- [ ] **Step 3: Write package.json**

`package.json`:
```json
{
  "name": "status-herald",
  "version": "0.0.0",
  "description": "HERALD — heads-up engine for terminal status surfaces",
  "type": "module",
  "bin": { "herald": "bin/herald" },
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": { "@biomejs/biome": "1.9.4" },
  "license": "MIT"
}
```

- [ ] **Step 4: Write biome.json**

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": { "ignore": ["node_modules", "scripts/spike"] },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 80 }
}
```

- [ ] **Step 5: Write bin/herald**

`bin/herald`:
```js
#!/usr/bin/env node
import { main } from "../lib/cli.mjs";
main(process.argv.slice(2));
```

- [ ] **Step 6: Write lib/cli.mjs (version + dispatch stub)**

`lib/cli.mjs`:
```js
export const main = (argv) => {
  const [verb] = argv;
  try {
    if (verb === "--version" || verb === "-v") {
      process.stdout.write("herald 0.0.0\n");
      return;
    }
    process.stderr.write("usage: herald <render|curtain> ...\n");
    process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exitCode = 1;
  }
};
```

- [ ] **Step 7: Make bin executable and run the test**

Run:
```bash
chmod +x bin/herald
node --test test/smoke.test.mjs
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json biome.json bin/herald lib/cli.mjs test/smoke.test.mjs
git commit -m "feat(herald): bootstrap zero-dep CLI skeleton with version + smoke test"
```

---

## Task 2: Render core slice

**Files:**
- Create: `lib/render.mjs`, `test/render.test.mjs`

**Interfaces:**
- Produces: `color(text, {fg?,bg?,bold?}) → string`, `visibleWidth(s) → number`, `padCenter(text, width) → string`, `clearScreen() → string`, `hideCursor() → string`, `CSI`, `ESC`.

- [ ] **Step 1: Write the failing tests**

`test/render.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { color, visibleWidth, padCenter, clearScreen } from "../lib/render.mjs";

test("visibleWidth ignores SGR escapes", () => {
  assert.equal(visibleWidth("\x1b[31mabc\x1b[0m"), 3);
});

test("padCenter centers within width", () => {
  assert.equal(padCenter("ab", 6), "  ab  ");
});

test("padCenter returns text unchanged when wider than width", () => {
  assert.equal(padCenter("abcdef", 4), "abcdef");
});

test("color wraps with reset and omits when no codes", () => {
  assert.equal(color("x"), "x");
  assert.equal(color("x", { fg: "red" }), "\x1b[31mx\x1b[0m");
});

test("clearScreen emits CSI 2J and home", () => {
  assert.equal(clearScreen(), "\x1b[2J\x1b[H");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/render.test.mjs`
Expected: FAIL (`../lib/render.mjs` not found).

- [ ] **Step 3: Write lib/render.mjs**

```js
// Minimal ANSI render helpers for HERALD surfaces.
// Forward-compatible with the full plan-002 render core (same export shape).

export const ESC = "\x1b";
export const CSI = `${ESC}[`;

const FG = {
  default: 39, black: 30, red: 31, green: 32, yellow: 33, blue: 34,
  magenta: 35, cyan: 36, white: 37, gray: 90,
  brightRed: 91, brightGreen: 92, brightYellow: 93,
};
const BG = { default: 49, black: 40 };

export const color = (text, { fg, bg, bold } = {}) => {
  const codes = [];
  if (bold) codes.push(1);
  if (fg && FG[fg] != null) codes.push(FG[fg]);
  if (bg && BG[bg] != null) codes.push(BG[bg]);
  if (codes.length === 0) return text;
  return `${CSI}${codes.join(";")}m${text}${CSI}0m`;
};

// Visible width, ignoring SGR escapes. Codepoint count (emoji may render
// wider; card centering tolerates a 1-col drift — cosmetic only).
export const visibleWidth = (s) =>
  [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;

export const padCenter = (text, width) => {
  const w = visibleWidth(text);
  if (w >= width) return text;
  const left = Math.floor((width - w) / 2);
  const right = width - w - left;
  return " ".repeat(left) + text + " ".repeat(right);
};

export const clearScreen = () => `${CSI}2J${CSI}H`;
export const hideCursor = () => `${CSI}?25l`;
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/render.test.mjs`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add lib/render.mjs test/render.test.mjs
git commit -m "feat(render): ANSI core slice (color, width, center, clear)"
```

---

## Task 3: State helpers

**Files:**
- Create: `lib/curtain/state.mjs`, `test/state.test.mjs`

**Interfaces:**
- Produces: `STATES = {IDLE:'idle',WORKING:'working',DONE:'done',NEEDS:'needs'}`, `isState(s) → bool`, `formatElapsed(sec) → string`, `computeElapsed(nowSec, sinceSec) → number`.

- [ ] **Step 1: Write the failing tests**

`test/state.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, isState, formatElapsed, computeElapsed } from "../lib/curtain/state.mjs";

test("formatElapsed formats m:ss and h:mm:ss", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(42), "0:42");
  assert.equal(formatElapsed(125), "2:05");
  assert.equal(formatElapsed(3661), "1:01:01");
});

test("formatElapsed clamps bad input to 0:00", () => {
  assert.equal(formatElapsed(-5), "0:00");
  assert.equal(formatElapsed(NaN), "0:00");
});

test("computeElapsed subtracts and floors at 0", () => {
  assert.equal(computeElapsed(1100, 1000), 100);
  assert.equal(computeElapsed(1000, 1100), 0);
  assert.equal(computeElapsed(1000, 0), 0);
  assert.equal(computeElapsed(1000, "notnum"), 0);
});

test("isState validates", () => {
  assert.equal(isState("working"), true);
  assert.equal(isState(STATES.DONE), true);
  assert.equal(isState("bogus"), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/state.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write lib/curtain/state.mjs**

```js
export const STATES = Object.freeze({
  IDLE: "idle",
  WORKING: "working",
  DONE: "done",
  NEEDS: "needs",
});

export const isState = (s) => Object.values(STATES).includes(s);

export const formatElapsed = (sec) => {
  let s = Number(sec);
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
};

export const computeElapsed = (nowSec, sinceSec) => {
  const since = Number(sinceSec);
  if (!Number.isFinite(since) || since <= 0) return 0;
  return Math.max(0, Math.floor(Number(nowSec) - since));
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/state.test.mjs`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add lib/curtain/state.mjs test/state.test.mjs
git commit -m "feat(curtain): state constants and elapsed helpers"
```

---

## Task 4: curtain-card surface + `herald render`

**Files:**
- Create: `lib/surfaces/curtain-card.mjs`, `test/curtain-card.test.mjs`
- Modify: `lib/cli.mjs` (add `render` verb)

**Interfaces:**
- Consumes: `color/padCenter/clearScreen/hideCursor` (render.mjs), `STATES/formatElapsed/computeElapsed` (state.mjs).
- Produces: `renderCard(state, elapsedSec, cols, rows) → string[]` (exactly `rows` lines); `renderCardFrame({state,elapsedSec,cols,rows}) → string`. CLI: `herald render --surface curtain-card --state <s> --since <epoch> --cols <n> --rows <n> --color always`.

- [ ] **Step 1: Write the failing tests**

`test/curtain-card.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { renderCard } from "../lib/surfaces/curtain-card.mjs";

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("renderCard returns exactly `rows` lines", () => {
  assert.equal(renderCard("working", 42, 40, 10).length, 10);
});

test("working card shows label and elapsed", () => {
  const text = renderCard("working", 42, 40, 10).map(plain).join("\n");
  assert.match(text, /WORKING/);
  assert.match(text, /0:42/);
});

test("done card shows DONE and hint", () => {
  const text = renderCard("done", 0, 40, 10).map(plain).join("\n");
  assert.match(text, /DONE/);
  assert.match(text, /focus to open/);
});

test("needs card shows NEEDS YOU", () => {
  const text = renderCard("needs", 0, 40, 10).map(plain).join("\n");
  assert.match(text, /NEEDS YOU/);
});

test("unknown state falls back to idle without throwing", () => {
  assert.equal(renderCard("bogus", 0, 40, 6).length, 6);
});

test("CLI render prints a clear-screen frame with WORKING", () => {
  const out = execFileSync("node",
    ["bin/herald", "render", "--surface", "curtain-card",
     "--state", "working", "--since", "0", "--cols", "30", "--rows", "8", "--color", "always"],
    { encoding: "utf8" });
  assert.match(out, /\x1b\[2J/);       // clear screen
  assert.match(out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""), /WORKING/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/curtain-card.test.mjs`
Expected: FAIL (surface module + render verb missing).

- [ ] **Step 3: Write lib/surfaces/curtain-card.mjs**

```js
import { color, padCenter, clearScreen, hideCursor } from "../render.mjs";
import { STATES, formatElapsed } from "../curtain/state.mjs";

const CARDS = {
  [STATES.WORKING]: (e) => ({ glyph: "●", label: "WORKING", sub: formatElapsed(e), fg: "brightYellow" }),
  [STATES.DONE]:    () => ({ glyph: "✅", label: "DONE", sub: "focus to open", fg: "brightGreen" }),
  [STATES.NEEDS]:   () => ({ glyph: "⚠", label: "NEEDS YOU", sub: "focus to open", fg: "brightRed" }),
  [STATES.IDLE]:    () => ({ glyph: "—", label: "", sub: "", fg: "gray" }),
};

// Pure: exactly `rows` strings, each a full-width black-bg line, card centered.
export const renderCard = (state, elapsedSec, cols, rows) => {
  const spec = (CARDS[state] || CARDS[STATES.IDLE])(elapsedSec);
  const block = [spec.glyph, spec.label, spec.sub].filter((l) => l !== "");
  const top = Math.max(0, Math.floor((rows - block.length) / 2));
  const blank = color(" ".repeat(cols), { bg: "black" });
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const bi = r - top;
    if (bi >= 0 && bi < block.length) {
      lines.push(color(padCenter(block[bi], cols), { bg: "black", fg: spec.fg, bold: block[bi] === spec.label }));
    } else {
      lines.push(blank);
    }
  }
  return lines;
};

export const renderCardFrame = ({ state, elapsedSec, cols, rows }) =>
  hideCursor() + clearScreen() + renderCard(state, elapsedSec, cols, rows).join("\r\n");
```

- [ ] **Step 4: Add the `render` verb to lib/cli.mjs**

Replace `lib/cli.mjs` with:
```js
import { renderCardFrame } from "./surfaces/curtain-card.mjs";
import { computeElapsed } from "./curtain/state.mjs";

const parseFlags = (args) => {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) f[args[i].slice(2)] = args[++i];
  }
  return f;
};

const runRender = (args) => {
  const f = parseFlags(args);
  if (f.surface !== "curtain-card") {
    process.stderr.write(`unknown surface: ${f.surface}\n`);
    return 1;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  process.stdout.write(renderCardFrame({
    state: f.state || "idle",
    elapsedSec: computeElapsed(nowSec, f.since),
    cols: Number(f.cols) || 80,
    rows: Number(f.rows) || 24,
  }));
  return 0;
};

export const main = (argv) => {
  const [verb, ...rest] = argv;
  try {
    if (verb === "--version" || verb === "-v") { process.stdout.write("herald 0.0.0\n"); return; }
    if (verb === "render") { process.exitCode = runRender(rest); return; }
    process.stderr.write("usage: herald <render|curtain> ...\n");
    process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exitCode = 1;
  }
};
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test test/curtain-card.test.mjs test/smoke.test.mjs`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add lib/surfaces/curtain-card.mjs lib/cli.mjs test/curtain-card.test.mjs
git commit -m "feat(surfaces): curtain-card full-pane surface + herald render verb"
```

---

## Task 5: tmux wrappers

**Files:**
- Create: `lib/curtain/tmux.mjs`, `test/tmux.test.mjs`

**Interfaces:**
- Produces: `getOpt(pane,name) → string`, `setOpt(pane,name,value) → void`, `windowNameOf(pane) → string|null`, `swapPanes(src,dst) → void`, `selectPane(pane) → void`, `isFocused(pane) → bool`, and `buildArgs.*` pure argv builders for testing.

- [ ] **Step 1: Write the failing tests (argv builders — no real tmux)**

`test/tmux.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArgs, parseFocus } from "../lib/curtain/tmux.mjs";

test("buildArgs.setOpt targets the pane", () => {
  assert.deepEqual(buildArgs.setOpt("%5", "@herald_state", "working"),
    ["set", "-p", "-t", "%5", "@herald_state", "working"]);
});

test("buildArgs.swapPanes swaps source and target", () => {
  assert.deepEqual(buildArgs.swapPanes("%5", "%9"),
    ["swap-pane", "-s", "%5", "-t", "%9"]);
});

test("parseFocus requires active pane, active window, attached client", () => {
  assert.equal(parseFocus("1,1,1"), true);
  assert.equal(parseFocus("0,1,1"), false);
  assert.equal(parseFocus("1,1,0"), false);
  assert.equal(parseFocus(""), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/tmux.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write lib/curtain/tmux.mjs**

```js
import { execFileSync } from "node:child_process";

export const buildArgs = {
  getOpt: (pane, name) => ["show", "-p", "-t", pane, "-v", name],
  setOpt: (pane, name, value) => ["set", "-p", "-t", pane, name, String(value)],
  windowName: (pane) => ["display", "-p", "-t", pane, "#{window_name}"],
  swapPanes: (src, dst) => ["swap-pane", "-s", src, "-t", dst],
  selectPane: (pane) => ["select-pane", "-t", pane],
  focus: (pane) => ["display", "-p", "-t", pane, "#{pane_active},#{window_active},#{session_attached}"],
};

// Run tmux, returning trimmed stdout, or null on any failure (tmux missing etc).
const run = (args) => {
  try { return execFileSync("tmux", args, { encoding: "utf8" }).trim(); }
  catch { return null; }
};

export const parseFocus = (line) => {
  if (!line) return false;
  const [pa, wa, sa] = line.split(",");
  return pa === "1" && wa === "1" && Number(sa) > 0;
};

export const getOpt = (pane, name) => run(buildArgs.getOpt(pane, name)) || "";
export const setOpt = (pane, name, value) => { run(buildArgs.setOpt(pane, name, value)); };
export const windowNameOf = (pane) => run(buildArgs.windowName(pane));
export const swapPanes = (src, dst) => { run(buildArgs.swapPanes(src, dst)); };
export const selectPane = (pane) => { run(buildArgs.selectPane(pane)); };
export const isFocused = (pane) => parseFocus(run(buildArgs.focus(pane)));
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/tmux.test.mjs`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add lib/curtain/tmux.mjs test/tmux.test.mjs
git commit -m "feat(curtain): tmux wrappers with pure argv builders and focus test"
```

---

## Task 6: Orchestrator decision logic

**Files:**
- Create: `lib/curtain/orchestrator.mjs`, `test/orchestrator.test.mjs`

**Interfaces:**
- Consumes: `tmux.mjs` (`getOpt/setOpt/windowNameOf/swapPanes/selectPane/isFocused`) — injected as `t` for tests; `STATES`.
- Produces: `HOLDING_WIN = "_holding"`, `cover(livePane, t?)`, `reveal(curtainPane, t?)`, `onEvent(livePane, state, nowSec, t?)`, `onFocusIn(pane, t?)`, `onFocusOut(pane, t?)`.

- [ ] **Step 1: Write the failing tests (fake tmux)**

`test/orchestrator.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cover, reveal, onEvent, onFocusIn, onFocusOut, HOLDING_WIN } from "../lib/curtain/orchestrator.mjs";

// Fake tmux: opts store + window placement + focus flag + recorded swaps.
const fake = (init = {}) => {
  const opts = init.opts ?? {};        // { "%id": { "@herald_peer": "%9", ... } }
  const win = init.win ?? {};          // { "%id": "grid" | "_holding" }
  const focused = init.focused ?? new Set();
  const calls = { swaps: [], selects: [] };
  return {
    calls,
    getOpt: (p, n) => opts[p]?.[n] ?? "",
    setOpt: (p, n, v) => { (opts[p] ??= {})[n] = String(v); },
    windowNameOf: (p) => win[p] ?? "grid",
    swapPanes: (s, d) => { const a = win[s]; win[s] = win[d]; win[d] = a; calls.swaps.push([s, d]); },
    selectPane: (p) => calls.selects.push(p),
    isFocused: (p) => focused.has(p),
  };
};

test("cover swaps live→holding when visible", () => {
  const t = fake({ opts: { "%5": { "@herald_peer": "%9" } }, win: { "%5": "grid", "%9": "_holding" } });
  cover("%5", t);
  assert.deepEqual(t.calls.swaps, [["%5", "%9"]]);
  assert.equal(t.windowNameOf("%5"), "_holding");
});

test("cover is a no-op when live already hidden", () => {
  const t = fake({ opts: { "%5": { "@herald_peer": "%9" } }, win: { "%5": "_holding", "%9": "grid" } });
  cover("%5", t);
  assert.equal(t.calls.swaps.length, 0);
});

test("reveal swaps live back and selects it", () => {
  const t = fake({ opts: { "%9": { "@herald_peer": "%5" } }, win: { "%5": "_holding", "%9": "grid" } });
  reveal("%9", t);
  assert.deepEqual(t.calls.swaps, [["%9", "%5"]]);
  assert.deepEqual(t.calls.selects, ["%5"]);
});

test("onEvent working stamps state+since and covers when unfocused", () => {
  const t = fake({ opts: { "%5": { "@herald_peer": "%9" } }, win: { "%5": "grid", "%9": "_holding" } });
  onEvent("%5", "working", 1000, t);
  assert.equal(t.getOpt("%5", "@herald_state"), "working");
  assert.equal(t.getOpt("%5", "@herald_since"), "1000");
  assert.equal(t.calls.swaps.length, 1);
});

test("onEvent does NOT cover the focused pane", () => {
  const t = fake({ opts: { "%5": { "@herald_peer": "%9" } }, win: { "%5": "grid", "%9": "_holding" }, focused: new Set(["%5"]) });
  onEvent("%5", "working", 1000, t);
  assert.equal(t.getOpt("%5", "@herald_state"), "working");
  assert.equal(t.calls.swaps.length, 0);
});

test("onFocusIn reveals only for a curtain pane", () => {
  const t = fake({ opts: { "%9": { "@herald_role": "curtain", "@herald_peer": "%5" }, "%5": {} }, win: { "%5": "_holding", "%9": "grid" } });
  onFocusIn("%9", t);
  assert.equal(t.calls.swaps.length, 1);
  onFocusIn("%5", t); // live pane → nothing
  assert.equal(t.calls.swaps.length, 1);
});

test("onFocusOut re-covers a working live pane", () => {
  const t = fake({ opts: { "%5": { "@herald_role": "live", "@herald_state": "working", "@herald_peer": "%9" } }, win: { "%5": "grid", "%9": "_holding" } });
  onFocusOut("%5", t);
  assert.equal(t.calls.swaps.length, 1);
});

test("onFocusOut ignores an idle live pane", () => {
  const t = fake({ opts: { "%5": { "@herald_role": "live", "@herald_state": "idle", "@herald_peer": "%9" } }, win: { "%5": "grid", "%9": "_holding" } });
  onFocusOut("%5", t);
  assert.equal(t.calls.swaps.length, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/orchestrator.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write lib/curtain/orchestrator.mjs**

```js
import * as realTmux from "./tmux.mjs";
import { STATES } from "./state.mjs";

export const HOLDING_WIN = "_holding";
const COVERABLE = new Set([STATES.WORKING, STATES.DONE, STATES.NEEDS]);

// Hide the live pane behind its curtain peer, if it is currently visible.
export const cover = (livePane, t = realTmux) => {
  const peer = t.getOpt(livePane, "@herald_peer");
  if (!peer) return;
  if (t.windowNameOf(livePane) === HOLDING_WIN) return; // already hidden
  t.swapPanes(livePane, peer);
};

// Bring the live session (peer of a focused curtain pane) back into the grid.
export const reveal = (curtainPane, t = realTmux) => {
  const live = t.getOpt(curtainPane, "@herald_peer");
  if (!live) return;
  if (t.windowNameOf(live) !== HOLDING_WIN) return; // already visible
  t.swapPanes(curtainPane, live);
  t.selectPane(live);
};

// Claude hook entry: stamp state on the live pane, cover it if unfocused.
export const onEvent = (livePane, state, nowSec, t = realTmux) => {
  t.setOpt(livePane, "@herald_state", state);
  if (state === STATES.WORKING) t.setOpt(livePane, "@herald_since", nowSec);
  if (!t.isFocused(livePane)) cover(livePane, t);
};

// tmux pane-focus-in: reveal when a curtain pane gains focus.
export const onFocusIn = (pane, t = realTmux) => {
  if (t.getOpt(pane, "@herald_role") === "curtain") reveal(pane, t);
};

// tmux pane-focus-out: re-cover a live pane that is still working/done/needs.
export const onFocusOut = (pane, t = realTmux) => {
  if (t.getOpt(pane, "@herald_role") !== "live") return;
  if (COVERABLE.has(t.getOpt(pane, "@herald_state"))) cover(pane, t);
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/orchestrator.test.mjs`
Expected: PASS (all 8).

- [ ] **Step 5: Commit**

```bash
git add lib/curtain/orchestrator.mjs test/orchestrator.test.mjs
git commit -m "feat(curtain): orchestrator cover/reveal/event/focus logic"
```

---

## Task 7: Grid build + card loop + `curtain` CLI + integration test

**Files:**
- Create: `lib/curtain/grid.mjs`, `scripts/curtain-card-loop.sh`, `test/grid.integration.test.mjs`
- Modify: `lib/cli.mjs` (add `curtain` verb dispatch)

**Interfaces:**
- Consumes: `orchestrator.mjs` (`onEvent/onFocusIn/onFocusOut`), `setOpt` (tmux.mjs).
- Produces: `gridUp({slots?,cmd?}) → number`, `gridDown() → number`; CLI `herald curtain <up|down|event|focus-in|focus-out|status>`.

- [ ] **Step 1: Write the card-loop shell script**

`scripts/curtain-card-loop.sh`:
```bash
#!/usr/bin/env bash
# Runs inside a curtain pane. Repaints the card once/second from the peer
# (live) pane's @herald_state. Never exits; resilient to transient errors.
set -u
pane="${TMUX_PANE:-}"
[ -n "$pane" ] || exit 0
printf '\033[?25l'
while :; do
  peer=$(tmux show -p -t "$pane" -v @herald_peer 2>/dev/null)
  state=$(tmux show -p -t "$peer" -v @herald_state 2>/dev/null)
  since=$(tmux show -p -t "$peer" -v @herald_since 2>/dev/null)
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  sleep 1
done
```

- [ ] **Step 2: Write the failing integration test (real headless tmux)**

`test/grid.integration.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { onEvent, onFocusIn } from "../lib/curtain/orchestrator.mjs";
import { windowNameOf, getOpt } from "../lib/curtain/tmux.mjs";

const hasTmux = () => { try { execFileSync("tmux", ["-V"]); return true; } catch { return false; } };
const S = "herald_it";
const tt = (a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();

const buildGrid = () => {
  try { tt(["kill-session", "-t", S]); } catch {}
  tt(["new-session", "-d", "-s", S, "-n", "grid", "sleep 1000"]);
  tt(["split-window", "-h", "-t", `${S}:grid`, "sleep 1000"]);
  tt(["select-layout", "-t", `${S}:grid`, "even-horizontal"]);
  tt(["new-window", "-d", "-n", "_holding", "-t", `${S}:`, "sleep 1000"]);
  tt(["split-window", "-h", "-t", `${S}:_holding`, "sleep 1000"]);
  tt(["select-layout", "-t", `${S}:_holding`, "even-horizontal"]);
  const live = tt(["list-panes", "-t", `${S}:grid`, "-F", "#{pane_id}"]).split("\n");
  const cur = tt(["list-panes", "-t", `${S}:_holding`, "-F", "#{pane_id}"]).split("\n");
  tt(["set", "-p", "-t", live[0], "@herald_role", "live"]);
  tt(["set", "-p", "-t", live[0], "@herald_peer", cur[0]]);
  tt(["set", "-p", "-t", cur[0], "@herald_role", "curtain"]);
  tt(["set", "-p", "-t", cur[0], "@herald_peer", live[0]]);
  return { live: live[0], cur: cur[0] };
};

test("event working covers an unfocused live pane; focus-in reveals it", { skip: !hasTmux() }, () => {
  const { live, cur } = buildGrid();
  try {
    // detached session → not focused → cover
    onEvent(live, "working", 1000);
    assert.equal(getOpt(live, "@herald_state"), "working");
    assert.equal(windowNameOf(live), "_holding", "live swapped into holding");
    assert.equal(windowNameOf(cur), "grid", "curtain swapped into grid");
    // focusing the curtain pane reveals the live session
    onFocusIn(cur);
    assert.equal(windowNameOf(live), "grid", "live revealed back to grid");
  } finally {
    tt(["kill-session", "-t", S]);
  }
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/grid.integration.test.mjs`
Expected: FAIL (orchestrator exists but assertion path exercised for the first time end-to-end; if it errantly passes, it is because tmux is absent and the test skips — install tmux: `sudo pacman -S tmux`).

- [ ] **Step 4: Write lib/curtain/grid.mjs**

```js
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setOpt } from "./tmux.mjs";

const SESSION = "grid";
const HOLDING = "_holding";
const LOOP = fileURLToPath(new URL("../../scripts/curtain-card-loop.sh", import.meta.url));

const t = (args) => {
  try { return execFileSync("tmux", args, { encoding: "utf8" }).trim(); }
  catch { return null; }
};

export const gridUp = ({ slots = 2, cmd = "claude" } = {}) => {
  const n = Number(slots) || 2;
  if (t(["has-session", "-t", SESSION]) !== null) { process.stdout.write("grid already up\n"); return 0; }

  t(["new-session", "-d", "-s", SESSION, "-n", "grid", cmd]);
  for (let i = 1; i < n; i++) t(["split-window", "-h", "-t", `${SESSION}:grid`, cmd]);
  t(["select-layout", "-t", `${SESSION}:grid`, "even-horizontal"]);

  t(["new-window", "-d", "-n", HOLDING, "-t", `${SESSION}:`, "bash", LOOP]);
  for (let i = 1; i < n; i++) t(["split-window", "-h", "-t", `${SESSION}:${HOLDING}`, "bash", LOOP]);
  t(["select-layout", "-t", `${SESSION}:${HOLDING}`, "even-horizontal"]);

  const live = (t(["list-panes", "-t", `${SESSION}:grid`, "-F", "#{pane_id}"]) || "").split("\n").filter(Boolean);
  const cur = (t(["list-panes", "-t", `${SESSION}:${HOLDING}`, "-F", "#{pane_id}"]) || "").split("\n").filter(Boolean);
  const pairs = Math.min(live.length, cur.length);
  for (let i = 0; i < pairs; i++) {
    setOpt(live[i], "@herald_role", "live");
    setOpt(live[i], "@herald_slot", i);
    setOpt(live[i], "@herald_peer", cur[i]);
    setOpt(live[i], "@herald_state", "idle");
    setOpt(cur[i], "@herald_role", "curtain");
    setOpt(cur[i], "@herald_slot", i);
    setOpt(cur[i], "@herald_peer", live[i]);
    setOpt(cur[i], "@herald_state", "idle");
  }

  t(["set", "-g", "mouse", "on"]);
  t(["set", "-g", "focus-events", "on"]);
  t(["set-hook", "-g", "pane-focus-in", 'run-shell "herald curtain focus-in #{pane_id}"']);
  t(["set-hook", "-g", "pane-focus-out", 'run-shell "herald curtain focus-out #{pane_id}"']);

  process.stdout.write(`grid up: ${pairs} slots\n`);
  return 0;
};

export const gridDown = () => { t(["kill-session", "-t", SESSION]); process.stdout.write("grid down\n"); return 0; };
```

- [ ] **Step 5: Add the `curtain` verb to lib/cli.mjs**

Add these imports at the top of `lib/cli.mjs`:
```js
import { onEvent, onFocusIn, onFocusOut } from "./curtain/orchestrator.mjs";
import { gridUp, gridDown } from "./curtain/grid.mjs";
import { getOpt } from "./curtain/tmux.mjs";
```

Add this function above `main`:
```js
// All curtain ops are hook-safe: never throw, always exit 0-ish for hooks.
const runCurtain = (args) => {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case "up": return gridUp(parseFlags(rest));
      case "down": return gridDown();
      case "event": {
        const pane = process.env.TMUX_PANE;
        if (pane && rest[0]) onEvent(pane, rest[0], Math.floor(Date.now() / 1000));
        return 0;
      }
      case "focus-in": if (rest[0]) onFocusIn(rest[0]); return 0;
      case "focus-out": if (rest[0]) onFocusOut(rest[0]); return 0;
      case "status": {
        const pane = process.env.TMUX_PANE;
        process.stdout.write(pane ? `${pane}: ${getOpt(pane, "@herald_state") || "idle"}\n` : "not in tmux\n");
        return 0;
      }
      default:
        process.stderr.write("usage: herald curtain <up|down|event|focus-in|focus-out|status>\n");
        return 1;
    }
  } catch {
    return 0; // hook safety: never break the caller
  }
};
```

Add the dispatch line inside `main`'s `try`, after the `render` branch:
```js
    if (verb === "curtain") { process.exitCode = runCurtain(rest); return; }
```

- [ ] **Step 6: Make the loop script executable and run all tests**

Run:
```bash
chmod +x scripts/curtain-card-loop.sh
node --test
```
Expected: PASS (unit suites + integration if tmux present; integration SKIP if not).

- [ ] **Step 7: Commit**

```bash
git add lib/curtain/grid.mjs lib/cli.mjs scripts/curtain-card-loop.sh test/grid.integration.test.mjs
git commit -m "feat(curtain): grid build, card loop, curtain CLI dispatch, tmux integration test"
```

---

## Task 8: Claude hook install + doctor

**Files:**
- Create: `lib/curtain/install.mjs`, `test/install.test.mjs`
- Modify: `lib/cli.mjs` (add `install`/`uninstall`/`doctor` to `runCurtain`)

**Interfaces:**
- Produces: `HOOK_CMDS`, `mergeHooks(settings) → boolean` (mutates, returns changed), `install(path) → {ok,changed?,reason?}`, `uninstall(path) → {ok,changed?}`, `hooksInstalled(settings) → boolean`.

- [ ] **Step 1: Write the failing tests (temp files)**

`test/install.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install, uninstall, mergeHooks, hooksInstalled } from "../lib/curtain/install.mjs";

const tmp = () => join(mkdtempSync(join(tmpdir(), "herald-")), "settings.json");

test("install into a fresh file writes all three hooks", () => {
  const p = tmp();
  const r = install(p);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(hooksInstalled(s), true);
});

test("install preserves unrelated keys and backs up", () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ model: "opus", hooks: { Stop: [] } }, null, 2));
  const r = install(p);
  assert.equal(r.ok, true);
  assert.equal(existsSync(`${p}.bak`), true);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(s.model, "opus");
  assert.equal(hooksInstalled(s), true);
});

test("install is idempotent (second run makes no change)", () => {
  const p = tmp();
  install(p);
  const r2 = install(p);
  assert.equal(r2.changed, false);
});

test("install aborts untouched on malformed JSON", () => {
  const p = tmp();
  writeFileSync(p, "{ not json ");
  const r = install(p);
  assert.equal(r.ok, false);
  assert.match(r.reason, /malformed/);
  assert.equal(readFileSync(p, "utf8"), "{ not json ");
});

test("uninstall removes exactly the herald hooks", () => {
  const p = tmp();
  install(p);
  const r = uninstall(p);
  assert.equal(r.changed, true);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(hooksInstalled(s), false);
});

test("mergeHooks does not duplicate an already-present hook", () => {
  const s = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "herald curtain event working" }] }] } };
  const changed = mergeHooks(s);
  const count = s.hooks.UserPromptSubmit.filter((g) => g.hooks.some((h) => h.command === "herald curtain event working")).length;
  assert.equal(count, 1);
  assert.equal(changed, true); // Stop + Notification still added
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/install.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write lib/curtain/install.mjs**

```js
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";

export const HOOK_CMDS = {
  UserPromptSubmit: "herald curtain event working",
  Stop: "herald curtain event done",
  Notification: "herald curtain event needs",
};

const entry = (command) => ({ hooks: [{ type: "command", command }] });
const has = (groups, cmd) => (groups || []).some((g) => (g.hooks || []).some((h) => h.command === cmd));

export const hooksInstalled = (settings) =>
  Object.entries(HOOK_CMDS).every(([ev, cmd]) => has(settings?.hooks?.[ev], cmd));

// Mutates settings; returns true if anything was added.
export const mergeHooks = (settings) => {
  settings.hooks ??= {};
  let changed = false;
  for (const [ev, cmd] of Object.entries(HOOK_CMDS)) {
    settings.hooks[ev] ??= [];
    if (!has(settings.hooks[ev], cmd)) { settings.hooks[ev].push(entry(cmd)); changed = true; }
  }
  return changed;
};

// Mutates settings; removes only herald hook entries; returns true if changed.
export const removeHooks = (settings) => {
  if (!settings.hooks) return false;
  let changed = false;
  for (const [ev, cmd] of Object.entries(HOOK_CMDS)) {
    const groups = settings.hooks[ev];
    if (!groups) continue;
    const kept = groups.filter((g) => !(g.hooks || []).some((h) => h.command === cmd));
    if (kept.length !== groups.length) { settings.hooks[ev] = kept; changed = true; }
  }
  return changed;
};

const load = (path) => {
  if (!existsSync(path)) return { settings: {}, existed: false };
  const raw = readFileSync(path, "utf8");
  try { return { settings: JSON.parse(raw), existed: true }; }
  catch { return { malformed: true }; }
};

export const install = (path) => {
  const l = load(path);
  if (l.malformed) return { ok: false, reason: `malformed JSON in ${path}; left untouched` };
  if (l.existed) copyFileSync(path, `${path}.bak`);
  const changed = mergeHooks(l.settings);
  if (changed) writeFileSync(path, `${JSON.stringify(l.settings, null, 2)}\n`);
  return { ok: true, changed };
};

export const uninstall = (path) => {
  const l = load(path);
  if (l.malformed) return { ok: false, reason: `malformed JSON in ${path}; left untouched` };
  if (!l.existed) return { ok: true, changed: false };
  copyFileSync(path, `${path}.bak`);
  const changed = removeHooks(l.settings);
  if (changed) writeFileSync(path, `${JSON.stringify(l.settings, null, 2)}\n`);
  return { ok: true, changed };
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/install.test.mjs`
Expected: PASS (all 6).

- [ ] **Step 5: Wire install/uninstall/doctor into runCurtain (lib/cli.mjs)**

Add import:
```js
import { install, uninstall, hooksInstalled } from "./curtain/install.mjs";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
```

Add these cases inside `runCurtain`'s `switch`:
```js
      case "install": {
        const r = install(join(homedir(), ".claude", "settings.json"));
        process.stdout.write(r.ok ? (r.changed ? "hooks installed\n" : "hooks already present\n") : `${r.reason}\n`);
        return r.ok ? 0 : 1;
      }
      case "uninstall": {
        const r = uninstall(join(homedir(), ".claude", "settings.json"));
        process.stdout.write(r.ok ? (r.changed ? "hooks removed\n" : "no hooks to remove\n") : `${r.reason}\n`);
        return r.ok ? 0 : 1;
      }
      case "doctor": {
        const checks = [];
        const settingsPath = join(homedir(), ".claude", "settings.json");
        let installed = false;
        try { installed = existsSync(settingsPath) && hooksInstalled(JSON.parse(readFileSync(settingsPath, "utf8"))); } catch {}
        checks.push(["Claude hooks wired", installed]);
        let inTmux = false; try { inTmux = !!process.env.TMUX; } catch {}
        checks.push(["inside tmux", inTmux]);
        let onPath = false; try { execFileSync("tmux", ["-V"]); onPath = true; } catch {}
        checks.push(["tmux available", onPath]);
        for (const [name, ok] of checks) process.stdout.write(`${ok ? "✓" : "✗"} ${name}\n`);
        return checks.every(([, ok]) => ok) ? 0 : 1;
      }
```

- [ ] **Step 6: Run full suite**

Run: `node --test`
Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
git add lib/curtain/install.mjs lib/cli.mjs test/install.test.mjs
git commit -m "feat(curtain): safe settings.json hook install/uninstall + doctor"
```

---

## Task 9: Docs + end-to-end smoke + finish

**Files:**
- Create: `README.md` (curtain usage section)
- Modify: `plans/README.md` (note the vertical-slice status)

**Interfaces:** none (documentation + manual verification).

- [ ] **Step 1: Write README.md usage section**

`README.md`:
```markdown
# status-herald (HERALD)

Heads-up engine for terminal status surfaces.

## Curtain (phase 1)

Covers a working Claude Code pane in a tmux grid with an opaque status card;
focus a card to open the live session.

### Install

```bash
npm install            # dev deps only (biome); zero runtime deps
npm link               # put `herald` on PATH
herald curtain install # wire Claude Code hooks into ~/.claude/settings.json
```

### Use

```bash
herald curtain up --slots 2 --cmd claude   # build the grid on Manjaro
# from the Mac: ssh manjaro -t 'tmux attach -t grid'
herald curtain doctor                      # verify wiring
herald curtain down                        # tear down
```

While a session works and its pane is unfocused it shows `● WORKING m:ss`;
finished panes show `✅ DONE`; blocked panes show `⚠ NEEDS YOU`. Click a card
to reveal the live session; click away to re-cover it while it is still
working.

Grind Mode (Mac idle-nag) is phase 2 — separate spec.
```

- [ ] **Step 2: Run the full test suite and lint**

Run:
```bash
node --test
npx biome check .
```
Expected: tests PASS; biome exits 0 (or reports only style — fix with `npm run format`).

- [ ] **Step 3: Manual end-to-end smoke (real tmux + Claude)**

On Manjaro:
```bash
npm link && herald curtain install
herald curtain up --slots 2 --cmd claude
```
From the Mac Ghostty: `ssh manjaro -t 'tmux attach -t grid'`. Verify:
1. Submit a prompt in an unfocused pane → it covers with `● WORKING`.
2. Elapsed time ticks each second.
3. Click the card → live Claude revealed and focused; click the other pane → first re-covers.
4. Let a session finish → card flips to `✅ DONE`; a gate → `⚠ NEEDS YOU` and the existing `ping-mac-music.sh` fires.
5. `herald curtain down` cleans up.

Record PASS/FAIL per item in the task review.

- [ ] **Step 4: Update plans/README.md status note**

Add a line under the execution table noting the curtain vertical slice landed (render core slice + curtain-card surface + orchestrator) ahead of plans 002/005, which will later supersede the trimmed `render.mjs`.

- [ ] **Step 5: Commit**

```bash
git add README.md plans/README.md
git commit -m "docs(curtain): README usage + vertical-slice status note"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** curtain-card surface → T4; session-state on pane options → T6/T7 (`@herald_state`/`@herald_since`); `herald curtain` orchestrator (swap/cover/reveal/focus) → T6/T7; hooks + installer/doctor → T8; render core slice → T2; state helpers → T3; grid up/down + holding-window mirror → T7; Phase 0 spike gate → T0; testing (unit + headless integration) → T2–T8; risks (focus-events, alt-screen swap) → T0 spike. All spec sections mapped.

**Placeholder scan:** no TBD/TODO; every code step carries complete code and exact commands.

**Type consistency:** `@herald_*` option keys, `STATES` values, `cover/reveal/onEvent/onFocusIn/onFocusOut` signatures, and `HOOK_CMDS` command strings match across T3–T8 and the card-loop script and settings.json wiring (`herald curtain event working|done|needs`).

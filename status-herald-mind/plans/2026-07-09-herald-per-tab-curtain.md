# HERALD Per-Tab Curtain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-cover a backgrounded Ghostty tab (each tab = one mosh'd tmux session) with a HERALD status card and reveal the focused one, driven by a Mac Hammerspoon agent over ssh — keeping mosh.

**Architecture:** A Mac Hammerspoon agent watches the focused Ghostty tab title and sends one `herald curtain focus "<title>"` to the box over ssh+ControlMaster on every tab switch. The box (Node/tmux) resolves title→session and reveals the match while covering every other armed session that is working/done/needs. Cover/reveal is a per-session `select-window` between the live claude window and a hidden `_curtain` card window. Phase-1's render/state/card layers are reused unchanged.

**Tech Stack:** Node ≥20 ESM (`node:*` only, `node:test`), tmux 3.x, bash card-loop, Hammerspoon (Lua) on the Mac, ssh ControlMaster.

**Source spec:** `docs/superpowers/specs/2026-07-09-herald-per-tab-curtain-design.md`

## Global Constraints

- **Box side:** zero runtime dependencies; ESM `.mjs`; `node:*` builtins only; Node ≥ 20; `node:test`; biome dev-only.
- All box hook/CLI paths **hook-safe**: swallow errors, exit 0; a broken tmux call is a no-op, never a thrown error.
- tmux options/hooks **session-scoped, never `-g`** for anything behavior-changing.
- **No reliance on terminal focus events reaching the box** (mosh 1.4.0 drops them).
- **Reuse phase-1 lower layers** (`render.mjs`, `surfaces/curtain-card.mjs`, `curtain/state.mjs`, `curtain/tmux.mjs`); do not fork them.
- **Naming:** card window `_curtain`; session options `@herald_armed`, `@herald_state`, `@herald_since`, `@herald_covered`, `@herald_live_win`. Coverable states = `working`, `done`, `needs` (idle never covers). `focus` is keyed by the title string.
- **Mac side:** Hammerspoon (Lua); ssh with ControlMaster; passwordless key Mac→box; no secrets committed.
- **Push only when the user asks.** Commit per task.

## Execution note — two slices, one gate

- **Slice 1 (Tasks 1–5): box engine.** Native, fully testable here, subagent-executable. Deliverable: `herald curtain arm|cover|reveal|focus|reveal-all` works over the user's real mosh.
- **GATE — Task 6: Phase-0 Hammerspoon spike.** User-run on the Mac. Must pass before the Mac agent is built.
- **Slice 2 (Tasks 7–9): Mac agent + wiring + e2e.** Lua/config authored here, **installed and accepted by the user** (not unit-testable on the box). An SDD controller should treat Tasks 7–9 as author-then-hand-to-user, not code-subagent dispatch.

## File Structure

- `lib/curtain/tmux.mjs` (modify) — add session/window argv builders + wrappers (`getSessOpt`, `setSessOpt`, `sessionOf`, `activeWindowId`, `selectWindow`, `newCardWindow`, `killWindow`, `listArmed`).
- `lib/curtain/session.mjs` (create) — per-session engine: `arm`, `disarm`, `cover`, `reveal`, `revealAll`, `focus`, `stampSession`. Pure logic over an injectable tmux facade.
- `scripts/curtain-card-session.sh` (create) — card-loop that reads its own session's `@herald_state` and reveals on any keypress (fail-open).
- `lib/cli.mjs` (modify) — wire `arm|disarm|cover|reveal|focus|reveal-all` into `runCurtain`; add session-scoped stamping to the `event` case.
- `test/session.test.mjs` (create) — unit tests with an injected tmux double.
- `test/session.integration.test.mjs` (create) — full cover/reveal/focus cycle on an isolated tmux server.
- `test/curtain-cli.test.mjs` (modify) — dispatch tests for the new subcommands.
- `mac/herald.lua` (create) — Hammerspoon agent.
- `mac/herald-spike.lua` (create) — Phase-0 spike snippet.
- `README.md` (modify) — per-tab usage (box) + Mac install (ssh config, Hammerspoon, repo-session auto-arm).

---

## Task 1: tmux session/window wrappers

**Files:**
- Modify: `lib/curtain/tmux.mjs`
- Test: `test/tmux.test.mjs`

**Interfaces:**
- Consumes: module-local `run(args)`, existing `buildArgs`, existing `windowNameOf`.
- Produces: `getSessOpt(sess,name)→string`, `setSessOpt(sess,name,value)→void`, `sessionOf(pane)→string`, `activeWindowId(sess)→string`, `selectWindow(target)→void`, `newCardWindow(sess,name,loop)→void`, `killWindow(target)→void`, `listArmed()→Array<{name,liveWin}>`. New `buildArgs` entries of the same names (except `listArmed` builder).

- [ ] **Step 1: Write the failing argv tests**

Append to `test/tmux.test.mjs`:
```js
import {
  getSessOpt as _g, // ensure exports exist (referenced below via buildArgs)
} from "../lib/curtain/tmux.mjs";
import { buildArgs } from "../lib/curtain/tmux.mjs";

test("buildArgs.getSessOpt reads a session-scoped option (no -p)", () => {
  assert.deepEqual(buildArgs.getSessOpt("syndcast", "@herald_state"), [
    "show", "-t", "syndcast", "-v", "@herald_state",
  ]);
});

test("buildArgs.setSessOpt sets a session-scoped option", () => {
  assert.deepEqual(buildArgs.setSessOpt("syndcast", "@herald_armed", 1), [
    "set", "-t", "syndcast", "@herald_armed", "1",
  ]);
});

test("buildArgs.activeWindowId reads the active window id", () => {
  assert.deepEqual(buildArgs.activeWindowId("syndcast"), [
    "display", "-p", "-t", "syndcast", "#{window_id}",
  ]);
});

test("buildArgs.newCardWindow creates a detached named window", () => {
  assert.deepEqual(buildArgs.newCardWindow("syndcast", "_curtain", "/x/loop.sh"), [
    "new-window", "-d", "-n", "_curtain", "-t", "syndcast:", "bash", "/x/loop.sh",
  ]);
});

test("buildArgs.selectWindow / killWindow target a window", () => {
  assert.deepEqual(buildArgs.selectWindow("@3"), ["select-window", "-t", "@3"]);
  assert.deepEqual(buildArgs.killWindow("syndcast:_curtain"), [
    "kill-window", "-t", "syndcast:_curtain",
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/tmux.test.mjs`
Expected: FAIL (`buildArgs.getSessOpt is not a function`).

- [ ] **Step 3: Add builders + wrappers to `lib/curtain/tmux.mjs`**

Add these entries inside the `buildArgs` object (after the existing `focus` entry):
```js
  getSessOpt: (sess, name) => ["show", "-t", sess, "-v", name],
  setSessOpt: (sess, name, value) => ["set", "-t", sess, name, String(value)],
  sessionOf: (pane) => ["display", "-p", "-t", pane, "#{session_name}"],
  activeWindowId: (sess) => ["display", "-p", "-t", sess, "#{window_id}"],
  selectWindow: (target) => ["select-window", "-t", target],
  newCardWindow: (sess, name, loop) => [
    "new-window", "-d", "-n", name, "-t", `${sess}:`, "bash", loop,
  ],
  killWindow: (target) => ["kill-window", "-t", target],
```

Append these wrappers at the end of the file (after `isFocused`):
```js
export const getSessOpt = (sess, name) =>
  run(buildArgs.getSessOpt(sess, name)) || "";
export const setSessOpt = (sess, name, value) => {
  run(buildArgs.setSessOpt(sess, name, value));
};
export const sessionOf = (pane) => run(buildArgs.sessionOf(pane)) || "";
export const activeWindowId = (sess) =>
  run(buildArgs.activeWindowId(sess)) || "";
export const selectWindow = (target) => {
  run(buildArgs.selectWindow(target));
};
export const newCardWindow = (sess, name, loop) => {
  run(buildArgs.newCardWindow(sess, name, loop));
};
export const killWindow = (target) => {
  run(buildArgs.killWindow(target));
};

// One call: every session with @herald_armed=1 plus its stored live-window id.
export const listArmed = () => {
  const raw = run([
    "list-sessions",
    "-F",
    "#{session_name}\t#{@herald_armed}\t#{@herald_live_win}",
  ]);
  if (!raw) return [];
  return raw
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p[1] === "1")
    .map((p) => ({ name: p[0], liveWin: p[2] || "" }));
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/tmux.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/curtain/tmux.mjs test/tmux.test.mjs
git commit -m "feat(curtain): session/window tmux wrappers for per-tab mode"
```

---

## Task 2: session engine — arm/disarm/cover/reveal/revealAll

**Files:**
- Create: `lib/curtain/session.mjs`
- Test: `test/session.test.mjs`

**Interfaces:**
- Consumes: `tmux.mjs` (`getSessOpt`, `setSessOpt`, `activeWindowId`, `selectWindow`, `newCardWindow`, `killWindow`, `windowNameOf`, `listArmed`); `state.mjs` (`STATES`).
- Produces: `CARD_WIN="_curtain"`, `arm(sess,t?)`, `disarm(sess,t?)`, `cover(sess,t?)`, `reveal(sess,t?)`, `revealAll(t?)`. `focus`/`stampSession` land in Task 3. All take an optional tmux facade `t` (defaults to the real module) for dependency injection.

- [ ] **Step 1: Write the failing tests (injected tmux double)**

`test/session.test.mjs`:
```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { arm, cover, reveal, revealAll } from "../lib/curtain/session.mjs";

// In-memory tmux double. Sessions: { [name]: { opts:{}, active:winId, windows:{winId:name} } }
const makeT = (init = {}) => {
  const S = init;
  return {
    _S: S,
    getSessOpt: (s, k) => (S[s]?.opts?.[k] ?? ""),
    setSessOpt: (s, k, v) => {
      (S[s] ??= { opts: {}, active: "@live", windows: {} }).opts[k] = String(v);
    },
    activeWindowId: (s) => S[s]?.active ?? "",
    selectWindow: (target) => {
      // target is either "sess:_curtain" or a window id "@live"
      if (target.includes(":")) {
        const [s] = target.split(":");
        S[s].active = "@curtain";
      } else {
        for (const s of Object.keys(S)) if (S[s].windows?.[target] !== undefined) S[s].active = target;
      }
    },
    newCardWindow: (s, name, _loop) => {
      (S[s] ??= { opts: {}, active: "@live", windows: {} }).windows["@curtain"] = name;
    },
    killWindow: () => {},
    windowNameOf: (winId) => {
      for (const s of Object.keys(S)) if (S[s].windows?.[winId] !== undefined) return S[s].windows[winId];
      return "";
    },
    listArmed: () =>
      Object.entries(S)
        .filter(([, v]) => v.opts?.["@herald_armed"] === "1")
        .map(([name, v]) => ({ name, liveWin: v.opts?.["@herald_live_win"] || "" })),
  };
};

const freshSession = () => ({
  s1: { opts: {}, active: "@live", windows: { "@live": "Syndcast Backlog" } },
});

test("arm marks the session, records live window, creates the card window", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_armed"), "1");
  assert.equal(t.getSessOpt("s1", "@herald_live_win"), "@live");
  assert.equal(t.getSessOpt("s1", "@herald_state"), "idle");
  assert.equal(t._S.s1.windows["@curtain"], "_curtain");
});

test("arm is idempotent", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t._S.s1.opts["@herald_live_win"] = "@sentinel"; // must NOT be overwritten
  arm("s1", t);
  assert.equal(t.getSessOpt("s1", "@herald_live_win"), "@sentinel");
});

test("cover switches to the card window only when state is coverable", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  cover("s1", t); // state idle -> no cover
  assert.equal(t._S.s1.active, "@live");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "0");
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t);
  assert.equal(t._S.s1.active, "@curtain");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
});

test("reveal restores the remembered live window", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t);
  reveal("s1", t);
  assert.equal(t._S.s1.active, "@live");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "0");
});

test("cover is a no-op when already covered (live window not lost)", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t);
  cover("s1", t); // second cover must not overwrite @herald_live_win with @curtain
  assert.equal(t.getSessOpt("s1", "@herald_live_win"), "@live");
});

test("revealAll reveals every covered armed session", () => {
  const t = makeT(freshSession());
  arm("s1", t);
  t.setSessOpt("s1", "@herald_state", "done");
  cover("s1", t);
  revealAll(t);
  assert.equal(t._S.s1.active, "@live");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/session.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/curtain/session.mjs`**

```js
import { fileURLToPath } from "node:url";
import { STATES } from "./state.mjs";
import * as realTmux from "./tmux.mjs";

export const CARD_WIN = "_curtain";
const COVERABLE = new Set([STATES.WORKING, STATES.DONE, STATES.NEEDS]);
const LOOP = fileURLToPath(
  new URL("../../scripts/curtain-card-session.sh", import.meta.url),
);

// Add a hidden card window to a session and mark it armed. Idempotent.
export const arm = (sess, t = realTmux) => {
  if (t.getSessOpt(sess, "@herald_armed") === "1") return;
  const liveWin = t.activeWindowId(sess);
  t.newCardWindow(sess, CARD_WIN, LOOP);
  t.setSessOpt(sess, "@herald_live_win", liveWin);
  t.setSessOpt(sess, "@herald_state", STATES.IDLE);
  t.setSessOpt(sess, "@herald_covered", "0");
  t.setSessOpt(sess, "@herald_armed", "1");
};

// Restore the live view, drop the card window and the armed marker.
export const disarm = (sess, t = realTmux) => {
  reveal(sess, t);
  t.killWindow(`${sess}:${CARD_WIN}`);
  t.setSessOpt(sess, "@herald_armed", "0");
};

// Show the card, if this session is armed, coverable, and not already covered.
export const cover = (sess, t = realTmux) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") === "1") return;
  if (!COVERABLE.has(t.getSessOpt(sess, "@herald_state"))) return;
  t.setSessOpt(sess, "@herald_live_win", t.activeWindowId(sess));
  t.selectWindow(`${sess}:${CARD_WIN}`);
  t.setSessOpt(sess, "@herald_covered", "1");
};

// Bring the remembered live window back.
export const reveal = (sess, t = realTmux) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") !== "1") return;
  const live = t.getSessOpt(sess, "@herald_live_win");
  if (live) t.selectWindow(live);
  t.setSessOpt(sess, "@herald_covered", "0");
};

// Panic / fail-open: reveal every covered armed session.
export const revealAll = (t = realTmux) => {
  for (const s of t.listArmed()) reveal(s.name, t);
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/session.test.mjs`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/curtain/session.mjs test/session.test.mjs
git commit -m "feat(curtain): per-session arm/cover/reveal engine"
```

---

## Task 3: focus resolution + session state stamping

**Files:**
- Modify: `lib/curtain/session.mjs`
- Test: `test/session.test.mjs`

**Interfaces:**
- Consumes: Task 2 exports (`cover`, `reveal`), `tmux.mjs` (`listArmed`, `windowNameOf`, `sessionOf`, `setSessOpt`), `state.mjs` (`STATES`).
- Produces: `focus(title,t?)` — reveal the armed session whose live-window name equals `title`, cover every other armed session (cover self-guards on coverable); empty/unmatched `title` covers all coverable. `stampSession(pane,state,nowSec,t?)` — set session-scoped `@herald_state` (and `@herald_since` on `working`).

- [ ] **Step 1: Add the failing tests**

Append to `test/session.test.mjs`:
```js
import { focus, stampSession } from "../lib/curtain/session.mjs";

const twoArmed = () => ({
  s1: { opts: { "@herald_armed": "1", "@herald_live_win": "@w1", "@herald_state": "working", "@herald_covered": "0" }, active: "@w1", windows: { "@w1": "Syndcast Backlog", "@curtain": "_curtain" } },
  s2: { opts: { "@herald_armed": "1", "@herald_live_win": "@w2", "@herald_state": "working", "@herald_covered": "0" }, active: "@w2", windows: { "@w2": "Sage Run", "@curtain": "_curtain" } },
});

test("focus reveals the matching title and covers the rest", () => {
  const t = makeT(twoArmed());
  // start both covered so we can observe the reveal of the match
  cover("s1", t);
  cover("s2", t);
  focus("Syndcast Backlog", t);
  assert.equal(t._S.s1.active, "@w1", "matched session revealed");
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "0");
  assert.equal(t._S.s2.active, "@curtain", "other session stays covered");
  assert.equal(t.getSessOpt("s2", "@herald_covered"), "1");
});

test("focus with an empty title covers all coverable sessions", () => {
  const t = makeT(twoArmed());
  focus("", t);
  assert.equal(t.getSessOpt("s1", "@herald_covered"), "1");
  assert.equal(t.getSessOpt("s2", "@herald_covered"), "1");
});

test("focus never covers an idle session", () => {
  const t = makeT(twoArmed());
  t.setSessOpt("s2", "@herald_state", "idle");
  focus("Syndcast Backlog", t);
  assert.equal(t.getSessOpt("s2", "@herald_covered"), "0", "idle stays live");
});

test("stampSession sets session state and since on working", () => {
  const t = makeT(freshSession());
  t.sessionOf = () => "s1";
  stampSession("%9", "working", 1000, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "working");
  assert.equal(t.getSessOpt("s1", "@herald_since"), "1000");
  stampSession("%9", "done", 2000, t);
  assert.equal(t.getSessOpt("s1", "@herald_state"), "done");
  assert.equal(t.getSessOpt("s1", "@herald_since"), "1000", "since unchanged off working");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/session.test.mjs`
Expected: FAIL (`focus is not a function`).

- [ ] **Step 3: Add `focus` and `stampSession` to `lib/curtain/session.mjs`**

Append:
```js
// Mac-agent entry: reveal the tab whose live-window label matches `title`,
// cover every other armed session (cover() self-guards on coverable state).
export const focus = (title, t = realTmux) => {
  for (const s of t.listArmed()) {
    const label = t.windowNameOf(s.liveWin);
    if (title && label === title) reveal(s.name, t);
    else cover(s.name, t);
  }
};

// Claude-hook entry: stamp session-scoped state; set @herald_since on working.
export const stampSession = (pane, state, nowSec, t = realTmux) => {
  const sess = t.sessionOf(pane);
  if (!sess) return;
  t.setSessOpt(sess, "@herald_state", state);
  if (state === STATES.WORKING) t.setSessOpt(sess, "@herald_since", nowSec);
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/session.test.mjs`
Expected: PASS (10/10).

- [ ] **Step 5: Commit**

```bash
git add lib/curtain/session.mjs test/session.test.mjs
git commit -m "feat(curtain): focus resolution + session state stamping"
```

---

## Task 4: card-loop-session script + CLI wiring

**Files:**
- Create: `scripts/curtain-card-session.sh`
- Modify: `lib/cli.mjs`
- Test: `test/curtain-cli.test.mjs`

**Interfaces:**
- Consumes: `session.mjs` (`arm`, `disarm`, `cover`, `reveal`, `revealAll`, `focus`, `stampSession`), `tmux.mjs` (`sessionOf`).
- Produces: CLI `herald curtain <arm [sess] | disarm | cover <sess> | reveal <sess> | focus "<title>" | reveal-all>`; the `event` case additionally stamps session state; the loop script `scripts/curtain-card-session.sh`.

- [ ] **Step 1: Write the card-loop script**

`scripts/curtain-card-session.sh`:
```bash
#!/usr/bin/env bash
# Runs inside a session's _curtain window. Repaints the card once/second from
# THIS session's @herald_state. Any keypress reveals the session (fail-open, so
# a dead Mac agent can never trap you behind the card). Never exits.
set -u
sess=$(tmux display -p '#{session_name}' 2>/dev/null)
[ -n "$sess" ] || exit 0
printf '\033[?25l'
while :; do
  state=$(tmux show -t "$sess" -v @herald_state 2>/dev/null)
  since=$(tmux show -t "$sess" -v @herald_since 2>/dev/null)
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  if read -rsn1 -t 1 2>/dev/null; then
    herald curtain reveal "$sess" >/dev/null 2>&1 || true
  fi
done
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/curtain-card-session.sh`

- [ ] **Step 3: Write the failing CLI dispatch tests**

Append to `test/curtain-cli.test.mjs` (a spawn-based dispatch test — no tmux needed; the commands are hook-safe and exit 0 outside tmux):
```js
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/herald", import.meta.url));
const runCli = (args, env = {}) =>
  execFileSync("node", [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, TMUX: "", TMUX_PANE: "", ...env },
  });

test("curtain focus outside tmux is hook-safe (exit 0, no throw)", () => {
  // listArmed returns [] with no tmux; focus is a no-op that must not throw.
  const out = runCli(["curtain", "focus", "Nothing"]);
  assert.equal(typeof out, "string");
});

test("curtain reveal-all outside tmux is hook-safe", () => {
  runCli(["curtain", "reveal-all"]);
});

test("curtain arm outside tmux is hook-safe", () => {
  runCli(["curtain", "arm"]);
});

test("unknown curtain subcommand still prints usage listing new verbs", () => {
  let out = "";
  try {
    execFileSync("node", [BIN, "curtain", "bogus"], { encoding: "utf8" });
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  assert.match(out, /arm/);
  assert.match(out, /focus/);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `node --test test/curtain-cli.test.mjs`
Expected: FAIL (`bogus` usage lacks `arm`/`focus`; focus/reveal-all/arm cases missing).

- [ ] **Step 5: Wire the CLI in `lib/cli.mjs`**

Add imports (top, with the other curtain imports):
```js
import {
  arm,
  cover,
  disarm,
  focus,
  reveal,
  revealAll,
  stampSession,
} from "./curtain/session.mjs";
import { getOpt, sessionOf } from "./curtain/tmux.mjs";
```
(Delete the now-duplicated `import { getOpt } from "./curtain/tmux.mjs";` line — merge into the line above.)

Add a helper above `runCurtain`:
```js
const curSession = () => {
  const pane = process.env.TMUX_PANE;
  return pane ? sessionOf(pane) : "";
};
```

In the `event` case, stamp session state alongside the existing pane stamp:
```js
      case "event": {
        const pane = process.env.TMUX_PANE;
        if (pane && rest[0]) {
          const now = Math.floor(Date.now() / 1000);
          onEvent(pane, rest[0], now);
          stampSession(pane, rest[0], now);
        }
        return 0;
      }
```

Add these cases to the `switch` (before `default`):
```js
      case "arm": {
        const s = rest[0] || curSession();
        if (s) arm(s);
        return 0;
      }
      case "disarm": {
        const s = rest[0] || curSession();
        if (s) disarm(s);
        return 0;
      }
      case "cover":
        if (rest[0]) cover(rest[0]);
        return 0;
      case "reveal":
        if (rest[0]) reveal(rest[0]);
        return 0;
      case "reveal-all":
        revealAll();
        return 0;
      case "focus":
        focus(rest[0] || "");
        return 0;
```

Update the `default` usage string:
```js
      default:
        process.stderr.write(
          "usage: herald curtain <up|down|arm|disarm|cover|reveal|reveal-all|focus|event|status|install|uninstall|doctor>\n",
        );
        return 1;
```

- [ ] **Step 6: Run to verify pass**

Run: `node --test test/curtain-cli.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/curtain-card-session.sh lib/cli.mjs test/curtain-cli.test.mjs
git commit -m "feat(curtain): per-tab CLI (arm/cover/reveal/focus/reveal-all) + card loop"
```

---

## Task 5: integration test (isolated tmux) + README

**Files:**
- Create: `test/session.integration.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `session.mjs` (`arm`, `cover`, `reveal`, `focus`, `revealAll`), `tmux.mjs` (`getSessOpt`, `setSessOpt`).

- [ ] **Step 1: Write the integration test (real tmux, isolated server)**

`test/session.integration.test.mjs`:
```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { arm, cover, focus, reveal, revealAll } from "../lib/curtain/session.mjs";
import { getSessOpt, setSessOpt } from "../lib/curtain/tmux.mjs";

const hasTmux = () => {
  try { execFileSync("tmux", ["-V"]); return true; } catch { return false; }
};
const tt = (a) => execFileSync("tmux", a, { encoding: "utf8" }).trim();
const activeWin = (s) => tt(["display", "-p", "-t", s, "#{window_name}"]);

test(
  "per-session cover/reveal/focus cycle on an isolated tmux server",
  { skip: !hasTmux() },
  () => {
    const origTmpdir = process.env.TMUX_TMPDIR;
    const origTmux = process.env.TMUX;
    const dir = mkdtempSync(join(tmpdir(), "herald-sess-"));
    process.env.TMUX_TMPDIR = dir;
    // biome-ignore lint/performance/noDelete: env must be truly unset to look "outside tmux".
    delete process.env.TMUX;
    try {
      // Two sessions, each a "live" window named like a Claude label.
      tt(["new-session", "-d", "-s", "s1", "-n", "Syndcast Backlog", "sleep 1000"]);
      tt(["new-session", "-d", "-s", "s2", "-n", "Sage Run", "sleep 1000"]);

      arm("s1");
      arm("s2");
      assert.equal(getSessOpt("s1", "@herald_armed"), "1");
      assert.equal(activeWin("s1"), "Syndcast Backlog", "arm leaves live window active");

      // cover requires a coverable state
      setSessOpt("s1", "@herald_state", "working");
      setSessOpt("s2", "@herald_state", "working");
      cover("s1");
      assert.equal(activeWin("s1"), "_curtain", "s1 covered");
      reveal("s1");
      assert.equal(activeWin("s1"), "Syndcast Backlog", "s1 revealed");

      // focus s1's label: reveal s1, cover s2
      cover("s1");
      focus("Syndcast Backlog");
      assert.equal(activeWin("s1"), "Syndcast Backlog", "focus revealed the match");
      assert.equal(activeWin("s2"), "_curtain", "focus covered the rest");

      // reveal-all clears everything
      revealAll();
      assert.equal(activeWin("s1"), "Syndcast Backlog");
      assert.equal(activeWin("s2"), "Sage Run");

      // idle session is never covered by focus
      setSessOpt("s2", "@herald_state", "idle");
      focus("Syndcast Backlog");
      assert.equal(activeWin("s2"), "Sage Run", "idle stays live");
    } finally {
      try { execFileSync("tmux", ["kill-server"], { stdio: "ignore" }); } catch {}
      // biome-ignore lint/performance/noDelete: restore a possibly-unset var.
      if (origTmpdir === undefined) delete process.env.TMUX_TMPDIR;
      else process.env.TMUX_TMPDIR = origTmpdir;
      // biome-ignore lint/performance/noDelete: restore a possibly-unset var.
      if (origTmux === undefined) delete process.env.TMUX;
      else process.env.TMUX = origTmux;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
```

- [ ] **Step 2: Run the full suite**

Run: `node --test`
Expected: PASS (all suites, including the new integration test if tmux present).

- [ ] **Step 3: Add the per-tab usage section to `README.md`**

Insert after the phase-1 Curtain section:
```markdown
## Per-tab curtain (mosh)

Each Ghostty tab is a separate mosh'd tmux session. The curtain covers a
backgrounded tab with its status card and reveals the tab you switch to.
The trigger comes from a Mac Hammerspoon agent (see "Mac install"); the box
exposes these commands:

```bash
herald curtain arm [<session>]   # add a card window to a session (run inside it, or name it)
herald curtain disarm            # remove it
herald curtain cover <session>   # show the card (if working/done/needs)
herald curtain reveal <session>  # show the live session
herald curtain focus "<title>"   # reveal the tab whose label == title, cover the rest
herald curtain reveal-all        # panic: reveal everything
```

Fail-open: pressing any key in a card reveals its session, so a dead agent
never traps you. Idle sessions are never covered.

Test it over mosh without the Mac agent:

```bash
herald curtain arm syndcast
tmux set -t syndcast @herald_state working
ssh <box> herald curtain cover syndcast   # flip to the syndcast tab -> card
ssh <box> herald curtain reveal syndcast  # -> live session
```
```

- [ ] **Step 4: Lint + commit**

Run: `npx biome check .` (fix with `npm run format` if only style).
```bash
git add test/session.integration.test.mjs README.md
git commit -m "test(curtain): per-session integration cycle + per-tab README"
```

---

## Task 6: Phase-0 Hammerspoon spike (GATE — user-run on the Mac)

**Files:**
- Create: `mac/herald-spike.lua`

**This is a gate, not a code task.** It proves the load-bearing assumption — that Hammerspoon fires on Ghostty *tab* switches (title change within one window) — before the full agent is built. Do not build Task 7 until this passes.

- [ ] **Step 1: Write the spike snippet**

`mac/herald-spike.lua`:
```lua
-- Phase-0 spike. Paste into the Hammerspoon Console (or require from init.lua),
-- then switch Ghostty tabs and watch the console.
local wf = hs.window.filter.new(false):setAppFilter("Ghostty", {})
wf:subscribe(hs.window.filter.windowTitleChanged, function(w)
  print("TITLE ->", w and w:title())
end)
wf:subscribe(hs.window.filter.windowFocused, function(w)
  print("FOCUS ->", w and w:title())
end)
print("herald spike armed — switch Ghostty tabs; distinct TITLE lines = PASS")
```

- [ ] **Step 2: User runs it**

Instruct the user:
1. Open Hammerspoon → Console.
2. Paste the snippet (or `dofile` the file) and press Return.
3. Switch between Ghostty tabs several times.
4. Report the console output.

- [ ] **Step 3: Evaluate the gate**

- **PASS:** distinct `TITLE ->` lines appear per tab (titles match the Claude labels). Proceed to Task 7.
- **FAIL (no lines / same title):** Ghostty tab switches don't surface as title changes to Hammerspoon. Stop; do NOT build the agent as designed. Investigate an alternate Ghostty focus signal (Ghostty IPC / a keybind action that shells out) and revise the spec before continuing.

- [ ] **Step 4: Commit the spike file**

```bash
git add mac/herald-spike.lua
git commit -m "chore(curtain): Phase-0 Hammerspoon tab-detection spike"
```

---

## Task 7: Hammerspoon agent (author here, user installs)

**Files:**
- Create: `mac/herald.lua`

**Interfaces:**
- Produces: `mac/herald.lua` exposing `start()`, which sends `herald curtain focus "<title>"` to the box on every focus/tab change.

**Not unit-testable on the box.** Author the file; the user installs it and accepts it in Task 9.

- [ ] **Step 1: Write `mac/herald.lua`**

```lua
-- ~/.hammerspoon/herald.lua
-- In ~/.hammerspoon/init.lua add:  require("herald").start()
local M = {}

local BOX = "box"                       -- ssh host alias (ControlMaster set up)
local GHOSTTY_BUNDLE = "com.mitchellh.ghostty"
local DEBOUNCE = 0.075

local lastTitle = nil
local pending = nil

local function shq(s)                    -- POSIX single-quote escape for the remote shell
  return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

local function currentTitle()
  local app = hs.application.frontmostApplication()
  if not app or app:bundleID() ~= GHOSTTY_BUNDLE then return "" end
  local win = app:focusedWindow()
  if not win then return "" end
  return win:title() or ""
end

local function send(title)
  hs.task.new("/usr/bin/ssh", nil,
    { BOX, "herald curtain focus " .. shq(title) }):start()
end

local function fire()
  local t = currentTitle()
  if t == lastTitle then return end
  lastTitle = t
  send(t)
end

local function schedule()
  if pending then pending:stop() end
  pending = hs.timer.doAfter(DEBOUNCE, fire)
end

function M.start()
  -- App focus (Ghostty <-> other apps)
  M.appWatcher = hs.application.watcher.new(function(_, event)
    if event == hs.application.watcher.activated
       or event == hs.application.watcher.deactivated then
      schedule()
    end
  end)
  M.appWatcher:start()

  -- Tab/title changes within Ghostty
  M.wf = hs.window.filter.new(false):setAppFilter("Ghostty", {})
  M.wf:subscribe(hs.window.filter.windowTitleChanged, schedule)
  M.wf:subscribe(hs.window.filter.windowFocused, schedule)

  fire() -- prime with the current tab
  hs.printf("herald agent started (box=%s)", BOX)
  return M
end

return M
```

- [ ] **Step 2: Commit**

```bash
git add mac/herald.lua
git commit -m "feat(curtain): Hammerspoon focus agent (Mac)"
```

---

## Task 8: ssh ControlMaster + repo-session auto-arm + Mac install docs

**Files:**
- Modify: `README.md`
- (User system, documented, not committed to the repo:) `~/.ssh/config` (Mac), `~/.local/bin/repo-session` (box)

**Interfaces:** none (configuration + docs).

- [ ] **Step 1: Document the Mac ssh ControlMaster block**

Add to `README.md` under a new "Mac install" section:
```markdown
## Mac install

1. **ssh ControlMaster** — in `~/.ssh/config` on the Mac, so each focus event
   reuses one connection (~20ms, not a fresh handshake):

   ```
   Host box
       HostName <manjaro-host-or-ip>
       User <you>
       ControlMaster auto
       ControlPath ~/.ssh/cm-%r@%h:%p
       ControlPersist 10m
   ```
   Requires a passwordless key Mac→box (`ssh-copy-id box`).

2. **Hammerspoon agent** — copy `mac/herald.lua` to `~/.hammerspoon/herald.lua`,
   set `BOX` to your ssh alias, and add to `~/.hammerspoon/init.lua`:
   ```lua
   require("herald").start()
   ```
   Reload Hammerspoon; grant Accessibility permission when prompted.

3. **Auto-arm new sessions** — see below.
```

- [ ] **Step 2: repo-session auto-arm patch (box, user system file)**

Document (and apply, with user consent) this edit to `~/.local/bin/repo-session`. In both session-creation spots (the `claim`/`fill` block and the default/`--new` block), immediately after the `send-keys "${startcmd...}"` line that launches the session, add:
```bash
  # HERALD: arm a claude session for the per-tab curtain (no-op if herald absent)
  [[ "${startcmd:-}" == claude* ]] && \
    "$TMUXBIN" run-shell -t "$target" "herald curtain arm $target" 2>/dev/null || true
```
(Use `$target` in the claim/fill block; use `$session` in the default block.)
Until this is applied, arm by hand: `herald curtain arm <session>`.

- [ ] **Step 3: Commit the docs**

```bash
git add README.md
git commit -m "docs(curtain): Mac install (ssh ControlMaster, Hammerspoon, auto-arm)"
```

---

## Task 9: End-to-end manual acceptance (user hardware)

**Files:** none (verification).

Run the whole feature on the user's Mac + box and record PASS/FAIL per item.

- [ ] **Step 1: Arm and start**

```bash
# box: arm two real sessions
herald curtain arm syndcast
herald curtain arm agentic-sage
# Mac: reload Hammerspoon with require("herald").start()
```

- [ ] **Step 2: Verify the cycle**

1. Submit a prompt in `syndcast` (→ `@herald_state working`), switch to the `agentic-sage` tab. Expected: `syndcast` covers with `● WORKING m:ss`.
2. Switch back to `syndcast`. Expected: live Claude revealed within ~1 tab-switch.
3. Let a session finish → its card shows `✅ DONE` while backgrounded; a Notification gate → `⚠ NEEDS YOU`.
4. Idle session: switch away from a session with no activity → it stays live (no card).

- [ ] **Step 3: Verify fail-open**

1. Quit Hammerspoon. Cover a session manually (`ssh box herald curtain cover syndcast`), flip to its tab, press any key → it reveals.
2. `ssh box herald curtain reveal-all` reveals everything.

- [ ] **Step 4: Record results**

Note PASS/FAIL per item in the final review. Any FAIL feeds a fix task.

---

## Self-Review

**Spec coverage:** single `focus "<title>"` contract → T3/T4; per-session cover via `select-window` + card window → T2/T4; session-scoped state (`@herald_*`, never `-g`) → T1/T2/T3; Claude-hook stamping reuse → T4 (`event` + `stampSession`); fail-open keypress-reveal + `reveal-all` → T4 (loop) / T2 (`revealAll`); reuse phase-1 render/state/card → T4 loop calls `herald render`; box unit + isolated-tmux integration testing → T2/T3/T5; Phase-0 Hammerspoon spike gate → T6; Mac agent + ControlMaster + auto-arm → T7/T8; grid-of-splits out of scope → not built; e2e acceptance → T9. All spec sections mapped.

**Placeholder scan:** no TBD/TODO; every box step carries complete code + exact commands; Mac tasks carry complete Lua/config even though installed manually.

**Type consistency:** option keys (`@herald_armed|state|since|covered|live_win`), `CARD_WIN="_curtain"`, `COVERABLE={working,done,needs}`, and the facade method names (`getSessOpt/setSessOpt/activeWindowId/selectWindow/newCardWindow/killWindow/windowNameOf/listArmed/sessionOf`) match across T1–T5, the loop script, and the CLI wiring. `focus`/`cover`/`reveal`/`arm`/`disarm`/`revealAll`/`stampSession` signatures are consistent between session.mjs and cli.mjs.

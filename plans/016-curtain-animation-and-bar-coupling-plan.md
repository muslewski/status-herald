# Curtain Animation + Perf Gate + Bar Coupling — Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`)
> syntax. Each task ends with an independently testable deliverable and its own
> commit. Reproduce the code in each step verbatim — do not improvise.

**Goal:** Animate DONE/COMPACTING per style (forge/minimal), make the card loop
rename-safe and cheap-when-hidden, and let the curtain drop the tmux bar's
background while covered.

**Architecture:** Themes stay plain data in `lib/curtain/themes.mjs`; the pure
renderer (`lib/surfaces/curtain-card.mjs`) gains a `settleAfter` freeze. The
per-session bash card loop (`scripts/curtain-card-session.sh`) resolves its
session dynamically and paces by visibility. `lib/curtain/session.mjs` toggles
`status-style` on cover/reveal via a save-and-restore helper.

**Tech stack:** Node ≥20 ESM, zero runtime deps, `node --test`, biome, bash.

## Global Constraints

- **Zero runtime dependencies.** Dev-only: biome, node's built-in test runner.
- **Verification (house rules):** `node --test` (= `npm test`) fully green;
  `./node_modules/.bin/biome check <changed .mjs files>` exit 0; `bash -n
  scripts/curtain-card-session.sh` passes. NEVER `npx biome` (wrong version) or
  `npm run lint` (proxy mangles output).
- **classic stays byte-identical.** Do not add frames to any `classic` state,
  and do not add frames to `minimal.working` (a test asserts it has none).
- **Worktree isolation / safety:** do NOT run any `herald curtain …` verb, touch
  tmux or live sessions, edit `~/.config` or `~/.local`, touch the Mac, or run
  the rollout (Task 4 is operator-only). Code + tests only.
- Commit after each task with the exact message given. 3 code commits.

---

## Task 1: Animated, style-flavored DONE & COMPACTING (+ settle)

**Files:**
- Modify: `lib/curtain/themes.mjs` (forge.done, forge.compacting, minimal.done, minimal.compacting)
- Modify: `lib/surfaces/curtain-card.mjs` (`pickFrame` → `settleAfter`)
- Test: `test/curtain-card.test.mjs`, `test/themes.test.mjs`

**Interfaces:**
- Produces: theme state may carry `settleAfter: <int>`. Renderer contract: a
  state with `frames` and `settleAfter` renders `frames[tick % n]` while
  `tick <= settleAfter`, then freezes on `frames[n-1]` for all larger ticks.
  States without `settleAfter` are unchanged (byte-identical).

- [ ] **Step 1: Write the failing renderer test (settle freeze)**

Add to `test/curtain-card.test.mjs`:

```js
test("settleAfter freezes an animated state on its last frame", () => {
  const theme = {
    background: "transparent",
    states: {
      done: { fg: 32, label: "DONE", frames: [["AAA"], ["BBB"], ["CCC"]], settleAfter: 3 },
    },
  };
  const at = (tick) =>
    renderCard("done", 0, 20, 8, {}, theme, tick).map(plain).join("\n");
  assert.match(at(0), /AAA/); // animating
  assert.match(at(1), /BBB/);
  assert.match(at(2), /CCC/);
  assert.match(at(3), /AAA/); // tick 3 == settleAfter -> still cycling (3 % 3)
  assert.match(at(4), /CCC/, "past settleAfter -> frozen on last frame");
  assert.match(at(50), /CCC/, "stays frozen");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test test/curtain-card.test.mjs`
Expected: FAIL at `at(4)` (no settle logic yet — currently `4 % 3 == 1` → `BBB`).

- [ ] **Step 3: Implement `settleAfter` in `pickFrame`**

In `lib/surfaces/curtain-card.mjs`, replace the current `pickFrame`:

```js
const pickFrame = (st, tick) =>
  Array.isArray(st?.frames) && st.frames.length
    ? st.frames[tick % st.frames.length]
    : null;
```

with:

```js
// Pick this tick's frame. A state may set `settleAfter`: once tick passes it,
// freeze on the last frame — so "done" can breathe a few cycles then hold calm
// without making the stateless loop stateful (tick is supplied per render).
const pickFrame = (st, tick) => {
  if (!Array.isArray(st?.frames) || !st.frames.length) return null;
  const n = st.frames.length;
  if (Number.isFinite(st.settleAfter) && tick > st.settleAfter)
    return st.frames[n - 1];
  return st.frames[tick % n];
};
```

- [ ] **Step 4: Run it, verify it passes**

Run: `node --test test/curtain-card.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing theme-content tests**

Add to `test/curtain-card.test.mjs`:

```js
test("forge DONE animates sparks then settles on the clean piece", () => {
  const sparks = renderCard("done", 0, 24, 8, {}, BUILTINS.forge, 0)
    .map(plain)
    .join("\n");
  assert.match(sparks, /\* ✓ \*/, "tick 0 shows sparks over the anvil");
  assert.match(sparks, /=======/, "keeps the anvil");
  const settled = renderCard("done", 0, 24, 8, {}, BUILTINS.forge, 99)
    .map(plain)
    .join("\n");
  assert.doesNotMatch(settled, /\*/, "settled frame has no sparks");
  assert.match(settled, /✓/);
});

test("forge COMPACTING squeezes inward and loops (no settle)", () => {
  const at = (t) =>
    renderCard("compacting", 0, 24, 8, {}, BUILTINS.forge, t).map(plain).join("\n");
  assert.match(at(0), /# # #/, "widest at tick 0");
  assert.match(at(2), /»#«/, "tightest mid-cycle");
  assert.match(at(4), /# # #/, "loops back — compacting never freezes");
});

test("minimal DONE blinks a smile then settles", () => {
  const at = (t) =>
    renderCard("done", 0, 24, 8, {}, BUILTINS.minimal, t).map(plain).join("\n");
  assert.match(at(0), /\^o\^/);
  assert.match(at(99), /\^_\^/, "settles on the calm smile");
});

test("minimal COMPACTING collapses dots to the center", () => {
  const at = (t) =>
    renderCard("compacting", 0, 24, 8, {}, BUILTINS.minimal, t).map(plain).join("\n");
  assert.match(at(0), /· · · · ·/);
  assert.match(at(2), /···/);
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `node --test test/curtain-card.test.mjs`
Expected: FAIL (forge.done is still `✓ ✓ ✓`, minimal.done is a static `✅`).

- [ ] **Step 7: Author the frames in `lib/curtain/themes.mjs`**

In `BUILTINS.forge.states`, replace the `compacting` and `done` entries:

```js
      compacting: {
        fg: "cyan",
        label: "COMPACTING",
        // Jaws squeeze the stock to center, then breathe back out (loops).
        frames: [["» # # # «"], ["» ### «"], ["»#«"], ["» ### «"]],
      },
      done: {
        fg: "brightGreen",
        label: "DONE",
        // Struck piece cooling on the anvil: sparks fade to a clean ✓, then hold.
        frames: [
          [" * ✓ *", "======="],
          [" · ✓ ·", "======="],
          ["   ✓   ", "======="],
        ],
        settleAfter: 6,
      },
```

In `BUILTINS.minimal.states`, replace the `compacting` and `done` entries:

```js
      compacting: {
        fg: "cyan",
        label: "COMPACTING",
        frames: [["· · · · ·"], ["· ··· ·"], ["···"], ["· ··· ·"]],
      },
      done: {
        fg: "brightGreen",
        label: "DONE",
        frames: [["^o^"], ["^_^"]],
        settleAfter: 6,
      },
```

Leave `minimal.working`, `minimal.needs`, `minimal.idle`, and all of `classic`
untouched.

- [ ] **Step 8: Add theme-shape assertions to `test/themes.test.mjs`**

Append:

```js
test("forge done and compacting are animated with a settle on done", () => {
  assert.ok(BUILTINS.forge.states.done.frames.length >= 2);
  assert.equal(BUILTINS.forge.states.done.settleAfter, 6);
  assert.ok(BUILTINS.forge.states.compacting.frames.length >= 2);
  assert.equal(BUILTINS.forge.states.compacting.settleAfter, undefined);
});

test("minimal gains animated done/compacting but keeps working static", () => {
  assert.ok(BUILTINS.minimal.states.done.frames.length >= 2);
  assert.ok(!BUILTINS.minimal.states.working.frames);
  assert.equal(isAnimated(BUILTINS.minimal), true);
});
```

- [ ] **Step 9: Run the full suite + lint**

Run: `node --test` then `./node_modules/.bin/biome check lib/curtain/themes.mjs lib/surfaces/curtain-card.mjs test/curtain-card.test.mjs test/themes.test.mjs`
Expected: all green, biome exit 0. (Existing `themes.test.mjs:57-61` "minimal is
transparent glyph/label" still passes — `minimal.done.label` is still `"DONE"`
and `minimal.working.frames` is still absent.)

- [ ] **Step 10: Commit**

```bash
git add lib/curtain/themes.mjs lib/surfaces/curtain-card.mjs test/curtain-card.test.mjs test/themes.test.mjs
git commit -m "feat(curtain): animated style-flavored done/compacting with settle"
```

---

## Task 2: Card-loop hardening — rename-safety + perf gate + traps

**Files:**
- Modify: `scripts/curtain-card-session.sh` (full rewrite below)
- Test: `test/curtain-card-session.test.mjs` (new — file-invariant guards)

**Interfaces:**
- Consumes: `@herald_covered` (already written by `session.mjs`), all other
  `@herald_*` session options.
- Produces: the loop never targets a cached session name; it paces fast only
  when `@herald_covered == "1"`; it reveals on EXIT/INT/TERM/HUP.

- [ ] **Step 1: Write the failing invariant test**

Create `test/curtain-card-session.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = readFileSync(
  fileURLToPath(new URL("../scripts/curtain-card-session.sh", import.meta.url)),
  "utf8",
);

test("card loop reads options from the current session, never a cached -t name", () => {
  // A cached `-t "$sess"` target is exactly the rename bug (Why #4): after a
  // `prefix + $` rename the old name resolves to nothing and the card falls to
  // classic-idle. The dump must be untargeted (current session).
  assert.doesNotMatch(script, /show-options\s+-t/, "no cached -t target");
  assert.match(script, /tmux show-options/, "still dumps options");
});

test("card loop paces fast only while covered", () => {
  assert.match(script, /@herald_covered/, "reads the covered flag");
  assert.match(script, /covered.*=.*1/, "branches on covered == 1");
});

test("card loop reveals (restoring the bar) on exit/signal", () => {
  assert.match(script, /trap .* EXIT/, "has an exit/signal trap");
  assert.match(script, /curtain reveal/, "trap path reveals");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test test/curtain-card-session.test.mjs`
Expected: FAIL (current script uses `show-options -t "$sess"`, no covered
branch, no trap).

- [ ] **Step 3: Rewrite `scripts/curtain-card-session.sh`**

Replace the entire file with:

```bash
#!/usr/bin/env bash
# Runs inside a session's _curtain window. Repaints the card from THIS session's
# @herald_* options. Any keypress reveals the session (fail-open). Never exits.
#
# The session is resolved DYNAMICALLY every tick (no cached name): `show-options`
# with no -t reads the card pane's own session, so a `prefix + $` rename is
# transparent — the old name can never strand the card on the classic-idle
# fallback, and reveal always targets the live name.
set -u
printf '\033[?25l'
# On any exit/signal, reveal — which (when tmuxBar coupling is on) restores the
# status bar, so a killed loop can't strand the dropped background.
trap 'herald curtain reveal "$(tmux display -p "#{session_name}" 2>/dev/null)" >/dev/null 2>&1 || true' EXIT INT TERM HUP
tick=0
while :; do
  # One untargeted call dumps every option this repaint needs from the current
  # session. @herald_* values are single tokens, so `read -r k v` is safe.
  opts=$(tmux show-options 2>/dev/null)
  unset O
  declare -A O
  while IFS=' ' read -r k v; do
    [ -n "$k" ] && O["$k"]="$v"
  done <<<"$opts"
  state=${O[@herald_state]:-idle}
  since=${O[@herald_since]:-0}
  subs=${O[@herald_bg_subagents]:-0}
  shells=${O[@herald_bg_shells]:-0}
  worked=${O[@herald_worked]:-0}
  theme=${O[@herald_theme]:-classic}
  frame_ms=${O[@herald_frame_ms]:-1000}
  covered=${O[@herald_covered]:-0}
  cols=$(tput cols 2>/dev/null || echo 80)
  rows=$(tput lines 2>/dev/null || echo 24)
  herald render --surface curtain-card \
    --state "${state:-idle}" --since "${since:-0}" \
    --subagents "${subs:-0}" --shells "${shells:-0}" \
    --worked "${worked:-0}" \
    --theme "${theme:-classic}" --tick "$tick" \
    --cols "$cols" --rows "$rows" --color always 2>/dev/null || true
  tick=$((tick + 1))
  # Pace: the theme's hot rate (frame_ms) ONLY while covered/visible; otherwise
  # 1 s, so an animated theme on a revealed/detached session is not repainted
  # 2x/sec for a card nobody is looking at.
  if [ "$covered" = "1" ]; then ms=${frame_ms:-1000}; else ms=1000; fi
  case "$ms" in
    "" | *[!0-9]*) secs=1 ;;
    *) secs=$(awk "BEGIN{printf \"%.3f\", $ms/1000}" 2>/dev/null || echo 1) ;;
  esac
  if read -rsn1 -t "$secs" 2>/dev/null; then
    herald curtain reveal "$(tmux display -p '#{session_name}' 2>/dev/null)" >/dev/null 2>&1 || true
  fi
done
```

- [ ] **Step 4: Run tests + shell syntax**

Run: `node --test test/curtain-card-session.test.mjs` then `bash -n scripts/curtain-card-session.sh`
Expected: PASS, and `bash -n` exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/curtain-card-session.sh test/curtain-card-session.test.mjs
git commit -m "fix(curtain): rename-safe card loop; pace fast only when covered; reveal on signal"
```

---

## Task 3: tmux-bar transparent coupling

**Files:**
- Modify: `lib/config.mjs` (`DEFAULTS.curtain.tmuxBar`)
- Modify: `lib/curtain/session.mjs` (`applyBar` + thread `cfg` through cover/reveal paths)
- Test: `test/config.test.mjs`, `test/session.test.mjs`

**Interfaces:**
- Consumes: `cfg.tmuxBar.whenCovered` (`"keep"` default | `"transparent"`).
- Produces: on cover in `transparent` mode, saves `@herald_prev_status_style` +
  `@herald_bar_saved="1"` and sets `status-style` to `"<prev>,bg=default"`; on
  reveal, restores the exact prior value (or unsets if there was none). `"keep"`
  issues zero `status-style` calls.

- [ ] **Step 1: Write the failing config default test**

Add to `test/config.test.mjs`:

```js
test("curtain.tmuxBar defaults to keep (no bar change)", () => {
  assert.equal(DEFAULTS.curtain.tmuxBar.whenCovered, "keep");
});

test("a user can override tmuxBar.whenCovered to transparent", () => {
  const cfg = merge(DEFAULTS, {
    curtain: { tmuxBar: { whenCovered: "transparent" } },
  });
  assert.equal(cfg.curtain.tmuxBar.whenCovered, "transparent");
});
```

(Ensure `DEFAULTS` and `merge` are imported at the top of the file — they come
from `../lib/config.mjs`.)

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test test/config.test.mjs`
Expected: FAIL (`DEFAULTS.curtain.tmuxBar` is undefined).

- [ ] **Step 3: Add the config default**

In `lib/config.mjs`, inside `DEFAULTS.curtain`, add after `animation`:

```js
    animation: { fps: 2 },
    // While a session is covered, optionally restyle its tmux status bar.
    // "keep" = no change (default). "transparent" = drop the bar's background
    // (status-style bg=default), restored exactly on reveal.
    tmuxBar: { whenCovered: "keep" },
```

- [ ] **Step 4: Run it, verify it passes**

Run: `node --test test/config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing session tests**

Add to `test/session.test.mjs`:

```js
const transparent = { tmuxBar: { whenCovered: "transparent" } };

test("cover in transparent mode drops the bar bg and saves the exact prior style", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt("s1", "status-style", "bg=colour234,fg=white");
  cover("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=colour234,fg=white,bg=default");
  assert.equal(t.getSessOpt("s1", "@herald_prev_status_style"), "bg=colour234,fg=white");
  assert.equal(t.getSessOpt("s1", "@herald_bar_saved"), "1");
});

test("reveal restores the exact prior status-style", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "working");
  t.setSessOpt("s1", "status-style", "bg=colour234,fg=white");
  cover("s1", t, transparent);
  reveal("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=colour234,fg=white");
  assert.equal(t.getSessOpt("s1", "@herald_bar_saved"), "");
});

test("with no prior status-style, reveal unsets it (back to inheritance)", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=default");
  reveal("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "", "unset, not stranded");
});

test("keep mode never touches status-style", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "working");
  cover("s1", t, {}); // default keep
  assert.equal(t.getSessOpt("s1", "status-style"), "");
  assert.equal(t.getSessOpt("s1", "@herald_bar_saved"), "");
});

test("revealAll and disarm restore the bar", () => {
  const t = makeT(freshSession());
  arm("s1", t, {});
  t.setSessOpt("s1", "@herald_state", "done");
  t.setSessOpt("s1", "status-style", "bg=colour234");
  cover("s1", t, transparent);
  revealAll(t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=colour234");

  cover("s1", t, transparent);
  disarm("s1", t, transparent);
  assert.equal(t.getSessOpt("s1", "status-style"), "bg=colour234");
});

test("focus covers the non-matching session with the bar dropped", () => {
  const t = makeT(twoArmed());
  t.setSessOpt("s2", "status-style", "bg=colour234");
  focus("Syndcast Backlog", t, transparent); // reveals s1, covers s2
  assert.equal(t.getSessOpt("s2", "status-style"), "bg=colour234,bg=default");
  assert.equal(t.getSessOpt("s1", "@herald_bar_saved"), "", "revealed s1 has no drop");
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `node --test test/session.test.mjs`
Expected: FAIL (`applyBar` doesn't exist; cover/reveal ignore `cfg`).

- [ ] **Step 7: Implement `applyBar` and thread `cfg`**

In `lib/curtain/session.mjs`, add the helper near the top (after imports):

```js
// Drop or restore the tmux status bar's background while a session is covered,
// per curtain.tmuxBar.whenCovered. Save-and-restore the EXACT prior status-style
// (never `set -u`, which would restore to global inheritance and lose a
// per-session bar). Idempotent via @herald_bar_saved, so repeated covers/reveals
// and the loop's crash trap are all safe.
const applyBar = (sess, covered, t, cfg) => {
  if ((cfg?.tmuxBar?.whenCovered || "keep") !== "transparent") return;
  if (covered) {
    if (t.getSessOpt(sess, "@herald_bar_saved") === "1") return;
    const prev = t.getSessOpt(sess, "status-style");
    t.setSessOpt(sess, "@herald_prev_status_style", prev);
    t.setSessOpt(sess, "@herald_bar_saved", "1");
    // Later tokens win in a tmux style string, so appending bg=default overrides
    // only the background and preserves the user's fg/attrs.
    t.setSessOpt(sess, "status-style", prev ? `${prev},bg=default` : "bg=default");
  } else {
    if (t.getSessOpt(sess, "@herald_bar_saved") !== "1") return;
    const prev = t.getSessOpt(sess, "@herald_prev_status_style");
    if (prev) t.setSessOpt(sess, "status-style", prev);
    else t.unsetSessOpt(sess, "status-style");
    t.unsetSessOpt(sess, "@herald_prev_status_style");
    t.unsetSessOpt(sess, "@herald_bar_saved");
  }
};
```

Thread `cfg` through every cover/reveal path. Update the signatures and bodies:

`cover` — add `cfg` param and the applyBar call:
```js
export const cover = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") === "1") return;
  if (!COVERABLE.has(t.getSessOpt(sess, "@herald_state"))) return;
  if (t.windowNameOf(t.activeWindowId(sess)) !== CARD_WIN)
    t.setSessOpt(sess, "@herald_live_win", t.activeWindowId(sess));
  t.selectWindow(`${sess}:${CARD_WIN}`);
  t.setSessOpt(sess, "@herald_covered", "1");
  applyBar(sess, true, t, cfg);
};
```

`reveal`:
```js
export const reveal = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") !== "1") return;
  const live = t.getSessOpt(sess, "@herald_live_win");
  if (live) t.selectWindow(live);
  t.setSessOpt(sess, "@herald_covered", "0");
  applyBar(sess, false, t, cfg);
};
```

`revealAll`:
```js
export const revealAll = (t = realTmux, cfg = loadConfig().curtain) => {
  for (const s of t.listArmed()) reveal(s.name, t, cfg);
};
```

`revealFrom` and `coverFrom` — add `cfg` and the applyBar calls:
```js
const revealFrom = (s, t, cfg) => {
  if (!s.covered) return;
  if (s.liveWin) t.selectWindow(s.liveWin);
  t.setSessOpt(s.name, "@herald_covered", "0");
  applyBar(s.name, false, t, cfg);
};

const coverFrom = (s, t, names, cfg) => {
  if (s.covered) return;
  if (!COVERABLE.has(s.state)) return;
  if (names[s.activeWin] !== CARD_WIN)
    t.setSessOpt(s.name, "@herald_live_win", s.activeWin);
  t.selectWindow(`${s.name}:${CARD_WIN}`);
  t.setSessOpt(s.name, "@herald_covered", "1");
  applyBar(s.name, true, t, cfg);
};
```

`focus` — load cfg once and pass it down both paths:
```js
export const focus = (title, t = realTmux, cfg = loadConfig().curtain) => {
  if (
    typeof t.snapshotArmed === "function" &&
    typeof t.windowNames === "function"
  ) {
    const names = t.windowNames();
    for (const s of t.snapshotArmed()) {
      const liveName = names[s.liveWin] ?? "";
      if (title && liveName === title) revealFrom(s, t, cfg);
      else coverFrom(s, t, names, cfg);
    }
    return;
  }
  for (const s of t.listArmed()) {
    const label = t.windowNameOf(s.liveWin);
    if (title && label === title) reveal(s.name, t, cfg);
    else cover(s.name, t, cfg);
  }
};
```

`disarm` — thread cfg into its reveal:
```js
export const disarm = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  reveal(sess, t, cfg);
  t.killWindow(`${sess}:${CARD_WIN}`);
  t.unsetSessOpt(sess, "set-titles-string");
  t.unsetSessOpt(sess, "set-titles");
  t.setSessOpt(sess, "@herald_armed", "0");
};
```

- [ ] **Step 8: Run it, verify it passes**

Run: `node --test test/session.test.mjs`
Expected: PASS (the pre-existing cover/reveal/focus/disarm tests still pass —
they pass no `cfg`, so it defaults to the real config, whose `tmuxBar` is `keep`
→ `applyBar` is a no-op and touches no `status-style`).

- [ ] **Step 9: Full suite + lint + shell syntax**

Run: `node --test` then `./node_modules/.bin/biome check lib/config.mjs lib/curtain/session.mjs test/config.test.mjs test/session.test.mjs` then `bash -n scripts/curtain-card-session.sh`
Expected: all green, biome exit 0, bash -n exit 0. Suite grew by ~10 tests.

- [ ] **Step 10: Update the README (docs)**

In `README.md`, document `curtain.tmuxBar.whenCovered` (`keep` | `transparent`)
alongside the other `curtain.*` config keys, one sentence: "while a session is
covered, `transparent` drops the tmux status bar's background and restores it on
reveal." (Match the surrounding table/prose style; do not restructure the file.)

- [ ] **Step 11: Commit**

```bash
git add lib/config.mjs lib/curtain/session.mjs test/config.test.mjs test/session.test.mjs README.md
git commit -m "feat(curtain): transparent tmux-bar coupling on cover (save/restore)"
```

---

## Task 4: Operator rollout (GATED — operator only, not the executor)

Not a code task. After the branch merges, the operator runs this; the executor
must STOP after Task 3.

- Back up `~/.config/status-herald/config.json`.
- Set `curtain.tmuxBar.whenCovered = "transparent"` and forge fleet-wide
  (`curtain.theme = "forge"` or `curtain.themeBySession = {"*": "forge"}`).
- `herald curtain refresh` (re-stamp `@herald_theme` / `@herald_frame_ms` and
  respawn card windows with the new loop).
- Integration checklist (from the spec's Done criteria): no idle 2 fps on
  revealed sessions (`ps`/CPU); DONE animates then settles; COMPACTING animates;
  tab-switch drops+restores the bar background per-session; rename a covered
  session → card keeps its real state/theme and keypress still reveals; kill a
  card loop while covered → trap reveals + restores the bar; two sessions →
  per-session, not global; fail-open keypress still reveals.

---

## Self-Review

- **Spec coverage:** Why #1 → Task 1; #2 (perf) → Task 2b; #3 (bar) → Task 3;
  #4 (rename) → Task 2a; forge-on-all → Task 4 rollout. All covered.
- **No placeholders:** every code step shows complete code.
- **Type/name consistency:** `settleAfter` (Task 1) is read only in `pickFrame`;
  `applyBar(sess, covered, t, cfg)` signature is consistent across all call
  sites; `cfg` threads through cover/reveal/coverFrom/revealFrom/revealAll/
  focus/disarm uniformly; option names `@herald_prev_status_style` /
  `@herald_bar_saved` match between `applyBar` and the tests.
- **Backcompat:** classic untouched; `minimal.working` keeps no frames
  (themes.test:60 holds); existing session tests pass no `cfg` → keep-mode no-op.
```

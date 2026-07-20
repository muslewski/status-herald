# Plan 016 — Curtain state-animation polish + visible-only perf gate + curtain↔tmux-bar coupling

**Status:** SPEC (design). Depends on 013, 014. Successor to 015.

**One-liner:** Make DONE and COMPACTING animate with style-appropriate art
(forge/minimal), gate fast repaints to the *covered* card so an animated theme
can run on the whole fleet cheaply, and let the curtain drop the tmux bar's
background while it is up.

---

## Why

Three complaints, one subsystem.

1. **DONE reads as a dead emoji.** Only `working` animates today —
   `isAnimated()` fires only when a state has more than one frame, and every
   theme's `done` is a single frame (classic/minimal `✅`, forge `✓ ✓ ✓`). So a
   session that just finished a long turn shows a lively hammer while running
   and then a flat glyph when done. The operator's ask: keep *working* playful,
   make *done* and *compacting* feel finished and professional, **as a
   convention per style** (each theme expresses "done" in its own idiom, not one
   universal emoji).

2. **An animated theme can't go fleet-wide without a node-spawn storm.** The
   card loop (`scripts/curtain-card-session.sh`) spawns a fresh `herald render`
   node process every tick, and the tick rate is chosen from the *theme*
   (`stampTheme`: animated → 2 fps, static → 1 fps) — **not** from whether the
   card is visible. An animated theme therefore forks node ~2×/s per session
   forever, even for a revealed or detached session whose card nobody is
   looking at. Across the operator's ~14 sessions that is the load behind the
   reveal latency, and it is why "put forge on everything" was unsafe.

3. **The tmux bar's background fights the curtain.** herald does not render the
   bar (it is the operator's `~/.tmux.conf` status line), but its solid
   background clashes with the transparent forge/minimal card. The operator
   wants the curtain to drop the bar's background while covered and restore it
   on reveal — configurably.

4. **Renaming a session breaks its card** (`prefix + $`). After a rename the
   card stops animating and shows a gray `—` line — the classic-idle fallback.
   Root cause (`scripts/curtain-card-session.sh:5`): the loop captures the
   session *name* once at startup (`sess=$(tmux display -p '#{session_name}')`)
   then targets `show-options -t "$sess"` every tick. A rename changes the name,
   so `-t "$oldname"` matches nothing, `opts` is empty, and every value falls to
   its default — `state=idle`, `theme=classic`, `frame_ms=1000`. Line 44's
   `herald curtain reveal "$sess"` uses the same stale name, so the
   keypress fail-open is also dead → a renamed covered session is stuck behind
   the card. The card must key off something rename-stable.

Not in this plan: making the tmux/Claude bars *responsive* (priority-based
truncation as width shrinks). Those bars are Python today
(`~/.claude/statusline-context.py`, `~/.claude/session-sync.py`) and unifying
them into herald is a separate initiative — **Slice 2** (own brainstorm/spec).

## Current state (verified anchors)

- `lib/curtain/themes.mjs` — `BUILTINS`: `classic` (solid black), `minimal`
  (transparent), `forge` (transparent, animated). Each state → `{fg, glyph,
  label, frames?}`. forge: working = 3-frame hammer/anvil, compacting = 2-frame
  `( ⟳ )/( ⟲ )`, **done = single static `✓ ✓ ✓`**. `isAnimated(theme)` = any
  state has `frames.length > 1`.
- `lib/surfaces/curtain-card.mjs` — `renderCard(state, elapsedSec, cols, rows,
  bg, theme, tick)`; `pickFrame(st, tick)` = `st.frames[tick % n]` when frames
  exist, else glyph+label. classic path is byte-identical to the pre-theme look
  (stated backcompat invariant).
- `lib/curtain/session.mjs` — `stampTheme` writes `@herald_theme` and
  `@herald_frame_ms = animated ? round(1000/fps) : 1000`, keyed on the theme.
  Cover/reveal call sites: `cover`, `reveal`, `coverFrom`/`revealFrom` (the
  batched `focus()` hot path), `revealAll` (panic), `disarm`.
- `scripts/curtain-card-session.sh` — one `tmux show-options` dumps all
  `@herald_*`; spawns `herald render --surface curtain-card … --tick N`; paces
  `read -rsn1 -t $secs` where `secs = @herald_frame_ms/1000`; a keypress reveals
  (fail-open).
- `lib/config.mjs` — `DEFAULTS.curtain` holds `theme`, `themeBySession`,
  `themes`, `animation.fps`. (Side note, out of scope: `coverableStates`
  default exists but the cover gate uses a hardcoded `COVERABLE` set that also
  includes `compacting` — the config key is currently dead.)
- Bars are **not** herald: Claude statusline = `statusline-context.py`; tmux bar
  = `status-right = '#{?@ctxbar,#{@ctxbar}  ,}#(python3 session-sync.py)  %H:%M'`
  (`@ctxbar` per-window context slider written by `session-sync.py`).

---

## Design

Three independently-reviewable tasks + an operator rollout.

### Task 1 — Animated, style-flavored DONE & COMPACTING (with settle)

Author multi-frame `frames` for `done` and `compacting` on **forge** and
**minimal** only. Leave **classic** byte-identical (no frames added).

Add one schema field, `settleAfter` (integer ticks), honored in the renderer:
a state with `frames` and `settleAfter` renders `frames[tick % n]` while
`tick <= settleAfter`, then freezes on the **last** frame for all larger ticks.
This gives "done breathes a few cycles, then holds calm" without making the
stateless loop stateful — the renderer already receives `--tick`. States
without `settleAfter` (all existing ones) are unaffected → byte-identical.

Frames (centered by the existing `marginFrame`; forge keeps its `# = * | + -`
palette and the anvil motif for visual continuity with `working`):

- **forge.done** — "spark settle" over the anvil; freezes on the clean piece:
  ```
  frames: [[" * ✓ *","======="],
           [" · ✓ ·","======="],
           ["   ✓   ","======="]]   settleAfter: 6   // ~3s then holds "✓ / ==="
  ```
- **forge.compacting** — "press" (jaws squeeze the stock inward, then breathe
  back out); loops, no settle:
  ```
  frames: [["» # # # «"],["» ### «"],["»#«"],["» ### «"]]
  ```
- **minimal.done** — "smile blink" (the operator's smile/thumbs idea, clean
  ASCII, no emoji-width risk); freezes on the calm smile:
  ```
  frames: [["^o^"],["^_^"]]   settleAfter: 6
  ```
- **minimal.compacting** — "dot collapse"; loops:
  ```
  frames: [["· · · · ·"],["· ··· ·"],["···"],["· ··· ·"]]
  ```

`infoLines` (herald-owned dynamic text) is unchanged: done still shows
`worked m:ss` + `focus to open …`, compacting still shows `compressing context…`.

**Tests:** frame-by-tick selection for each new set; `settleAfter` freeze
(tick 0..n animates, tick > settleAfter == last frame); classic done/compacting
still byte-identical; `isAnimated(forge)` stays true.

### Task 2 — Card-loop hardening: rename-safety + perf gate + traps

All three edits land in `scripts/curtain-card-session.sh` (one file → one task,
no cross-executor conflict).

**2a. Rename-safe session resolution (correctness — fixes Why #4).** Stop
caching the session name. Drop the `-t "$sess"` target and let
`tmux show-options` resolve to the card pane's own session (rename-proof, since
the loop runs inside that session), and re-resolve the name fresh for the reveal
call:

```
opts=$(tmux show-options 2>/dev/null)                 # no -t: current (card pane's) session
...
herald curtain reveal "$(tmux display -p '#{session_name}')" >/dev/null 2>&1 || true
```

(Equivalent alternative: re-run `sess=$(tmux display -p '#{session_name}')` at
the top of each iteration. Either way the name is never stale.)

**2b. Perf gate — fast tick only for the covered card.** The loop already dumps
every `@herald_*` each tick — read `@herald_covered` from that same dump and
choose the pace:

```
covered=${O[@herald_covered]:-0}
if [ "$covered" = "1" ]; then secs = frame_ms/1000; else secs = 1.0; fi
```

Covered card → its theme's hot rate (2 fps for animated); every revealed or
detached card → 1 fps (identical to today's static cadence — **no regression**,
and the stale-frame-on-cover window is ≤1 s, the same as static repaint today).
`stampTheme` keeps writing `@herald_frame_ms` as the *hot* rate; the loop now
decides hot-vs-idle by visibility. Result: an animated theme costs ~1 fps per
non-covered session (like static) and 2 fps only on the single covered card —
so **forge-on-all ≈ today's steady-state spawn rate**, not double it.

**2c. Signal traps (crash safety for Task 3's bar restore).** Add
`trap 'herald curtain reveal "$(tmux display -p "#{session_name}")" 2>/dev/null'
EXIT INT TERM HUP` so a killed loop reveals — which (with Task 3) restores the
bar, so a crash-while-covered can't strand the bar's dropped background.

Deferred to a v2 (documented, not built): a fifo/wake channel so cover forces
an immediate fresh frame (kills the ≤1 s stale window), and a persistent
renderer to eliminate per-tick node spawns entirely.

**Tests:** `bash -n` on the loop; assert (grep) the loop no longer targets a
cached `-t "$sess"` for the option dump, reads `@herald_covered`, and branches
the pace. (Timing + live rename are validated at rollout — the bash loop has no
unit harness today; keep that parity.)

### Task 3 — tmux-bar coupling (transparent, save-and-restore)

New config, default off:

```js
// DEFAULTS.curtain
tmuxBar: { whenCovered: "keep" }   // "keep" (default, no-op) | "transparent"
```

`"transparent"` = while covered, drop the bar's background but keep its content
and foreground; restore the exact prior value on reveal. Mechanism (session
option, per-session — verified: `status-style` is a session option, so this
does not leak to other sessions; **`status off` is deliberately NOT used** — it
changes pane geometry and SIGWINCH-reflows editors/pagers on every tab switch):

- **On cover** (`cover`, `coverFrom`): if mode ≠ keep and not already applied:
  save `prev = getSessOpt(sess, "status-style")` into `@herald_prev_status_style`,
  set `@herald_bar_saved = 1`, then set
  `status-style = prev ? "${prev},bg=default" : "bg=default"` (later style
  tokens win, so appending `bg=default` overrides only the background).
- **On reveal** (`reveal`, `revealFrom`, `revealAll`, `disarm`): if
  `@herald_bar_saved = 1`: restore — `prev` empty ⇒ `unsetSessOpt status-style`
  (back to global inheritance), else `setSessOpt status-style prev` (exact
  string). Clear `@herald_bar_saved`.
- **Crash safety:** the loop's signal traps (Task 2c) call `herald curtain
  reveal` on EXIT/INT/TERM/HUP; because reveal runs `applyBar(sess, false)`, a
  killed loop restores the bar and cannot strand the dropped background.

`applyBar(sess, covered, t, cfg)` is a pure-ish helper in `session.mjs` taking
the injectable tmux double, called from every cover/reveal path.

**Tests** (existing tmux double): cover in `transparent` saves prev + appends
`bg=default`; reveal restores the exact prior string; empty-prev reveal unsets;
`keep` mode issues zero status-style calls; `revealAll`/`disarm` restore.

### Rollout (operator-gated — not a code task, mirrors 015 Task 7)

After merge: `herald curtain refresh` (re-stamp). Then, in the operator's
`~/.config/status-herald/config.json` (backed up first):
`curtain.tmuxBar.whenCovered = "transparent"` and forge-on-all via
`curtain.theme = "forge"` (or `themeBySession: {"*": "forge"}`); `herald curtain
refresh`. Reversible (config + refresh). Then run the integration checklist
under **Done criteria**.

---

## Design decisions (so nobody re-litigates)

- **Transparent-only bar coupling, never `status off`.** on/off changes
  geometry → reflow on every tab switch (Grok consult, verified against tmux
  behavior). `status-style` is a real session option, so per-session styling is
  correct and isolated.
- **Save-and-restore the exact prior `status-style`, not `set -u`.** `set -u`
  restores to *global inheritance*, which can differ from a session's local
  customization; save the exact string + traps for crash safety.
- **Perf gate keys off `@herald_covered`; idle = 1 fps.** Free (the loop
  already dumps all options), no regression vs today's static cadence, and it
  decouples "animated theme" from "always hot" so the fleet can go animated.
- **Card loop never caches the session name.** It resolves its session
  dynamically each tick (`show-options` with no `-t`), so a `prefix + $` rename
  can't strand the card on classic-idle or kill its reveal path.
- **`settleAfter` freeze for done**, computed from the `--tick` the renderer
  already gets — keeps the loop stateless and "done" calm rather than busy.
- **classic stays byte-identical.** Honors "configure nothing → no change"; new
  users opt into an animated theme. Only forge/minimal gain animated done/compacting.
- **forge-on-all is operator config + refresh, not a code default change.** The
  OSS default stays `classic`; the operator sets forge in their own config.

## Alternatives rejected

- **`status off` hide-mode** — geometry reflow; deferred as a research spike
  (needs multi-client + crash tests before it can be a config option).
- **`set -u` restore** — imprecise; replaced by save-and-restore + traps.
- **Persistent renderer / fifo-wake now** — the real fix for per-tick node
  spawns and the stale-on-cover window, but larger; the visibility gate gets
  most of the win cheaply. Tracked as v2.
- **Animate classic** — breaks the byte-identical invariant.
- **One universal thumbs-up/smile done** — loses each theme's character; the
  operator chose style-flavored.

## Test plan

`node --test` green (suite grows), `./node_modules/.bin/biome check <changed
.mjs>` exit 0, `bash -n scripts/curtain-card-session.sh`. New tests land in
`test/curtain-card.test.mjs` (frames + settle), `test/config.test.mjs`
(`tmuxBar` default), `test/session.test.mjs` (bar apply/restore across all
paths; keep = no-op). classic byte-identical assertions stay green.

## Done criteria

- forge/minimal DONE and COMPACTING animate; DONE breathes then settles;
  classic byte-identical.
- Revealed/detached cards repaint at 1 fps; only the covered card runs at
  `frame_ms` — verified no idle 2 fps via CPU/`ps` after forge-on-all.
- `tmuxBar.whenCovered="transparent"`: covered session's bar loses its
  background and restores the exact prior style on reveal, across
  cover/reveal/coverFrom/revealFrom/revealAll/disarm; `keep` = zero change.
- Kill the card loop while covered → trap reveals + restores the bar (no
  stranded background).
- Two sessions: the bar change is per-session, not global.
- **Rename a covered/armed session (`prefix + $`) → the card keeps rendering
  its real state + theme (no gray-idle fallback) and the keypress reveal still
  works.**
- Fail-open keypress still reveals.
- All gates green.

## Rollout / safety

Non-destructive: only `@herald_*` session options and `status-style` are
toggled (both reversible); no tmux session/window is killed except the hidden
`_curtain` on `refresh`. Back up config before editing. Operator runs the
rollout; the executor does not.

## STOP conditions

- Executor: worktree-isolated; do **not** run any `herald curtain …` verb,
  touch tmux/live sessions, edit `~/.config` or `~/.local`, touch the Mac, or
  run the rollout. Code + tests only.
- If per-session `status-style` leaks globally on the operator's tmux version,
  or any reflow/flicker appears even with style-only → STOP the bar coupling,
  leave the default `keep`.

## Maintenance notes

- `coverableStates` config is dead (hardcoded `COVERABLE` wins) — flagged, not
  fixed here.
- v2 latency track: persistent renderer + fifo wake.
- Slice 2 (separate): responsive tmux/Claude bars — build herald bar surfaces
  with a segment/priority model, then retire `statusline-context.py` /
  `session-sync.py`.

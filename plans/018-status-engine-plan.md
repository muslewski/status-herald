# Plan 018: Status engine (segment registry + render modes + priority width-drop)

> **For the executor:** REQUIRED — TDD. Write the failing test, run it red,
> implement minimal, run green, commit. Steps use `- [ ]`. This is sub-plan 1
> of the Slice 2 program (`plans/017-herald-native-bars.md`). It builds the
> PURE engine only — no session/tmux/process I/O, no live effects. Later
> sub-plans (019 compute, 020 surfaces) supply data and wire it in.

**Goal:** A pure, hermetic status-bar engine: a segment registry, semantic
role→color mapping for three render modes (`tmux`/`ansi`/`plain`), gauge
thresholds, and a deterministic priority-based width-drop.

**Architecture:** One new module `lib/status/segments.mjs` + small additions to
`lib/render.mjs`. No filesystem, no `child_process`, no tmux, no Date. Every
function takes its inputs as arguments and returns a value. Fully unit-testable.

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, biome.

## Global Constraints (from Plan 017)

- **Zero runtime dependencies.** No imports outside `node:*` and repo-local.
- **Verify:** `node --test` and `./node_modules/.bin/biome check lib/status/segments.mjs lib/render.mjs test/status-segments.test.mjs`. NEVER `npx biome`, NEVER `npm run lint`.
- **Fail-open discipline** applies to render *paths* (later plans); this engine
  is pure — invalid input returns a safe empty/undefined result, never throws.
- Pure only: **no** `Date.now()`, `process`, `fs`, `child_process`, `execFile`,
  tmux. If you need "now", it is a function argument.

## Files

- Create: `lib/status/segments.mjs`
- Modify: `lib/render.mjs` (add `tmuxColor`, reuse `visibleWidth`)
- Test: `test/status-segments.test.mjs`

## Interfaces this plan PRODUCES (later plans consume these exact names)

```js
// lib/render.mjs (add)
// tmux-format color wrapper: tmuxColor("hi", "colour46") -> "#[fg=colour46]hi#[default]"
export const tmuxColor = (text, tmuxColorName) => string;
// visibleWidth (already exists) must also strip tmux #[...] markup, not only ANSI SGR.

// lib/status/segments.mjs
export const ROLES;                 // { ok, notice, warn, crit, accent, dim } -> { ansi, tmux }
export const roleColor = (role, mode) => (text) => string;   // mode: "tmux"|"ansi"|"plain"
export const gaugeRole = (pct) => "ok"|"warn"|"crit"|"over"; // 85/100/120 thresholds
export const orderSegments = (registry, config) => Segment[]; // enabled, sorted by order
export const renderLine = (items, { mode, width, sep }) => string; // fit + color + join

// Segment (registry entry) shape — data comes later (019/020):
//   { id, enabled, priority, order, render(ctx) -> Item|null }
// Item (a rendered segment, the unit renderLine/fit operate on):
//   { id, text, short?, role, priority }
```

## Role + gauge semantics (exact)

`ROLES` maps semantic role → per-mode color. Values (harvested from Plan 017 /
token-oracle thresholds):

| role | ansi (SGR fg) | tmux |
|---|---|---|
| ok | `32` (green) | `colour46` |
| notice | `36` (cyan) | `colour51` |
| warn | `33` (yellow) | `colour226` |
| crit | `31` (red) | `colour196` |
| over | `91` (bright red) | `colour201` |
| accent | `93` (bright yellow) | `colour214` |
| dim | `90` (gray) | `colour244` |

`roleColor(role, mode)`:
- `mode==="plain"` → identity: returns `(text) => text`.
- `mode==="ansi"` → `(text) => color(text, { fg: ROLES[role].ansi })` (reuse `render.color`).
- `mode==="tmux"` → `(text) => tmuxColor(text, ROLES[role].tmux)`.
- Unknown role → identity (never throw).

`gaugeRole(pct)`: `pct < 85 → "ok"`, `85 ≤ pct < 100 → "warn"`,
`100 ≤ pct < 120 → "crit"`, `pct ≥ 120 → "over"`. Non-finite → `"ok"`.

## Width-drop algorithm (exact, deterministic)

`renderLine(items, { mode, width, sep = "  " })`:

1. `items` is already in **display order**. Each has `{ text, short?, role, priority }`.
2. If `width` is null/undefined/≤0 (unlimited): color every item, join with `sep`, return.
3. Otherwise fit to `width` (measured with `visibleWidth`, which ignores color
   markup), in two phases, both operating on the **lowest-priority** items first:
   - **Phase A — shorten:** while the joined `visibleWidth` (of the plain
     texts + separators) exceeds `width`, pick the lowest-priority item that is
     still showing `text` AND has a `short` strictly narrower than `text`, and
     switch it to `short`. Stop when it fits or nothing left to shorten.
   - **Phase B — drop:** while it still exceeds `width` and more than one item
     remains, remove the lowest-priority item. Stop when it fits or one remains.
4. Color the surviving items by role for `mode`, join with `sep`, return.

Ties in priority break by later display order dropped first (rightmost-lowest
goes first) — make it deterministic and assert it in a test.

Width is measured on the **plain** text (color markup excluded) so tmux `#[..]`
and ANSI escapes never count toward width.

## Tasks

### Task 1 — `visibleWidth` strips tmux markup + `tmuxColor`

- [ ] **Step 1 (red):** in `test/status-segments.test.mjs`, test
  `visibleWidth("#[fg=colour46]hi#[default]") === 2` and
  `tmuxColor("hi","colour46") === "#[fg=colour46]hi#[default]"`.
- [ ] **Step 2:** run `node --test test/status-segments.test.mjs` → fails.
- [ ] **Step 3:** in `lib/render.mjs` add `tmuxColor`; extend the
  `visibleWidth` regex to also strip `#\[[^\]]*\]` (tmux markup) in addition to
  the existing `\x1b\[[0-9;]*m` (ANSI). Keep the existing biome-ignore comment.
- [ ] **Step 4:** run → green. **Step 5:** commit
  `feat(status): tmux color helper + width strips tmux markup`.

### Task 2 — `ROLES`, `roleColor`, `gaugeRole`

- [ ] **Step 1 (red):** tests: `roleColor("ok","tmux")("x") === "#[fg=colour46]x#[default]"`;
  `roleColor("dim","ansi")("x")` contains `\x1b[90m`; `roleColor("ok","plain")("x") === "x"`;
  unknown role → identity. `gaugeRole` at boundaries: `84→ok, 85→warn, 99→warn, 100→crit, 119→crit, 120→over, NaN→ok`.
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** implement `ROLES`, `roleColor`, `gaugeRole` in
  `lib/status/segments.mjs` per the tables above.
- [ ] **Step 4:** green. **Step 5:** commit `feat(status): roles + gauge thresholds`.

### Task 3 — `orderSegments`

- [ ] **Step 1 (red):** given a registry
  `{ a:{enabled:true,order:2}, b:{enabled:false,order:1}, c:{enabled:true,order:0} }`
  and a config that flips `b.enabled=true` and `a.order=5`, `orderSegments`
  returns ids `[c, b, a]` (disabled excluded unless config enables; sorted by
  effective order). A config toggling `c.enabled=false` drops `c`.
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** implement `orderSegments(registry, config)`: shallow-merge
  each segment with `config.segments?.[id]`, keep `enabled`, sort by `order`
  (stable), return the segment objects (carrying merged `priority`).
- [ ] **Step 4:** green. **Step 5:** commit `feat(status): config-driven segment ordering`.

### Task 4 — `renderLine` fit/shorten/drop

- [ ] **Step 1 (red):** tests (use `mode:"plain"` so assertions are on plain text; `sep:"  "`):
  - Unlimited width (`width:null`): all items, joined, full text.
  - Fits: `width` large → all full.
  - Shorten: two items, one with `short`; a width that fits only if the
    lowest-priority one uses `short` → output uses `short` for it, full for the
    other.
  - Drop: width so small only the highest-priority item fits → only it remains.
  - Multi-drop + tie-break: three items, two share the lowest priority → the
    rightmost (later display order) drops first.
  - Width excludes color: same inputs with `mode:"tmux"` → `visibleWidth` of
    the result (after stripping markup) ≤ width, and the drop decisions match
    the plain-mode run.
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** implement `renderLine` per the algorithm above.
- [ ] **Step 4:** green. **Step 5:** commit `feat(status): priority width-drop assembly`.

### Task 5 — module smoke + lint

- [ ] **Step 1:** `node --test` → ALL tests pass (not only this file).
- [ ] **Step 2:** `./node_modules/.bin/biome check lib/status/segments.mjs lib/render.mjs test/status-segments.test.mjs` → exit 0 (run `--write` if it only reports formatting, then re-check).
- [ ] **Step 3:** commit any formatting fixup `style(status): biome`.

## Done criteria (machine-checkable)

- [ ] `node --test` exits 0; `test/status-segments.test.mjs` present and passing.
- [ ] `./node_modules/.bin/biome check <the three files>` exits 0.
- [ ] `lib/status/segments.mjs` exports `ROLES`, `roleColor`, `gaugeRole`,
      `orderSegments`, `renderLine`; `lib/render.mjs` exports `tmuxColor`.
- [ ] No runtime dependencies added; no `fs`/`child_process`/`process`/`Date` in
      `lib/status/segments.mjs`.
- [ ] Width-drop is deterministic (tie-break test passes).

## STOP conditions

- If reproducing an interface here requires I/O or tmux, STOP — that belongs to
  019/020, not this pure engine.
- If `visibleWidth`'s regex change breaks an existing curtain test, STOP and
  report (do not weaken the curtain's width math to pass).

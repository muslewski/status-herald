# Plan 010: Research spike — zellij and kitty as HERALD surfaces (report, no code)

> **Executor instructions**: This is a RESEARCH spike. The deliverable is a
> markdown report, not code. Do not modify any source file in this repo or
> any other. If anything in the "STOP conditions" section occurs, stop and
> report. When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: Plans 002 and 005 must be DONE (the questions
> below reference the tmux renderer and the render CLI). If not, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (read-only)
- **Depends on**: plans/002, 005
- **Category**: direction
- **Planned at**: greenfield; leads gathered 2026-07-02 from
  github.com/dj95/zjstatus, zellij.dev docs, kovidgoyal/kitty discussion
  #4447 and kitty tab_bar docs

## Why this matters

The operator wants HERALD to be the convention for "who knows how many"
status-bar hosts. zellij and kitty are the two named next candidates. Both
have real but very different customization models — zellij status bars are
WASM plugins (sandboxed: no filesystem/exec access by default), kitty's tab
bar is a user Python module (`tab_bar_custom_draw`). Guessing an adapter
design without a spike risks building the wrong abstraction into the core.
This spike answers "can `herald render` output feed each host, and through
which seam?" — the resulting report becomes the spec for future adapter
plans.

## Current state

HERALD after Plan 005 renders three modes: `ansi`, `tmux`
(`#[fg=colour214]…#[default]`, `##` escaping), `plain`.

Leads already gathered (verify, don't trust):
- **zjstatus** (github.com/dj95/zjstatus, ~1k stars) is the de-facto zellij
  status bar plugin. Its format strings use tmux-style `#[fg=#89B4FA,bold]`
  markup — possibly directly compatible with HERALD's tmux renderer output
  (colors: zjstatus uses hex, tmux renderer uses `colour<n>` — check which
  forms zjstatus accepts). It has `command_*` widgets (run a command on an
  interval — the obvious seam: `command_herald_command "herald render
  --surface zellij"`) and a `pipe` widget (push-based via `zellij pipe`).
  WASM sandbox: plugins cannot exec or read fs themselves; command widgets
  work because the HOST runs them.
- **kitty**: `kitty.conf` key `tab_bar_style custom` + `tab_bar_custom_draw`
  (a `tab_bar.py` in the kitty config dir implementing `draw_tab(...)`).
  Python, runs in-process per redraw — spawning `herald` per tab per redraw
  may be too slow; a cached-file pattern (herald writes, tab_bar.py reads)
  is the likely seam. Prior art: kovidgoyal/kitty discussion #4447; blog
  "A sane starting point for writing tab_bar.py" (theopark.me, 2025-12-28).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| zellij present? | `zellij --version` | version or "not found" (both fine — note it) |
| kitty present? | `kitty --version` | version or "not found" |
| Web research | firecrawl/WebFetch on the URLs above | docs retrieved |

## Scope

**In scope**:
- `plans/research-zellij-kitty.md` (create — the report)

**Out of scope**:
- ANY code change, in this repo or elsewhere.
- Installing zellij/kitty system-wide (a user-local binary for testing is
  fine if easy; otherwise answer from docs and say so).

## Steps

### Step 1: zellij investigation

Answer in the report, with sources:
1. Which markup does zjstatus's `command_*_format` accept for `{stdout}` —
   can it style output the command produced, or only wrap it? Does raw
   tmux-style markup INSIDE the command's stdout get interpreted?
2. Exact config for a herald command widget: widget declaration, interval,
   rendermode. Write the full working `layout` snippet (untested is
   acceptable if zellij absent — label it).
3. The `pipe` widget path: can `herald` push updates via `zellij pipe`
   instead of being polled? Latency/complexity verdict.
4. Native zellij alternative without zjstatus (built-in status bar plugin
   swap) — worth supporting or not?
5. Verdict: new render mode needed (`--surface zellij`) or does `tmux` mode
   output work as-is? What does a `lib/surfaces/zellij.mjs` need?

### Step 2: kitty investigation

1. Confirm the `tab_bar_custom_draw` API surface (function signature, what
   objects expose, redraw frequency).
2. Benchmark thinking: is exec-per-redraw viable (measure
   `time ./bin/herald render --surface plain` — Plan 005 targets <150 ms;
   kitty redraws can be frequent)? If not, spec the cached-file seam:
   herald invoked by cron/hook writes
   `${XDG_STATE_HOME}/status-herald/kitty.txt`; `tab_bar.py` reads it (a
   few lines of Python — draft them in the report).
3. Which HERALD render mode fits (plain? ansi? kitty draws via its own
   styling API, so likely plain + a parse step, or a new structured JSON
   mode — this is the key architectural question).
4. Verdict + what a future adapter plan must contain.

### Step 3: the generalization question

One section: given tmux, Claude Code, zellij, kitty — is a fourth render
mode emerging that outputs **structured segments as JSON** (id, text, role,
color) for hosts that do their own drawing (kitty; potentially i3bar/waybar,
which consume exactly that shape)? Recommend adopt/defer with reasoning.
(i3bar's JSON block protocol — `full_text`, `short_text`, `color`, click
events on stdin — is the closest existing standard; assess whether HERALD's
JSON mode should simply BE i3bar-protocol-compatible.)

### Step 4: write the report

`plans/research-zellij-kitty.md`: findings per host, config snippets,
performance notes, the three verdicts, and a proposed plan list (e.g.
"011: zellij adapter via zjstatus command widget, S; 012: JSON render mode
+ kitty tab_bar reference implementation, M"). Every claim sourced (URL or
local test).

**Verify**: report exists, contains all four sections, every verdict is an
explicit adopt/defer/reject with one-paragraph reasoning.

## Test plan

None — no code. The report's config snippets are labeled tested/untested.

## Done criteria

- [ ] `plans/research-zellij-kitty.md` exists with sections: zellij, kitty,
      generalization (JSON/i3bar), proposed next plans
- [ ] Each of the 3 verdicts is explicit (adopt/defer/reject + reasoning)
- [ ] `git status --porcelain` shows ONLY the new report file
- [ ] `plans/README.md` status row updated

## STOP conditions

- You find yourself writing adapter code "to test" — a scratch file outside
  the repo is fine; nothing lands in `lib/`.
- Both zellij and kitty docs contradict the leads above so thoroughly that
  the questions don't parse — report what you found; a null result is a
  valid spike outcome.

## Maintenance notes

- The report feeds the next planning round; it should end with enough
  specificity that each proposed plan's "Current state" section can be
  copied from it.
- Re-run the zjstatus compatibility check against its releases when
  executing any resulting plan — WASM plugin APIs move fast.

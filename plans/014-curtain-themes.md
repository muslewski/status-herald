# Plan 014 — Curtain themes, profiles, and animated ASCII art

**Status**: DONE (shipped).

Shipped 2026-07-11.

The curtain card works but its look is hardcoded: one centered glyph + label +
subtitle on a solid black fill, colored from ~16 named ANSI colors. This plan
makes the *look* data-driven — themes, per-session binding, a transparent
background that lets the terminal's own background (Ghostty) show through, and
per-state ASCII art that can animate — **without adding a runtime dependency or
a font renderer**, and without changing behavior for anyone who does nothing.

## What the operator asked for (verbatim intent)

1. **Disable the background.** A toggle so the curtain does not paint a black
   fill and Ghostty's own background shows through — "use ghostty background and
   do not try to color background."
2. **Per-state ASCII art**, artistic, not a "creepy robot" — "hammer when
   working, or something like that," and "some animation of it."
3. **Themes and profiles** — a system to pick and author looks, so "we really
   need to look at core to be flexible for different approaches."

Two follow-ups settled during brainstorming:

- **"Profile" = per-session binding**, not a second visual concept. A theme is
  the look; a binding says which session wears which theme (glob → theme name).
  Chosen by the operator over a global-switchable-preset or a themes-only model.
- **Animation is in scope** (the operator explicitly wants it), modeled as a
  pure function of a tick index so the renderer stays `node --test`-able.

## The model: one visual concept (theme) + one binding axis

**Theme** = everything about the look: background mode, palette, per-state art
frames / glyph / label, layout. Built-in as a JS constant, or user-authored in
config. There is deliberately no separate "profile" object — a profile would
only earn its name if it carried *behavioral* difference (poll intervals, state
machine), and none exists here. Naming it now would create two mental models for
one thing (fusion agreement: Grok + Opus).

**Binding** = which theme a session wears. `theme` is the default; the optional
`themeBySession` maps a session-name glob to a theme name. This reuses
`globToRe` (`lib/curtain/session.mjs`) — the same minimal matcher `autoArm`
already uses (`*` → `.*`, every other char literal) — so `"token-oracle*"`
binds every token-oracle executor tab. This is the operator's real second axis:
14 differently-named live sessions, and different tabs should be able to look
different. It is cheap because the glob machinery already exists.

## Theme shape (data, not code)

A theme is a plain object. The current hardcoded `CARDS` map *becomes* the
built-in `classic` theme unchanged — same render path, now fed from data.

```jsonc
{
  "background": "solid",            // "solid" | "transparent"
  "bgColor": 0,                     // 256-color index; solid mode only
  "layout": { "align": "center" },  // room to grow; center is the only mode in v1
  "states": {
    "working": {
      "fg": 33,                     // named ("brightYellow") OR raw SGR (33 | "1;36")
      "glyph": "●", "label": "WORKING",   // fallback when frames absent
      "frames": [                   // array of frames; each frame is string[]
        ["   __   ", "  (__)  ", "    \\\\  "],
        ["   __   ", "  (__)  ", "    \\   "],
        ["  __    ", " (__)__ ", "      * "]
      ]
    },
    "compacting": { "fg": 36, "glyph": "⟳", "label": "COMPACTING" },
    "done":       { "fg": 92, "glyph": "✅", "label": "DONE" },
    "needs":      { "fg": 91, "glyph": "⚠", "label": "NEEDS YOU" },
    "idle":       { "fg": 90, "glyph": "—", "label": "" }
  }
}
```

Per-state fallback chain, applied in the renderer: **`frames[tick % n]`** →
else **`glyph` + `label`** → else blank. A static art is simply
`frames.length === 1`; there is one code path, not two. Anything a state omits
falls back gracefully, so a partial user theme is valid.

**No templating inside art** (`{{time}}` etc.) — YAGNI (Grok). The live numbers
(elapsed, `1 subagent`, `worked 3:40`, `focus to open`) stay herald-computed and
are appended below the art block as today. The theme owns art + colors; herald
owns the dynamic lines.

## Resolution order (deep merge, one rule)

For a session `S`, the resolved theme is:

```
name  = firstGlobMatch(config.themeBySession, S)  ??  config.theme  ??  "classic"
base  = BUILTINS[name]         ?? BUILTINS["classic"]      // unknown name → classic
user  = config.themes?.[name]  ?? {}                       // user override / new theme
top   = pick(config, ["background", "bgColor", "layout"])  // global convenience overrides
resolved = deepMerge(deepMerge(base, user), top)
```

- `config.themes.<name>` may **override a built-in** of the same name or define a
  brand-new theme — deep-merged over the built-in base.
- Top-level `background`/`bgColor`/`layout` are the "just flip the switch"
  overrides, merged **last** and applied to the resolved theme regardless of how
  its name was chosen. One predictable rule; documented. A user who wants
  per-session background differences sets it inside each theme.
- Reuses `lib/config.mjs`'s existing `merge` (deep-merge, arrays/scalars
  replace) verbatim — near-zero new resolution code.

## Rendering changes

### Art block + animation (pure, tick-indexed)
`renderCard` gains a `theme` and a `tick`. It selects `frames[tick % n]`,
computes the block's max visible width (strip-ANSI + codepoint length, the
existing `visibleWidth`), left-pads each art line independently to center the
block, treats art + dynamic lines as one vertically-centered unit, and returns
exactly `rows` strings. No wall-clock inside render — the tick is injected, so
tests stay deterministic (this is the concrete answer to Grok's one objection to
animation).

### Transparent vs solid background
- **solid**: build full-width lines (bg-colored spaces + centered content), as
  today. `bgColor` selects the fill (256-color).
- **transparent**: emit only leading spaces for centering + content, **no
  trailing fill and no bg SGR** — the terminal's own background shows through.

The ghost hazard when you stop over-painting: a shorter new frame can leave the
previous frame's cells behind. Fix by extending the flicker discipline already
shipped — the repaint emits **`\x1b[K` (erase-to-end-of-line) after every line**
and homes the cursor (no `2J`, no per-frame `\x1b[J` flash). `\x1b[K` is a no-op
in solid mode (the full-width line already overwrites) and erases ghosts to the
terminal default in transparent mode. Keep the DECAWM wrap-off/on bracket from
the doubled-label fix so a wide glyph still can't wrap-scroll the block.

### Color generalization (`lib/render.mjs`)
`color()` extends to accept a raw SGR code — a number (`33`) or a string
(`"1;36"`, `"38;5;208"`) — in addition to the existing named colors, which keep
working. This unlocks 256-color themes with no truecolor / capability-detection
branch (YAGNI, Grok). Additive, back-compatible.

## Built-ins shipped (works with zero config)

`lib/curtain/themes.mjs` (new) exports `BUILTINS`:

- **`classic`** — today's solid-black glyph/label, byte-identical to current
  output. **Remains the global default**, so every existing user and CI golden
  is unaffected.
- **`minimal`** — transparent, glyph + label, no art. The "let my Ghostty
  background through" theme.
- **`forge`** — transparent + the animated hammer on WORKING, with a small
  static art per other state. The reference for "artistic + animated."

Built-ins are JS constants (zero FS, always available). Users add or override
themes under `config.curtain.themes.<name>` — pure JSON, art as arrays of
strings, git-diffable line by line. No separate `themes/` directory, no theme
search-path, no `extends` (all YAGNI, Grok).

## Animation cadence (traffic-aware)

The card repaints on a per-session bash loop. Animation needs faster repaints,
but the operator runs ~14 mosh'd sessions and 4× repaint traffic everywhere is
real cost. So:

- At arm/refresh, herald stores `@herald_frame_ms` per session: a faster value
  (default 500 ms, i.e. ~2 fps) **only if the resolved theme has any
  multi-frame state**, else 1000 ms (today's cadence).
- The loop reads `@herald_frame_ms` for its `read -t` interval and passes an
  incrementing `--tick`. Static themes therefore keep today's 1 Hz traffic;
  only animated tabs tick faster.
- `curtain.animation.fps` in config overrides the animated cadence.

This is the one place the plan touches traffic; called out because it interacts
with the standing constraint that the operator's remote sessions must not be
disturbed.

## Data flow / files touched (design level; writing-plans details)

- **`lib/config.mjs`** — `DEFAULTS.curtain` gains `theme: "classic"`,
  `themeBySession: {}`, `themes: {}`, `animation: { fps: 2 }`. The top-level
  `background`/`bgColor`/`layout` override keys are **not** defaulted — they must
  stay absent so a resolved theme's own `background` wins unless the user
  explicitly sets a global override (otherwise the last-merge rule would clobber
  every theme). Add `resolveTheme(sessionName, config)` (uses `globToRe`) +
  `isAnimated(theme)`.
- **`lib/curtain/themes.mjs`** (new) — `BUILTINS` (classic/minimal/forge).
- **`lib/render.mjs`** — `color()` SGR passthrough; `eraseLine()` (`\x1b[K`);
  transparent vs solid line builders.
- **`lib/surfaces/curtain-card.mjs`** — `renderCard`/`renderCardFrame` take
  `theme` + `tick`; build art block from frames; compose dynamic lines;
  transparent/solid line construction; per-line `\x1b[K` in the frame.
- **`lib/curtain/session.mjs`** — `arm`/`refreshCards` resolve the session's
  theme name and store `@herald_theme` + `@herald_frame_ms` (config-as-message-
  bus: re-read next tick / on refresh, no daemon).
- **`lib/cli.mjs`** — `render` gains `--theme <name>` and `--tick <n>`; resolves
  name → merged theme via `loadConfig` and passes to `renderCard`.
- **`scripts/curtain-card-session.sh`** — maintain a tick counter; read
  `@herald_theme` + `@herald_frame_ms`; pass `--theme`/`--tick`; variable
  `read -t`. (Loop change → needs `curtain refresh` to reach existing card
  windows, exactly as the `worked` line did — non-destructive respawn of the
  hidden `_curtain` window, preserving every `@herald_*` option.)

## Back-compat (hard requirement)

- Default theme is `classic` (solid), identical bytes to current output. A user
  with no `curtain.theme`/`themes` config sees no change.
- `renderCard`'s new `theme`/`tick` params default to the classic theme / tick 0
  so existing call sites and tests keep passing.
- Deep-merge over defaults means old config files load unchanged.

## Testing (pure-first)

- **curtain-card**: frame selection by tick (`tick % n`, single-frame stable);
  transparent mode emits no bg SGR / no trailing fill; solid mode emits full-
  width bg; glyph+label fallback when `frames` absent; art centered at awkward
  sizes (odd cols, art wider/taller than the pane — clip, don't wrap); dynamic
  lines still present.
- **themes/config**: `resolveTheme` merge order (builtin ← user ← top-level);
  `themeBySession` glob binding + first-match-wins; unknown name → classic;
  `isAnimated` detection drives `@herald_frame_ms`.
- **render**: `color()` SGR passthrough (number + string) alongside named.
- **CLI**: `herald render --theme forge --tick 2 ...` picks the third frame.
- **session**: `arm` stores `@herald_theme`/`@herald_frame_ms`; `refreshCards`
  re-resolves after a config change; all preserved across respawn.
- The JS↔bash seam (per-line `\x1b[K`, tick forwarding) is asserted in the CLI
  render output and verified once live in a real tmux curtain before ship — the
  ghosting failure mode only appears at real sizes (Grok's explicit warning).

## Prior art — not reinventing the wheel

Surveyed intent: figlet/toilet (FLF font banners), ccstatusline (already studied
as prior art in Plan README), ink/blessed (TUI theming). The web survey leg
(firecrawl) was unavailable this session (out of credits; WebSearch hook-blocked
in its favor) — the design leans on established domain knowledge plus the Grok
consult, which is sufficient for this well-trodden terrain. Deliberate reuse
rather than reinvention:

- **Do not vendor a figlet renderer or `.flf` fonts.** Users who want big text
  run `figlet -f small` / `toilet` once and paste the lines into a theme's
  `frames`. Pure data, zero runtime code path, trivially testable. (The single
  biggest over-engineering trap — fusion unanimous.)
- **Transparent = absence of paint**, the standard terminal convention (no bg
  SGR → default background), not a special "transparency" feature.
- **256-color SGR passthrough** instead of a color library.

## Design decisions (recorded so nobody re-litigates)

- **One visual concept (theme); "profile" is per-session binding.** Not two
  look-objects. Binding reuses the existing glob.
- **Animation kept, against Grok's YAGNI call** — operator explicitly asked;
  cost contained by modeling it as a pure `frames[tick % n]` selection (no wall-
  clock in render) and by ticking fast only for animated themes.
- **No figlet / font renderer / `.flf`** — paste-your-own-art via `frames`.
- **Themes live in the one XDG config JSON** (`config.curtain.themes.<name>`),
  not a separate directory — keeps the single-config-file story true.
- **Transparent is opt-in; solid `classic` stays the default** — back-compat for
  every other user; the operator's own config selects `forge`/transparent.
- **Fusion note**: Grok independently converged on data-driven themes, raw art
  arrays, single config file, and the `\x1b[K` transparent discipline. It was
  overridden on exactly two points (animation, per-session binding), both driven
  by explicit operator requirements, both scoped to stay cheap.

## Non-goals (YAGNI)

figlet/font rendering · separate theme files / search-path · theme `extends`
/inheritance · live-reload / `fs.watch` · truecolor capability detection ·
in-art templating / variable substitution · schema-validation library · theme
`extends` · a TUI theme previewer (a `herald curtain render --demo` that prints
a few states at 80×24 is the maximum) · animation smoothness guarantees on
high-latency links (this is a status card, not a game).

# Plan 012: Website brand brief — HERALD's voice, positioning, and family contrast

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 75e9253..HEAD -- docs/`
> If `docs/brand/BRIEF.md` already exists, STOP — someone got here first.
> Also skim `plans/README.md`'s status table: if any plan is marked DONE,
> the "shipped vs planned" honesty rules in Step 3 must reflect that.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (pure document; grounded in the plan set, not shipped code)
- **Category**: direction
- **Planned at**: commit `75e9253`, 2026-07-02

## Why this matters

A `status-herald-site` repository will eventually exist, following the same
path `agentic-sage-site` took: a **brand brief first**, then parallel visual
explorations, then a cherry-pick assembly. The sage site proved that the
brief is the highest-leverage artifact — it fixed the palette, the mascot's
role, the exact hero copy, and the voice *before* any HTML existed, which is
why twelve exploration variants stayed coherent. Token-oracle's brand
(cool violet mystic) landed as a deliberate contrast to sage's (warm gold
judge). HERALD is the third sibling and currently has **no brand at all**:
no voice, no tagline, no palette territory, no mascot concept. This plan
produces that brief as `docs/brand/BRIEF.md` in this repo — abstract brand
only, explicitly **not** framework, layout, or UI decisions. When the site
repo is created, this file seeds its `explorations/BRIEF.md`.

## Current state

The repo contains only `plans/` (001–011) — no product code yet, no docs/.
Everything the brief may claim about the product must come from the truth
table below, which was extracted from the plan set at commit `75e9253`.

### Product truth table (the ONLY facts the brief's copy may assert)

| Fact | Source |
|------|--------|
| HERALD = *Heads-up Engine for Rendering Adaptive Line Displays* | `plans/README.md` (What this project is) |
| npm package `status-herald`, binary `herald`, brand word HERALD | `plans/README.md`, plan 001 |
| One convention + one zero-runtime-dependency Node CLI for bottom status bars | `plans/README.md`; zero-dep is a hard invariant |
| Surfaces at launch: Claude Code `statusLine` + tmux `status-right` | plans 005, README |
| zellij and kitty are a **research spike only** (report, no code) | plan 010 |
| Global install (`npm i -g status-herald`), per-project presets keyed by repo identity | `plans/README.md` design decisions |
| Ships presets: token-oracle forecasts/alerts, agentic-sage session/fleet info, stoic-quote bar | `plans/README.md`, plan 006 |
| Fail-open everywhere: empty output + exit 0 beats an error in a status bar | `plans/README.md` design decisions |
| Semantic roles (`ok/notice/warn/crit/accent/dim`), not hard-coded colors | `plans/README.md` design decisions, plan 002 |
| No daemon, no socket — CLI stays stateless, config is the message bus | `plans/README.md` design decisions |
| One display name across surfaces via `herald name`; tmux mirrored natively | plan 008 |
| `herald menu` interactive preset picker (tmux display-menu + fallback) | plan 007 |
| `herald doctor` setup verification | plan 005 |
| MIT, open source, npm registry distribution, `npx status-herald` trial path | plans 001, 011 |

**Claims the brief must NOT make** (rejected or unshipped per `plans/README.md`):
money/cost alerts (token-oracle has no cost schema yet), any daemon or
background refresher, bidirectional tmux name sync, zellij/kitty as
supported surfaces, editing or controlling agentic-sage/token-oracle.

### Sibling brand #1 — SAGE (the warm gold judge)

Source: `/home/kento/Repositories/agentic-sage-site/explorations/BRIEF.md`
(inlined here; the path is a cross-check, not a requirement).

- **Palette**: paper/cream `#F4EFE6` `#EFE7D8` `#FBF8F2`, ink `#1A1714`,
  gold accent `#B8862F` (hover `#9E7325`, bright `#C8972F`), olive green
  `#6B7A3A` for success/checks. Final assembled site: dark warm background +
  gold + cream text + paper grain texture.
- **Fonts**: heavy condensed sans display (Archivo Black / Anton), Inter
  body, JetBrains Mono for terminal, Caveat cursive for hand-drawn accents.
- **Mascot**: robed sage wearing sunglasses, holding a staff; recurs in
  every banner; used as a "speech-bubble character" that speaks brand lines.
- **Voice**: first-person, dry, declarative, judging. Tagline:
  *"I don't do the work. I judge it."* Refrain: *"Advisor, not a boss —
  just the truth."* Section heads like *"A judge, not a boss."*
- **Pillar style**: six capability statements — "Passive by design",
  "Read-only & safe", "Zero-dependency", "Default-off", "Fail-open",
  "Hot-path-cheap".
- **Signature motion**: typed-terminal hero (`$ sage board` → fleet rows).

### Sibling brand #2 — TOKEN ORACLE (the cool violet seer)

Source: `/home/kento/Repositories/token-oracle/assets/oracle-banner.webp`
and `README.md` (inlined here).

- **Palette**: white → lavender → violet/indigo gradient; cool temperature;
  crescent moon, stars/sparkles, faint mystical geometry.
- **Mascot**: oracle in white robe with violet trim, white filigree
  half-mask, an hourglass hovering above her open palm.
- **Voice**: second-person imperative promise. Tagline: *"Know when you'll
  hit the limit."* Value cards: CLARITY / FORESIGHT / CONFIDENCE /
  INTENTION, each with a short imperative pair ("Avoid surprises. Stay in
  control.").
- **Footer strip**: Provider-agnostic · Zero dependencies · CLI first ·
  Extensible.

### The family pattern the brief must extend

Both siblings share: a **robed character** with one signature prop and one
distinctive face treatment (sage: sunglasses + staff; oracle: filigree mask
+ hourglass); an **all-caps wordmark** with the expansion in small text
beside it; a **one-hue-owned palette territory** (sage owns warm gold on
cream/dark-warm; oracle owns cool violet on white); a **one-sentence
tagline in a distinct grammatical register** (sage: first-person paradox;
oracle: second-person imperative); pillar cards naming real product
invariants; zero-dependency called out as a badge.

The natural positioning triad — offered as the working frame, candidates in
the brief may sharpen it: **the sage judges what happened, the oracle
foresees what will happen, the herald announces what is happening now.**
HERALD's product is literally an always-current line at the bottom of every
surface; "the announcer of current state" is grounded, not decorative.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Verify file exists | `test -f docs/brand/BRIEF.md && echo ok` | `ok` |
| Section count | `rg -c "^## " docs/brand/BRIEF.md` | ≥ 9 |
| Clean tree check | `git status --porcelain` | only in-scope paths |

(No npm/biome gates — the repo may not be bootstrapped yet (plan 001 TODO)
and this plan creates a document only.)

## Suggested executor toolkit

- If `/home/kento/Repositories/agentic-sage-site/explorations/` and
  `/home/kento/Repositories/token-oracle/assets/` exist in your
  environment, skim `BRIEF.md`/`ASSEMBLY.md` and the oracle banner to
  sanity-check the inlined excerpts above. If they don't exist, the
  excerpts are sufficient — do not go looking further.
- No web research needed; the brand is defined by contrast within this
  family, not by market survey.

## Scope

**In scope** (the only files you should create/modify):
- `docs/brand/BRIEF.md` (create)
- `plans/README.md` (status row update only)

**Out of scope** (do NOT touch or decide):
- Any file in `agentic-sage-site` or `token-oracle` — read-only exemplars.
- Creating the `status-herald-site` repository — future work.
- Framework, layout, HTML/CSS, component, or hosting choices — the brief
  stops at brand. Site *structure* is allowed only as an abstract message
  architecture (section order + what each says), never as markup.
- Producing actual mascot/banner images — the brief specifies image
  *prompts/specs*; generation is an operator step with image tooling.
- Final taste decisions (the winning tagline, the exact hex palette, the
  mascot's prop) — the brief presents ranked candidates; the operator picks.

## Git workflow

- Branch: `advisor/012-website-brand-brief`
- Conventional Commits, e.g. `docs(brand): website brand brief — voice, positioning, family contrast`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `docs/brand/BRIEF.md` with the required skeleton

Create the file with exactly these nine `##` sections, in this order:

```markdown
# HERALD website brand brief — DRAFT (operator picks pending)

## What HERALD is
## Archetype & character
## Voice & tone
## Family positioning — the triad
## Canonical copy candidates
## Visual identity direction
## Naming & wordmark
## Site message architecture
## Decision checklist (operator)
```

**Verify**: `rg -c "^## " docs/brand/BRIEF.md` → `9`

### Step 2: Fill "What HERALD is" from the truth table only

One tight paragraph plus a bullet list of the invariants (zero-dep,
fail-open, global-install/per-project-presets, no daemon, semantic roles).
Every sentence must be traceable to a truth-table row. This section is the
copy-writer's contract: anything not here cannot appear in site copy.
End the section with the verbatim line:

> Copy honesty rule: zellij and kitty are a research spike, not supported
> surfaces; money/cost alerts do not exist; there is no daemon. Site copy
> never claims these.

**Verify**: `rg -n "Copy honesty rule" docs/brand/BRIEF.md` → 1 match.

### Step 3: Archetype, voice, and the triad contrast matrix

- **Archetype & character**: develop the herald/messenger/town-crier
  archetype. The character is the third robed sibling. Specify 2–3 mascot
  concepts as image-generation specs (composition, prop, face treatment,
  mood) — each must name: one signature **prop** (candidates: brass horn,
  banner/standard, unrolled scroll) and one **face treatment** distinct
  from sunglasses (sage) and filigree mask (oracle). State what the
  character does in banners (sage speaks in speech bubbles; oracle holds
  the hourglass; the herald… announces — propose the visual verb).
- **Voice & tone**: a register distinct from sage's first-person and
  oracle's second-person imperative. Candidates worth exploring: the
  announcement register (present-tense proclamation), or plural/collective
  ("every surface, one voice"). Write 5 do/don't voice rules with example
  lines. Voice must never be medieval-kitsch ("Hear ye" is listed as a
  DON'T — one wink maximum, if any).
- **Family positioning — the triad**: a three-column matrix
  (SAGE / TOKEN ORACLE / HERALD) with rows: temporal role (judges past ·
  foresees future · announces present), voice register, palette territory,
  mascot prop + face treatment, tagline pattern, product one-liner. Sage
  and oracle columns come verbatim from "Current state" above; the HERALD
  column is this plan's output.

**Verify**: `rg -n "SAGE.*ORACLE.*HERALD|HERALD.*ORACLE|\| *SAGE *\|" docs/brand/BRIEF.md | head -3`
→ at least 1 match (the matrix header row exists).

### Step 4: Canonical copy candidates

Under `## Canonical copy candidates`:

- `### Tagline candidates` — a numbered list of **at least 5**, each with a
  one-line rationale tying it to a truth-table fact and to the triad
  contrast (e.g. grounded in "one bar, every surface, always current").
  No fabricated capability words (fast/best/smart benchmarks).
- `### Hero sub` — 2 candidates, ≤ 2 sentences each, truth-table-only.
- `### Pillars` — exactly 6, in the family's capability-statement style,
  each mapped to its truth-table row (suggested seeds: zero-dependency,
  fail-open, every-surface-one-convention, global install / per-project
  presets, no daemon, semantic-roles theming — adjust wording, not facts).
- `### The peek` — the 4–6 commands a faux-terminal section would show
  (`herald render`, `herald menu`, `herald name`, `herald doctor` are the
  real verbs from plans 005/007/008).

**Verify**: `awk '/### Tagline candidates/,/### Hero sub/' docs/brand/BRIEF.md | rg -c "^[0-9]+\."` → ≥ 5

### Step 5: Visual direction, naming, message architecture, decision checklist

- **Visual identity direction** (abstract only): propose 2–3 **palette
  territories** by temperature/hue with rationale — hard constraints:
  not gold-dominant (sage owns it), not violet-dominant (oracle owns it),
  must sit naturally next to both in a family lineup, and must respect
  that the *product itself* renders semantic colors (`ok/warn/crit`) — the
  brand accent should not read as an alarm color. Name hue families
  (e.g. heraldic crimson, deep teal, dawn amber) — NO final hex values;
  hexes are exploration-round work. Typography: state the family default
  (heavy condensed display + Inter + JetBrains Mono) and whether HERALD
  keeps or breaks it (recommend keep; breaking is an operator decision).
- **Naming & wordmark**: HERALD all-caps as wordmark; expansion
  *Heads-up Engine for Rendering Adaptive Line Displays* in small text
  beside it; `status-herald` for npm/GitHub contexts; `herald` for
  commands. One rule per context, one line each.
- **Site message architecture**: the abstract section order the future
  site will follow, mirroring the proven sage-site skeleton: hero (with a
  signature motion concept — the natural analogue of sage's typed terminal
  is a **live status bar assembling itself**; describe it in one sentence,
  no implementation), problem, what-HERALD-is, how-it-works (install →
  preset → doctor, from plans 005/006/011), pillars, the peek, final CTA,
  footer. One line per section: what it must communicate.
- **Decision checklist (operator)**: the open taste decisions as
  checkboxes — tagline pick, palette territory pick, mascot prop + face
  treatment pick, voice register pick, keep/break family typography.

**Verify**: `rg -c "^- \[ \]" docs/brand/BRIEF.md` → ≥ 5

### Step 6: Fact-check pass and index update

Re-read the finished brief against the truth table: every product claim
must trace to a row; every mention of zellij/kitty must sit next to the
word "spike" or "not shipped". Then update this plan's row in
`plans/README.md` to DONE.

**Verify**: `rg -in "zellij|kitty" docs/brand/BRIEF.md` → every matching
line contains "spike" or "not shipped" (zero matches is also fine).
**Verify**: `git status --porcelain` → only `docs/brand/BRIEF.md` and
`plans/README.md`.

## Test plan

Not applicable — document-only plan. The verification gates in Steps 1–6
(section skeleton, candidate counts, honesty greps, clean tree) are the
test suite.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `test -f docs/brand/BRIEF.md` succeeds
- [ ] `rg -c "^## " docs/brand/BRIEF.md` → 9
- [ ] `rg -n "Copy honesty rule" docs/brand/BRIEF.md` → 1 match
- [ ] ≥ 5 numbered tagline candidates (Step 4 verify)
- [ ] ≥ 5 operator checkboxes (Step 5 verify)
- [ ] `rg -in "zellij|kitty" docs/brand/BRIEF.md` → each hit contains "spike"/"not shipped", or no hits
- [ ] `rg -in "daemon" docs/brand/BRIEF.md` → each hit is a negation ("no daemon"), or no hits
- [ ] No files outside the in-scope list modified (`git status --porcelain`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `docs/brand/BRIEF.md` already exists (drift check).
- You find yourself writing a capability claim with no truth-table row —
  that means the product facts you want don't exist yet; report the gap
  instead of inventing the feature.
- You are tempted to pick the final tagline/palette/mascot instead of
  presenting candidates — final picks are the operator's; the brief stays
  DRAFT.
- You start writing HTML, CSS, component names, or framework comparisons —
  that's the exploration round, a different plan in a different repo.
- The sibling repos (if present) contradict the inlined brand excerpts
  (e.g. sage-site shipped a different palette than the assembly brief) —
  report the discrepancy; the contrast matrix must anchor to what actually
  shipped.

## Maintenance notes

- **This brief seeds the site repo.** When `status-herald-site` is created,
  copy `docs/brand/BRIEF.md` → `explorations/BRIEF.md` there and follow the
  proven sage-site cadence: round 1 = N wild single-file explorations from
  the brief, round 2 = refined variants of the winner, round 3 = cherry-pick
  assembly (`agentic-sage-site/explorations/{BRIEF-v2,ASSEMBLY}.md` are the
  process exemplars). Those rounds are future plans, not this one.
- **Re-verify copy at site-build time.** The truth table reflects the plan
  set at `75e9253`; by the time the site is built, plans 001–011 will have
  shipped (or drifted). Site copy claims what is DONE then, not what was
  planned now. In particular: if plan 010's spike graduates zellij/kitty to
  real surfaces, the honesty rule flips; if token-oracle ships its cost
  engine (its plan 017), money-alert copy may unlock.
- **The operator's picks are brand law once made.** After the decision
  checklist is resolved, record the picks in the brief (strike the DRAFT
  marker) — later exploration rounds must not re-litigate them, mirroring
  how sage's BRIEF.md copy stayed verbatim across all twelve variants.
- Reviewers: scrutinize the tagline candidates for fabricated capability
  claims — that's the likeliest failure mode of a copy-writing executor.

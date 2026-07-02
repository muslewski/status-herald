# Plan 009: Documentation to the agentic-sage quality bar

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Plans 001–008 should be DONE (this plan
> documents what exists). Verify: `./bin/herald presets` lists 6 presets,
> `herald menu`, `herald name`, `herald doctor`, `herald install` all appear
> in `./bin/herald help`. For any verb missing, STOP and report which —
> documenting unshipped features is the one failure mode this plan must not
> have.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001–008
- **Category**: docs
- **Planned at**: greenfield; README structure and tone replicated from
  agentic-sage @ `cffd055` (`README.md`, 338 lines) and token-oracle @
  `ada32e9` (`SETUP.md`, `ADAPTERS.md`), 2026-07-02

## Why this matters

The operator explicitly set the bar: "Agentic Sage will provide you with
some quality that we expect." For an open-source launch, the README *is* the
product page. This plan writes the full documentation set in the family's
established voice — every optional piece labeled, every claim backed by a
"turn it on" command, safety invariants stated plainly.

## Current state

After Plans 001–008: working CLI (`render`, `install`, `uninstall`,
`doctor`, `where`, `presets`, `preset set/get`, `menu`, `name`), six
built-in presets, README is still the Plan 001 skeleton.

**The agentic-sage README structure to replicate** (section order, adapted
to HERALD; sage's 338-line README is the tone exemplar — read
`/home/kento/Repositories/agentic-sage/README.md` if available):

1. Centered banner + nav links (Install · How it works · Setup · Presets ·
   Changelog) + badge row (npm version, CI, MIT, Node ≥ 20)
2. Acronym expansion in bold + two-line value prop + one-liner: "Zero
   dependencies, Node ≥ 20, `node --test`."
3. `## Quickstart` — the 4 commands: `npm i -g status-herald`,
   `herald install claude-code`, `herald install tmux`, `herald doctor`
4. `## Why — one bar, many surfaces` — the duplication story (every tool
   reinvents its status bar; HERALD is the convention)
5. `## Parts & options` — the sage-style table: Part | What it does |
   Need it? | Turn on. Rows: render, presets, install wiring, menu, name,
   doctor
6. `## What `herald install` writes (so you can trust it)` — exact blocks,
   backup/abort/skip rules, uninstall symmetry
7. `## Presets` — table of the six built-ins + "write your own" pointer
8. `## Per-project presets` — repoId model, `herald preset set`, `herald menu`
9. `## Interactivity — the config bus` — why a config write is the message
10. `## Naming` — the identity precedence + `herald name`
11. `## Surfaces & capabilities` — the matrix (see below)
12. `## Safety` — fail-open invariants: never nonzero exit on render, never
    stderr, never clobber foreign config, NO_COLOR honored
13. `## Works with token-oracle and agentic-sage` — data contracts consumed
    (forecast.json path; asking breadcrumb), what HERALD never does (parse
    their internals, write their config)
14. `## Layout` (ASCII tree) + one-line doc index
15. `## Community` / `## Contact` — mirror sage's, signed "— Mateusz"

**Surfaces & capabilities matrix** (content for section 11 — keep accurate):

| Surface | Renders | Refresh | Colors | Interactive | Width |
|---|---|---|---|---|---|
| Claude Code statusLine | multi-line ANSI | 300 ms debounce + `refreshInterval` | ANSI + OSC 8 links | via config bus only | `COLUMNS` env |
| tmux status-right | one line, tmux markup | `status-interval` | `#[fg=…]` | `display-menu` (`herald menu`) | `status-right-length` |
| plain (any pipe) | plain text | caller's | none | no | caller's |

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |
| Link sanity | `grep -o '](\./[^)]*)' README.md \| sort -u` | every referenced file exists |

## Scope

**In scope** (create/rewrite):
- `README.md` (full rewrite to the structure above)
- `SETUP.md` — tiered like token-oracle's: Tier 1 install, Tier 2 Claude
  Code, Tier 3 tmux, Tier 4 per-project presets, Tier 5 custom presets;
  then Configuration reference (every config key), then Optional
  integrations (oracle cron snippet: `oracle snapshot` on a 5-min cron;
  sage TTL alignment)
- `PRESETS.md` — preset file format spec, provider reference (all five,
  options tables), `when` grammar, derived-var suffixes (`_k/_hms/_dh/_r`),
  worked example building a custom preset from scratch
- `CONVENTIONS.md` — naming (binary `herald`, config dir, repoId format
  shared with agentic-sage), fail-open invariants, config-bus pattern,
  role/theme doctrine (incl. the two color gates and WHY)
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor
  Covenant 2.1 — copy sage's), `.github/ISSUE_TEMPLATE/1-bug.yml`,
  `2-feature.yml`, `.github/PULL_REQUEST_TEMPLATE.md`
- `AGENTS.md` — the agent-verification runbook (token-oracle pattern):
  exact commands an agent runs to verify a checkout end-to-end, with
  expected outputs

**Out of scope** (do NOT touch):
- Code changes of any kind (if docs reveal a bug, report it — STOP
  condition).
- `plans/` bodies.
- Publishing `presets/schema.json` — decide: either write it now as a plain
  JSON Schema for the preset format AND reference it, or delete the
  `$schema` keys from presets. Pick the first if under 100 lines, else
  second. Document the choice in the commit message. (This is the one
  code-adjacent edit allowed: preset JSON `$schema` keys.)

## Git workflow

- Branch: `advisor/009-docs-quality-bar`
- Conventional Commits, e.g. `docs: README, SETUP, PRESETS, CONVENTIONS to family quality bar`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: README.md

Write to the 15-section structure above. Tone rules distilled from sage:
short imperative bullets; every optional feature answers "do I need it?"
and "how do I turn it on?"; safety claims paired with the mechanism that
enforces them ("aborts on malformed JSON — your settings file is never
half-written"); close with the beta note and a personal sign-off. Include
real command output blocks (run the commands, paste actual output).

**Verify**: every internal link resolves (link-sanity command); every CLI
example in the README executes with exit 0 when copy-pasted (spot-check at
least `herald doctor`, `herald presets`, one render pipe).

### Step 2: SETUP.md, PRESETS.md, CONVENTIONS.md, AGENTS.md

Per the scope bullets. PRESETS.md is the API reference — table per
provider: option | type | default | meaning; the `when` grammar spelled out;
the full worked example must be a runnable preset the reader drops into
`~/.config/status-herald/presets/mine.json` and sees render.

**Verify**: the worked example from PRESETS.md actually renders:
`XDG_CONFIG_HOME=$(mktemp -d) ...` (copy it in, run
`herald render --surface plain --preset mine`) → non-empty output.

### Step 3: community files + templates

Copy sage's CODE_OF_CONDUCT (Contributor Covenant), adapt CONTRIBUTING
(dev setup: `npm install`, `node --test`, `npx biome check .`; Conventional
Commits; zero-dep rule), SECURITY (private report email), issue/PR
templates matching sage's YAML forms.

**Verify**: `ls .github/ISSUE_TEMPLATE/` → 2 files;
`test -f CODE_OF_CONDUCT.md && test -f CONTRIBUTING.md && test -f SECURITY.md && echo ok` → `ok`.

### Step 4: cross-repo hooks (docs only, in THIS repo)

In README section 13 and SETUP Tier 5, document the reciprocal setup:
token-oracle users add the `oracle snapshot` cron and point HERALD's
oracle presets at the default forecast path (works out of the box);
agentic-sage users get the sage-session/sage-judge presets reading the
asking breadcrumbs. Add a short "for maintainers of oracle/sage" note
listing what those repos could add later (oracle: cost fields → money
alerts; sage: a `herald` hint in `sage doctor`) — suggestions, not edits.

**Verify**: `grep -c "token-oracle\|agentic-sage" README.md` ≥ 4.

## Test plan

Docs plan — the "tests" are the executable examples: every command block in
README/SETUP/PRESETS must run with exit 0 on the dev machine (except
`npm i -g`). Record in the PR description which were executed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0 (docs changes broke nothing)
- [ ] `npx biome check .` exits 0
- [ ] README contains the acronym expansion, a Quickstart of ≤5 commands,
      the capabilities matrix, and a Safety section (`grep -q "Heads-up Engine"
      README.md && grep -q "NO_COLOR" README.md`)
- [ ] All 6 in-scope docs exist; internal links resolve
- [ ] PRESETS.md worked example renders non-empty (Step 2 verify)
- [ ] `$schema` keys in presets/ either resolve to a committed
      `presets/schema.json` or are removed (no dangling reference:
      `grep -l '"\$schema"' presets/*.json` implies `test -f presets/schema.json`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any documented verb is missing or behaves differently than Plans 001–008
  specify — docs must describe reality; report the gap, do not paper over
  it or "fix" the code.
- You cannot run the executable examples (no local npm install of the
  package) — use `./bin/herald` paths in examples instead, but flag it.

## Maintenance notes

- README section 6 ("what install writes") must be updated in the same PR
  as any future wiring change — reviewers should tie those together.
- When zellij/kitty land (Plan 010 spike → future plans), the capabilities
  matrix and Parts table grow a row each.
- The family cross-links go both ways eventually: token-oracle's README has
  a "Works with agentic-sage" section — a matching "Works with
  status-herald" section in oracle and sage is future work FOR THOSE REPOS,
  tracked in their own plan sets, never edited from here.

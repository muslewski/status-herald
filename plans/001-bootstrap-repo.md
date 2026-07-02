# Plan 001: Bootstrap the status-herald repository skeleton

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: this is a greenfield repo — there is no prior
> code to drift. Instead verify the preconditions: `ls /home/kento/Repositories/status-herald`
> must contain ONLY `plans/` (this directory). If any other files exist, STOP —
> someone has already started implementing.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: greenfield; conventions sourced from agentic-sage @ `cffd055` and token-oracle @ `ada32e9`, 2026-07-02

## Why this matters

status-herald ("**HERALD** — *Heads-up Engine for Rendering Adaptive Line
Displays*") is a new open-source project: one convention and one CLI for
rendering bottom status bars across many terminal hosts (Claude Code's
`statusLine`, tmux's status-right, and later zellij/kitty). Today the same
status-bar logic is duplicated ad hoc inside two sibling projects
(agentic-sage renders a Claude Code statusline segment; token-oracle ships
`statusline` and `tmux` adapters). This plan creates the repository skeleton
with the exact engineering conventions of agentic-sage — the family's quality
bar — so every later plan lands on working CI, lint, and test rails from day
one.

## Current state

The directory `/home/kento/Repositories/status-herald/` contains only
`plans/`. Nothing else exists — no git repo, no package.json.

Conventions to replicate come from the sibling repo
`/home/kento/Repositories/agentic-sage` (read it if present; if absent, the
excerpts below are sufficient):

- Pure Node.js ESM (`.mjs` files), `"type": "module"`, **zero runtime
  dependencies**, `engines.node >= 20`.
- Tests: `node --test` over `test/*.test.mjs`, hermetic (temp dirs, injected
  `home` parameter — never touch the real `$HOME`).
- Lint/format: Biome as the only devDependency. agentic-sage's `biome.json`
  settings: 2-space indent, `lineWidth` 100, single quotes, semicolons
  `asNeeded`, trailing commas `all`, recommended lint preset.
- Small pure modules in `lib/` with exported arrow functions, top-of-file
  "why" doc comments, fail-open error handling (`try/catch` → return
  `[]`/`null`, never throw on a render path).
- Releases: release-please + Conventional Commits; publish workflow on `v*`
  tags with npm provenance.
- License: MIT, copyright "Mateusz Muślewski".

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install dev deps | `npm install` | exit 0, lockfile created |
| Tests | `node --test` | all pass, exit 0 |
| Lint | `npx biome check .` | exit 0 |
| Format | `npx biome format --write .` | exit 0 |
| Smoke | `./bin/herald --version` | prints `status-herald 0.1.0` |

## Scope

**In scope** (create these; nothing else):
- `.git/` (via `git init`), `.gitignore`, `.editorconfig`
- `package.json`, `package-lock.json`, `biome.json`
- `LICENSE`, `README.md` (skeleton only), `CHANGELOG.md` (stub)
- `bin/herald`, `lib/version.mjs`
- `test/smoke.test.mjs`
- `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`,
  `.github/workflows/publish.yml`
- `release-please-config.json`, `.release-please-manifest.json`

**Out of scope** (do NOT touch):
- `plans/` — advisor-owned; commit it as-is, never edit plan bodies.
- Any rendering, config, or provider logic — later plans own those.
- Publishing to npm or creating GitHub remotes/secrets — human steps.

## Git workflow

- `git init` with default branch `main`.
- Conventional Commits (matches both sibling repos), e.g.
  `chore: bootstrap repo skeleton with CI, biome, release-please`.
- Commit everything in this plan as one or two commits on `main` (greenfield —
  no feature branch needed for the bootstrap itself).
- Do NOT push or create a remote unless the operator instructed it.

## Steps

### Step 1: git init and hygiene files

```
cd /home/kento/Repositories/status-herald
git init -b main
```

Create `.gitignore`:

```
node_modules/
*.log
.DS_Store
```

Create `.editorconfig`:

```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

**Verify**: `git status` → shows untracked files, on branch `main`.

### Step 2: package.json and biome

Create `package.json`:

```json
{
  "name": "status-herald",
  "version": "0.1.0",
  "description": "HERALD — Heads-up Engine for Rendering Adaptive Line Displays. One status line, every surface: Claude Code, tmux, and beyond.",
  "type": "module",
  "bin": { "herald": "bin/herald" },
  "files": ["bin/", "lib/", "presets/", "README.md", "LICENSE"],
  "scripts": {
    "test": "node --test",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "engines": { "node": ">=20" },
  "keywords": ["statusline", "status-bar", "tmux", "claude-code", "terminal", "hud"],
  "author": "Mateusz Muślewski",
  "license": "MIT",
  "devDependencies": { "@biomejs/biome": "^1.9.0" }
}
```

Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "files": { "include": ["bin/**", "lib/**", "test/**"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all"
    }
  },
  "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

Run `npm install`.

**Verify**: `npm install` → exit 0; `npx biome --version` → prints a version.

### Step 3: LICENSE, README skeleton, CHANGELOG stub

- `LICENSE`: standard MIT text, `Copyright (c) 2026 Mateusz Muślewski`.
- `README.md` skeleton (full README is Plan 009 — keep this minimal but true):

```markdown
# status-herald

**HERALD** — **H**eads-up **E**ngine for **R**endering **A**daptive **L**ine
**D**isplays. One status line, every surface.

Render the same configurable status bar — forecasts, alerts, session info, or
a stoic quote — into Claude Code's statusLine, tmux's status-right, and other
terminal hosts. Zero dependencies, Node ≥ 20, `node --test`.

> Early scaffold. See `plans/` for the roadmap.

## License

MIT
```

- `CHANGELOG.md`: `# Changelog` header plus one line
  `## 0.1.0 (unreleased)` / `- chore: repository bootstrap`.

**Verify**: `test -f LICENSE && test -f README.md && test -f CHANGELOG.md && echo ok` → `ok`.

### Step 4: CLI skeleton

Create `lib/version.mjs`:

```js
// Single source of truth for the CLI version string. Reads package.json at
// startup so release-please bumps propagate without a second edit site.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const version = () => {
  const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  return JSON.parse(readFileSync(pkg, 'utf8')).version
}
```

Create `bin/herald` (mark executable, `chmod +x bin/herald`):

```js
#!/usr/bin/env node
// herald — argv dispatch. Every verb must be fail-open: a status-bar host
// invokes this on a timer; a crash or nonzero exit must never break the bar.
import { version } from '../lib/version.mjs'

const [, , verb, ...rest] = process.argv

const help = `status-herald ${version()}
Usage: herald <verb>

Verbs:
  --version      print version
  help           this text
(render, install, doctor, menu, name — arrive in later plans)`

try {
  switch (verb) {
    case '--version':
    case 'version':
      console.log(`status-herald ${version()}`)
      break
    case 'help':
    case undefined:
      console.log(help)
      break
    default:
      console.log(help)
      process.exitCode = 1
  }
} catch {
  // fail open — never a stack trace on a status-bar hot path
  process.exitCode = 0
}
```

**Verify**: `./bin/herald --version` → `status-herald 0.1.0`; `./bin/herald help` → usage text, exit 0.

### Step 5: smoke test

Create `test/smoke.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { version } from '../lib/version.mjs'

test('herald --version prints the package version', () => {
  const out = execFileSync('./bin/herald', ['--version'], { encoding: 'utf8' })
  assert.equal(out.trim(), `status-herald ${version()}`)
})

test('unknown verb exits 1 but prints help', () => {
  try {
    execFileSync('./bin/herald', ['bogus'], { encoding: 'utf8' })
    assert.fail('should exit nonzero')
  } catch (err) {
    assert.match(String(err.stdout), /Usage: herald/)
  }
})
```

**Verify**: `node --test` → 2 tests pass; `npx biome check .` → exit 0 (run
`npx biome format --write .` first if formatting complains).

### Step 6: CI and release automation

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix: { node: [20, 22, 24] }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}' }
      - run: npm install --ignore-scripts
      - run: npx biome check .
      - run: node --test
```

Create `.github/workflows/release-please.yml` and
`.github/workflows/publish.yml` modeled on agentic-sage: release-please runs
on push to `main` with `release-type: node`; publish runs on `v*` tags doing
`npm publish --provenance --access public` with `NODE_AUTH_TOKEN:
${{ secrets.NPM_TOKEN }}`. Create `release-please-config.json`
(`{"packages": {".": {"release-type": "node"}}}`) and
`.release-please-manifest.json` (`{".": "0.1.0"}`).

Note in the commit message body that `NPM_TOKEN` is a human-created secret;
the workflow degrades to a no-op without it.

**Verify**: `npx biome check .` → exit 0 (YAML is outside biome's include
list, so this confirms nothing broke); `git add -A && git status` → all
intended files staged, nothing unexpected.

### Step 7: commit

Commit everything (including `plans/`) with message:
`chore: bootstrap repo skeleton with CI, biome, release-please`.

**Verify**: `git log --oneline` → 1 commit; `git status` → clean tree.

## Test plan

- `test/smoke.test.mjs` (created in Step 5): version output, unknown-verb
  behavior. Model for all future tests: `node:test` + `assert/strict`,
  hermetic, exec the real binary.
- Verification: `node --test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test` exits 0 with ≥2 passing tests
- [ ] `npx biome check .` exits 0
- [ ] `./bin/herald --version` prints `status-herald 0.1.0`
- [ ] `git log --oneline | wc -l` ≥ 1 and `git status --porcelain` is empty
- [ ] `package.json` has `"bin": {"herald": "bin/herald"}` and zero
      `dependencies` (only `devDependencies.@biomejs/biome`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `/home/kento/Repositories/status-herald` contains anything besides `plans/`
  before you start.
- `npm install` cannot reach the registry (offline) — do not vendor Biome;
  report instead.
- Node < 20 is the only runtime available (`node --version`).

## Maintenance notes

- Every later plan assumes these rails: `node --test`, `npx biome check .`,
  Conventional Commits, zero runtime deps. Reviewers should reject any PR that
  adds a runtime dependency without an ADR.
- `lib/version.mjs` reads package.json at runtime; if startup latency ever
  matters (statusline hot path), inline the version at publish time instead.
- The publish workflow is dormant until a human creates the npm package and
  `NPM_TOKEN` secret.

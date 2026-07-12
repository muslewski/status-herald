# Plan 011: Open-source launch — GitHub remote, npm publish, install paths

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Part A requires Plan 001 DONE (`git log
> --oneline` shows the bootstrap commit; `.github/workflows/publish.yml`
> exists). Part B additionally requires Plan 009 DONE (`test -f
> CONTRIBUTING.md && test -f SECURITY.md` — the README is the npm product
> page; never publish the Plan 001 skeleton). If `git remote -v` already
> shows an origin or `npm view status-herald` already resolves, STOP —
> launch has partially happened; report what exists before touching
> anything.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM (outward-facing: publishes a public repo and an npm
  package; names are hard to take back)
- **Depends on**: 001 (Part A); 001–009 (Part B)
- **Category**: dx / release
- **Planned at**: conventions sourced from agentic-sage @ `cffd055`
  (published as `github.com/muslewski/agentic-sage`, npm publish with
  provenance on human-pushed `v*` tags), 2026-07-02

## Why this matters

Plan 001 builds the release rails (release-please, publish workflow,
Conventional Commits) but explicitly marks "publishing to npm or creating
GitHub remotes/secrets" as out-of-scope human steps — and no other plan
owns them. This plan is that owner: the ordered, verified path from local
repo to installable open-source package, replicating what agentic-sage
already shipped. It also records the distribution decision so nobody
re-litigates it: **npm registry only in v1** — `npm i -g status-herald` is
the primary install (operator's global-install decision), `npx
status-herald` works automatically as the zero-install trial path, pip is
not applicable (Node project; Python was rejected in the 001 design
round), and Homebrew/AUR/standalone binaries wait for demonstrated demand.

Part A (GitHub remote) is deliberately allowed early: pushing after Plan
001 turns CI on for every subsequent plan's branch and makes the README
badges real instead of aspirational.

## Current state

After Plan 001: local-only git repo on `main`; `.github/workflows/`
contains `ci.yml`, `release-please.yml`, `publish.yml` (dormant — needs
`NPM_TOKEN`); `package.json` has `bin`, `files`, zero runtime deps — but
**no `repository`, `bugs`, or `homepage` fields**. That gap matters:
`npm publish --provenance` verifies the `repository.url` against the
repository the workflow runs in and fails on mismatch.

After Plan 009: full documentation set (README to the sage bar,
CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates) — everything
a public repo is expected to have on day one.

Prior art to mirror (read if present): agentic-sage's `publish.yml`
carries the operative caveat in its header comment — a tag pushed by
release-please's own `GITHUB_TOKEN` does **not** trigger the publish
workflow; a human pushes the tag (`git push origin vX.Y.Z`) or runs
`workflow_dispatch`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Auth check | `gh auth status` | logged in as `muslewski` |
| Name free? | `npm view status-herald` | `npm error 404` (name available) |
| Pack audit | `npm pack --dry-run` | files list = bin/, lib/, presets/, README.md, LICENSE only |
| Local install rehearsal | `npm pack && npm i -g ./status-herald-*.tgz` | `herald --version` works |
| Tests | `node --test` | all pass |
| Lint | `npx biome check .` | exit 0 |
| Post-publish | `npm view status-herald version` | published version |
| npx path | `npx -y status-herald@latest --version` | `status-herald X.Y.Z` |

## Scope

**In scope**:
- `package.json`: add `repository`, `bugs`, `homepage` fields (the one
  code-adjacent edit this plan is allowed).
- Creating the GitHub remote, pushing `main`, repo settings (description,
  topics, Actions permissions), badge verification.
- npm publish activation: `NPM_TOKEN` secret (human step, marked), first
  release via release-please, provenance verification.
- Install-path verification matrix (global, npx, tarball rehearsal) and a
  short README install-section check that all documented paths are real.

**Out of scope** (do NOT touch):
- `plans/` bodies (advisor-owned; index rows only).
- Any feature code, presets, or docs prose beyond the install section
  check — if a doc is wrong, that is a Plan 009 defect; report it.
- Marketing/announcement posts, GitHub Discussions setup, funding files —
  post-launch, operator's call.
- Homebrew formula, AUR package, single-binary builds (`node --experimental-sea-config`
  or pkg) — deferred; see Maintenance notes.

## Git workflow

- Part A works directly on `main` (settings + push; the `package.json`
  field addition is one commit: `chore: add repository/bugs/homepage for
  npm provenance`).
- Part B's release flows through release-please's own PR — do not
  hand-edit versions or CHANGELOG.
- Human-credential steps (npm token creation, `gh auth`) are marked
  **[HUMAN]**; the executor prepares everything around them and reports
  precisely what the operator must click/paste.

## Steps

### Part A — GitHub remote (any time after Plan 001)

### Step A1: preflight secret + hygiene scan

Greenfield history, so this is cheap insurance, not archaeology:

```
git log -p | grep -iE 'token|secret|api[_-]?key|password' | grep -v 'NPM_TOKEN\|NODE_AUTH_TOKEN' || echo clean
npm pack --dry-run
```

The pack audit must list ONLY `bin/`, `lib/`, `presets/` (if it exists
yet), `README.md`, `LICENSE`, `package.json` — no `plans/`, no `test/`,
no `.github/`. `plans/` stays in git but out of the tarball (`files`
allowlist in package.json handles this; verify, don't assume).

**Verify**: grep prints `clean`; pack list matches the allowlist.

### Step A2: package.json provenance fields

Add to `package.json` (exact values):

```json
"repository": { "type": "git", "url": "git+https://github.com/muslewski/status-herald.git" },
"bugs": "https://github.com/muslewski/status-herald/issues",
"homepage": "https://github.com/muslewski/status-herald#readme"
```

Commit: `chore: add repository/bugs/homepage for npm provenance`.

**Verify**: `node --test` and `npx biome check .` still exit 0;
`node -e "console.log(JSON.parse(require('fs').readFileSync('package.json')).repository.url)"`
prints the URL.

### Step A3: create remote and push **[HUMAN-assisted]**

```
gh repo create muslewski/status-herald --public --source . --push \
  --description "HERALD — status surfaces for agent CLIs (Claude Code, Grok Build, ...) + tmux curtain. Zero-dependency Node CLI."
gh repo edit muslewski/status-herald --add-topic statusline --add-topic status-bar \
  --add-topic tmux --add-topic claude-code --add-topic terminal --add-topic hud
```

Then in repo Settings → Actions → General: set workflow permissions to
"Read and write" and enable "Allow GitHub Actions to create and approve
pull requests" — release-please needs both to open its release PR.

**Verify**: `git remote -v` shows origin; `gh run list --limit 3` shows a
green CI run on `main` within a few minutes of the push; README badges
render live on the GitHub page (CI badge green, not "unknown").

### Part B — npm publish (after Plan 009)

### Step B1: name and account preflight **[HUMAN]**

- `npm view status-herald` → must be `404`. If the name was taken since
  planning, STOP (see STOP conditions — do not improvise a scope or
  rename).
- Operator creates a **granular automation token** on npmjs.com (Packages:
  read/write, no 2FA prompt on CI) and adds it as the `NPM_TOKEN` repo
  secret: `gh secret set NPM_TOKEN`.

**Verify**: `gh secret list` shows `NPM_TOKEN`.

### Step B2: local install rehearsal (before anything is public on npm)

```
npm pack
npm i -g ./status-herald-*.tgz
herald --version && herald doctor && herald presets
npx -y ./status-herald-*.tgz --version
npm uninstall -g status-herald && rm status-herald-*.tgz
```

This is the full dress rehearsal of both documented install paths against
the exact bytes npm would ship.

**Verify**: every command exits 0; `herald --version` matches
`package.json` version; after uninstall, `which herald` is empty.

### Step B3: first release via release-please **[HUMAN-assisted]**

- Merge the open release-please PR (it exists once conventional commits
  landed on `main`; if absent, check Step A3's Actions permissions first).
- Per the publish.yml header caveat: the tag release-please creates with
  `GITHUB_TOKEN` will NOT trigger publish. The tag already exists on the
  remote at that point, so "push it by hand" is a no-op — use the manual
  trigger instead: `gh workflow run publish.yml --ref vX.Y.Z`.

**Verify**: `gh run watch` on the publish run → success;
`npm view status-herald version` prints the released version; the npm
package page shows the provenance badge ("Built and signed on GitHub
Actions").

### Step B4: post-publish install matrix

On a machine (or clean container: `docker run --rm -it node:20-slim` if
available) verify each documented path:

```
npm i -g status-herald && herald --version
npx -y status-herald@latest --version
```

Cross-check the README install section documents exactly these paths (a
`pnpm add -g status-herald` one-liner is fine if listed; nothing may be
documented that was not just executed).

**Verify**: both commands print the released version; README claims ⊆
verified paths.

## Test plan

- No new test files — this plan's tests are the verification commands: the
  pack audit (A1), the tarball rehearsal (B2), and the post-publish matrix
  (B4). Record actual command outputs in the plan-completion report.
- Regression guard: `node --test` + `npx biome check .` after the
  package.json edit (A2) — the only file this plan changes.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `package.json` has `repository.url` ending in
      `muslewski/status-herald.git`, plus `bugs` and `homepage`
- [ ] `git remote get-url origin` → the GitHub URL; CI green on `main`
- [ ] `npm pack --dry-run` ships no `plans/`, `test/`, or `.github/`
- [ ] `npm view status-herald version` resolves (published)
- [ ] npm package page shows provenance attestation
- [ ] `npx -y status-herald@latest --version` exits 0 and matches
- [ ] README install section lists only verified install paths
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npm view status-herald` resolves to an existing package — the name is
  taken; renaming is an operator decision (identity ripples through
  Plan 008's naming doctrine, the binary, and all docs).
- `gh auth status` fails or the operator's npm account is unavailable —
  every **[HUMAN]** step blocks, none may be faked or skipped.
- The publish run fails on provenance/repository mismatch — fix means
  changing package.json or repo ownership; report, don't force-publish
  without `--provenance`.
- `npm pack --dry-run` includes unexpected files — the `files` allowlist
  drifted; that is a Plan 001 regression to report, not patch around.

## Maintenance notes

- **Deferred channels, revisit on demand**: Homebrew tap and AUR package
  make sense once there are users asking; a single-binary build (Node SEA)
  only if a no-Node-installed audience appears. pip stays permanently
  N/A — wrong ecosystem, and the family convention is npm.
- Once publish is live, the release cadence is fully release-please-driven;
  the only recurring human touch is merging the release PR and (per the
  token caveat) triggering publish. If that friction grates, the fix is a
  fine-grained PAT for release-please so its tags trigger publish — an
  operator security decision, not an executor default.
- If the repo ever moves orgs, `repository.url` must move in the same PR
  or provenance publishing breaks.

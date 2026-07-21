# Contributing to status-herald

Thanks for wanting to help. This guide is the shortest path to a good PR.

## Community

| Kind | Where |
|---|---|
| Questions, ideas, show-and-tell | [Discussions](https://github.com/muslewski/status-herald/discussions) |
| Bugs & concrete feature requests | [Issues](https://github.com/muslewski/status-herald/issues/new/choose) |
| Security | [SECURITY.md](./SECURITY.md) — private only |

Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Dev setup

```bash
git clone https://github.com/muslewski/status-herald.git
cd status-herald
npm install
npm link       # optional: put herald on PATH
```

## Checks before you open a PR

```bash
npm test
npm run lint   # if biome is available
```

### Project constraints

- **Zero runtime dependencies** (dev tooling like Biome is fine under `devDependencies`).
- Keep Claude + Grok curtain behavior working — see `AGENTS.md` and `test/`.
- Prefer small, tested changes over large rewrites of the curtain loop.

## Project mind (informal knowledge base)

This repository keeps a small **[memory-atlas](https://github.com/muslewski/memory-atlas)** vault
(`status-herald-mind/` at the repo root) — plain markdown that maps architecture for **humans and coding agents**.

| | |
|--|--|
| **Convention** | Informal and optional for tiny fixes — **appreciated** when you change how a subsystem works |
| **Why** | Better orientation, higher-quality agent-assisted edits, less “where does this live?” thrash |
| **Not npm** | The mind is **git-only**. It is not shipped in this project’s npm package (if any), and not downloaded when someone installs the separate `memory-atlas` CLI |

**How (when it matters):** open `status-herald-mind/map/index.md` → read the zone you touch → update that zone if ownership or invariants moved → optional `npx memory-atlas stamp <slug>` after you verified → `npx memory-atlas build`. Honest short notes beat silence or fake stamps.

Skip without guilt for typos and drive-by nits. Prefer leaving a PR note if the mind should be updated later rather than inventing ceremony.

## Commit messages

We prefer [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Meaning |
|---|---|
| `feat:` | new capability |
| `fix:` | bug fix |
| `docs:` | documentation only |
| `chore:` / `ci:` / `refactor:` / `test:` | maintenance |

Breaking changes: `feat!:` or a `BREAKING CHANGE:` footer.

## Pull requests

1. Fork and branch from `main`.
2. Keep the diff focused (one concern per PR).
3. Fill in the PR template checklist.
4. Link related issues (`Fixes #123`) when applicable.

## Local install (dogfood)

```bash
npm install -g .
# or: npm link
herald --help
```

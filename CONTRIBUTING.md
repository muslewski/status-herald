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

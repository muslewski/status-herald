# Plan r007: refreshCards must not desync cover/bar via EXIT trap

> Parent: 016. Cluster: C4. Phase: 2. Severity: P1.

**Goal:** `refreshCards` kill of `_curtain` must not leave covered sessions with `@herald_covered=0` (keypress no-op) or wrong bar, because the card EXIT trap calls `reveal`.

## Files
- In scope: `lib/curtain/session.mjs`, `scripts/curtain-card-session.sh`, `test/session.test.mjs`, `test/curtain-card-session.test.mjs`
- Out: 020

## Steps

### Trap coordination
- [ ] Card trap: skip reveal when `@herald_refreshing` is `1`:
```bash
trap 's=$(tmux display -p "#{session_name}" 2>/dev/null); r=$(tmux show -t "$s" -v @herald_refreshing 2>/dev/null || true); [ "$r" = "1" ] || herald curtain reveal "$s" >/dev/null 2>&1 || true' EXIT INT TERM HUP
```
(adjust quoting; fail-open)

- [ ] Test greps trap for `herald_refreshing` or equivalent skip.

### refreshCards
- [ ] Before `killWindow`, `setSessOpt(name, "@herald_refreshing", "1")`.
- [ ] After `newCardWindow`, if `covered`: force `@herald_covered=1`, `applyBar(name, true, t, cfg)`, `selectWindow` card.
- [ ] Always `unsetSessOpt(name, "@herald_refreshing")` after recreate (even if not covered).

### Unit test
- [ ] Extend double so `killWindow` invokes optional `onKill` that calls `reveal` (simulating trap) unless refreshing flag set.
- [ ] Assert after `refreshCards` on covered session: still covered, bar still applied if transparent cfg.

### Verify
```bash
node --test test/session.test.mjs test/curtain-card-session.test.mjs
node --test
./node_modules/.bin/biome check lib/curtain/session.mjs test/session.test.mjs
```

### Commit
`fix(curtain): refreshCards survives card EXIT trap without uncover (r007)`

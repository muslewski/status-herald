# Plan r006: DONE settleAfter relative to state entry

> Parent: 016. Cluster: C4. Phase: 2. Severity: P1.

**Goal:** Style-flavored DONE/COMPACTING animation must breathe after long WORKING sessions. Reset animation tick when `@herald_state` changes in the card loop.

## Evidence
- `pickFrame` freezes when `tick > settleAfter` (`curtain-card.mjs`)
- Loop tick is monotonic from arm (`curtain-card-session.sh:14,40`)
- After ~seconds of WORKING, first DONE paint already has tick ≫ settleAfter

## Files
- In scope: `scripts/curtain-card-session.sh`, `test/curtain-card-session.test.mjs`
- Optionally: `test/curtain-card.test.mjs` if documenting relative-tick contract at pickFrame level only via bash
- Out: 020

## Steps
- [ ] Failing test in `test/curtain-card-session.test.mjs`: script must reset tick when state changes (grep for pattern like `prev_state` / compare state and `tick=0`).

- [ ] Implement in loop after reading `state`:
```bash
prev_state=${prev_state-}
if [ "$state" != "${prev_state}" ]; then
  tick=0
  prev_state=$state
fi
```
Place **before** render so first frame of new state uses tick 0. Keep increment after render.

- [ ] Full suite + biome N/A for bash; `bash -n scripts/curtain-card-session.sh`
- [ ] Commit: `fix(curtain): reset card tick on state change for settleAfter (r006)`

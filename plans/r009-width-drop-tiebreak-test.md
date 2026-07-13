# Plan r009: width-drop multi-drop rightmost tie-break test

> Parent: 018. Cluster: C5. Phase: 3. Severity: P1 (weak-test / false confidence).

**Goal:** Assert multi-item drop order when two items share lowest priority — rightmost drops first — with a width where intermediate survivor string differs.

## Files
- In scope: `test/status-segments.test.mjs` (and `lib/status/segments.mjs` only if test reveals real bug)
- Out: 020

## Steps
- [ ] Add test per plan 018: items like `[{id:'a', text:'AAA', priority:5}, {id:'b', text:'B', priority:1}, {id:'c', text:'C', priority:1}]`, sep two spaces, width fits `AAA  B` only if C dropped first (not B).
- [ ] Optionally deepEqual ROLES table (S, same file).
- [ ] Full suite + biome + commit: `test(status): lock width-drop rightmost multi-drop tie-break (r009)`

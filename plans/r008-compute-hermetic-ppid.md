# Plan r008: compute hermetic fixtures + session ppid

> Parent: 019. Cluster: C6. Phase: 3. Severity: P1.

**Goal:** (1) Token-forecast fixture/tests not wall-clock fragile. (2) Discovery attaches `ppid` from `/proc` status. (3) `buildPerSessionData` accepts injectable dirs for hermetic tests.

## Files
- In scope: `lib/status/compute.mjs`, `lib/status/bridge-token-forecast.mjs`, `test/status-compute.test.mjs`, `test/fixtures/token-forecast-snapshot.json`
- Out: 020 surfaces

## Steps

### F1 fixture clock
- [ ] Either set `resets_at` far future (e.g. `4102444800` year 2100) in fixture, **or** inject `now` into `readAccountUsage`/`windowView`.
- [ ] Prefer injectable `now` for true hermeticity:
```js
export async function readAccountUsage(opts = {}) {
  const now = opts.now ?? Date.now() / 1000;
  ...
}
```
- [ ] Test passes `now: 1783950000` (before fixture resets).

### F2 ppid
- [ ] In `discoverLiveClaudeSessions`, for each live pid set `ppid: readProcStatusPpid(d.pid)` (number or null).
- [ ] Test: discovering with `process.pid` as pid in temp session file includes `ppid` equal to `readProcStatusPpid(process.pid)`.

### F3 injectable buildPerSessionData
- [ ] Signature: `buildPerSessionData(sessionId, panePidForGrok, opts = {})` with `projectsDir`, `metaDir`.
- [ ] Thread into `transcriptPathFor` / `readSessionMeta`.
- [ ] Test with temp dir + minimal jsonl + meta fixture → non-empty context or badge as appropriate.

### Verify
```bash
node --test test/status-compute.test.mjs
node --test
./node_modules/.bin/biome check lib/status/compute.mjs lib/status/bridge-token-forecast.mjs test/status-compute.test.mjs
```

### Commit
`fix(status): hermetic token-forecast + discovery ppid + injectable paths (r008)`

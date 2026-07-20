# Plan r005: focus unit reveal-all only on graceful stop + heartbeat truncate

> Parent: 015. Cluster: C3. Phase: 2. Severity: P1+P2.

**Goal:** (1) Stop mid-blip card flash: do not run `reveal-all` on failure restarts. (2) Truncate event file on heartbeat appends too.

## Files
- In scope: `contrib/systemd/status-herald-curtain.service`, `mac/herald-focus.lua`, `test/focus-agent.test.mjs` (or new small test for unit file content)
- Out: 020, live systemd mutation on operator machine beyond file edits in repo

## Steps

### A — unit file
- [ ] Test (source contract): `status-herald-curtain.service` must not use `ExecStopPost=.*reveal-all` with `Restart=on-failure`. Prefer `ExecStop=` for reveal-all (runs on service stop request, not after crash before restart — verify systemd semantics: ExecStop runs on stop command and before stop of service; for failure, ExecStop also runs on some versions — actually **systemd**: On unclean exit with Restart=, it still runs stop sequence including ExecStopPost. Better approach per auditor: document and use only `ExecStop=` without Post, OR remove reveal-all from unit entirely and rely on stream/poll scripts.

**Correct approach (Linux systemd):**
- `ExecStop=` runs when service is stopped (including before restart on failure in many versions).
- Safer product fix matching "graceful only": **remove** `ExecStopPost=reveal-all`. Poll adapter already reveal-all on clean exit. Stream holds state. Operator can `herald curtain reveal-all` manually. Add comment that failure restart must not flash.

If removing is too strong, replace ExecStopPost with comment + optional oneshot documentation.

Plan choice: **Remove ExecStopPost reveal-all**; update comment to explain mid-blip hold. Poll path still reveal-all on its own exit.

- [ ] Implement removal + comment rewrite (dispatcher/stream/poll, not poll-only).
- [ ] Grep test: unit file has no `ExecStopPost=.*reveal-all`.

### B — heartbeat truncate
- [ ] In `mac/herald-focus.lua`, call `truncateIfLarge()` inside heartbeat before `append`, or at start of `append`.
- [ ] Optional: note in comment.

### Verify
```bash
node --test test/focus-agent.test.mjs test/config.test.mjs
node --test
rg -n 'ExecStopPost|reveal-all' contrib/systemd/status-herald-curtain.service
```

### Commit
`fix(curtain): no reveal-all on unit failure restart; truncate on heartbeat (r005)`

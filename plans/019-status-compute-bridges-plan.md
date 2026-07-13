# Plan 019: Status compute + bridges (session math, discovery, grok detect, token-forecast)

> **For the executor:** REQUIRED — TDD. Write the failing test, run it red, implement minimal, run green, commit. Steps use `- [ ]`. This is sub-plan 2 of the Slice 2 program (`plans/017-herald-native-bars.md`). It ports the data layer and math (pure where possible) only — no tmux side-effects, no status-right writes, no live config mutation. 020 will consume these to wire surfaces.

**Goal:** A set of hermetic (testable with fixtures) compute functions + thin bridges that reproduce the Python `claude_sessions` + `usage_blocks` + sidecar contracts exactly, plus a `/proc` grok detector that supplies `Grok <effort>` labels (and future context for Grok sessions). All I/O is isolated behind narrow facades so unit tests stay fast and deterministic.

**Architecture:** Thin I/O adapters (`grok-adapter`, `bridge-token-forecast`, session fs readers) feed pure math (`latestUsed`, `countMessages`, `computeContext`, `gaugePct` etc.). A small `compute` facade assembles per-session records + account usage for a render call. No globals, paths injectable for tests. Grok sessions degrade gracefully (no context math, no rate_limits).

**Tech Stack:** Node ≥20 ESM, zero runtime deps, `node --test`, biome. Use only `node:fs/promises`, `node:child_process` (execFile for feed hook only), and stdlib. No tmux, no net.

## Global Constraints (from Plan 017)
- **Zero runtime dependencies.** No imports outside `node:*` and repo-local.
- **Verify:** `node --test` and `./node_modules/.bin/biome check lib/status/compute.mjs lib/status/grok-adapter.mjs lib/status/bridge-token-forecast.mjs test/status-compute.test.mjs`. NEVER `npx biome`, NEVER `npm run lint`.
- **Fail-open discipline** — discovery or bridge errors → empty/{} data, never throw to caller (later surfaces must still emit empty stdout + 0).
- **Parity first** — every number, string, sidecar shape, and bucket must match the live Python byte-for-byte on the same inputs (fixtures + real transcript excerpts).
- **Pure math where possible** — transcript parsers take `lines: string[]` or `content: string`; only discovery + bridge do fs/child.
- **Grok graceful** — when no Anthropic transcript/rate_limits, segments that need them simply return null (caller drops them).
- **Performance** — one `/proc` walk + one transcript read per render; reuse data for a call.
- Pure I/O layers do not mutate; tests use tmp dirs + inline fixtures only.

## Parity anchors (exact contracts — pin these; re-verify against live Python before each task)

Read the sources: `~/.claude/claude_sessions.py`, `~/.claude/session-sync.py`, `~/.claude/statusline-context.py`, `~/.claude/usage_limits.py`, `~/token-forecast/src/token_forecast/{ratelimits.py,state.py}`.

**Session discovery (live_sessions + find_session):**
- Scan `~/.claude/sessions/*.json` (or injectable `sessionsDir`).
- Keep only those where `pid` is alive (`os.kill(pid,0)` equiv: `process.kill(pid,0)` succeeds in try).
- Session shape from file: `{ pid, sessionId, cwd, name, status, statusUpdatedAt?, updatedAt? }`.
- `ppid` computed from `/proc/<pid>/status` line `PPid:\tN` (NOT stat).
- `window_for(ppid, panesMap)` climbs ≤4 parents using ppid reads; returns `["sess:win", "window_id"]` or null.
- `transcript_for(sessionId)`: glob `~/.claude/projects/**/<sessionId>.jsonl` (first hit).
- `live` predicate must be stable across calls in one render.

**Transcript math (exact):**
- `latest_used(lines)`: walk reversed, first non-empty JSON with `message.usage`, sum `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. 0 if none.
- `count_messages(lines)`: count `_is_human` (type==="user" && !isMeta && has text content); reset n=0 on `system` + `subtype==="compact_boundary"`.
- `model_from_transcript(lines)`: last assistant message's `message.model`.
- `model_window(modelId)`: 1_000_000 if contains "opus-4" / "sonnet-4" / "1m" etc (see python list), else 200_000.
- `context = (used, win, pct)` where `pct = (used * 100 // win) || 0`.
- `fmt_tokens(n)`: `>=1M` → `X.XM`, else `${n//1000}k`.
- `ctx_bucket(pct)` / gaugeRole used by segments (already in 018).

**Effort sidecar (exact):**
- `~/.claude/session-meta/<sessionId>.json` = `{"model": display_name, "effort": level}` (or "").
- Atomic write in Python (tmp + replace); read must tolerate missing/corrupt → {}.
- `model_badge_short(display, effort)` → "Opus 🧠xhigh", "Sonnet", "Grok xhigh", "".
- `short_model` maps display to family: Opus/Fable/Sonnet/Haiku/Grok or first token.

**Account usage (from claude_sessions.usage_blocks + token_forecast overlay):**
- Primary numbers come from `usage_limits` (local events) + overlay of `token_forecast.ratelimits.{five_hour,weekly}(now)`.
- Returned shape from `usage_blocks(now)`: `(block, weekly, cfg)` where block/weekly have:
  - `used`, `projected_pct`, `secs_to_reset` (or `remaining`), `idle?`, `server_pct?`, `source?`, `stale?`
- cfg: `{fiveHourCap, weeklyCap, ...}`
- The published read artifact for herald bridge (DECISION 2): `~/.local/share/token-forecast/snapshot.json` (or $TOKEN_FORECAST_DATA).
  Shape example: `{"five_hour": {"used_percentage": 12.3, "resets_at": 1234567890.0, "observed_at": ...}, "seven_day": {...}, "resets": [...]}`.
- `feedSnapshot` (write path) delegates to a configurable tiny Python (default no-op best-effort). Never reimplement RL.ingest or append_snapshot shape in Node.

**Grok detection (new, no Python equivalent):**
- Given a `panePid` (the pid tmux reports for the pane), walk self + ≤4 parents via `/proc/<pid>/status` PPid.
- For each, read `/proc/<pid>/cmdline` (split on \0), argv[0] or joined includes "grok" (case-insens, or full path ends with /grok or node ...grok...).
- Extract effort: scan argv for `--effort` next token, or `-e xhigh`, or fall back to "xhigh" when "grok" seen (operator default). Return `{isGrok: true, effort: "xhigh", label: "Grok xhigh"}` or `{isGrok:false}`.
- Used for model badge when no sidecar (and future Grok context source).

**Side-effect scope notes (for 020 awareness):**
- @ctxbar written at both WINDOW and SESSION scope.
- Window rename uses tmux session name (user `prefix+$`), not Claude label.
- Account gauges only in status-right stdout (shared); per-session in @ctxbar.

**Exact visible strings (examples for fixtures):**
- Context: `😬 #[fg=orange]████░░░░ 35% 351k/1M 💬 5#[default]`
- Account slider: `🕐 #[fg=colour46]██░░░░░░ 2.7M/57.0M#[default]`
- (These strings are assembled in 020 from the numbers this plan produces.)

## Fixtures
- Small real excerpts from `~/.claude/projects/.../*.jsonl` (human + assistant + compact_boundary + usage lines) stored as `test/fixtures/transcript-*.jsonl`.
- One "claude-busy.json", "claude-idle.json" session files (sanitized pids).
- `test/fixtures/snapshot-token-forecast.json` for bridge read.
- All tests must pass with `TMPDIR` or injected paths; no reads of real ~/.claude during `node --test` unless explicitly opt-in integration (separate file).

## Files

- Create: `lib/status/compute.mjs`
- Create: `lib/status/grok-adapter.mjs`
- Create: `lib/status/bridge-token-forecast.mjs`
- Create: `test/status-compute.test.mjs`
- Create: `test/fixtures/transcript-claude-sample.jsonl` (minimal valid lines)
- Create: `test/fixtures/session-sample.json`
- Create: `test/fixtures/token-forecast-snapshot.json`
- Modify (later if needed): none in 019; config surface paths belong to 020.

## Interfaces this plan PRODUCES (020+ will import these)

```js
// lib/status/grok-adapter.mjs
export const readProcStatusPpid = (pid) => number | null;
export const climbProcTree = (startPid, maxDepth=4) => number[];  // pids from leaf toward root
export const isGrokProcess = (pid) => boolean;
export const detectGrok = (panePid) => { isGrok: boolean, effort?: string, label?: string };

// lib/status/bridge-token-forecast.mjs
export const readAccountUsage = async (opts = {}) => ({ fiveHour: Usage|null, weekly: Usage|null, caps: {fiveHourCap, weeklyCap} });
export const feedSnapshot = async (claudeStdinData, opts = { command?: string }) => void;  // exec hook, best effort

// lib/status/compute.mjs
export const readLines = (path) => Promise<string[]>;
export const latestUsed = (lines) => number;
export const countMessages = (lines) => number;
export const modelWindow = (modelId) => 1000000 | 200000;
export const computeContext = (lines) => ({ used: number, win: number, pct: number, messages: number });
export const readSessionMeta = (sessionId, metaDir?) => Promise<{model?:string, effort?:string}>;
export const shortModelBadge = (display, effort) => string;  // "Opus 🧠xhigh" | "Grok xhigh" | ...
export const discoverLiveClaudeSessions = async (opts = { sessionsDir, projectsDir }) => Session[];
export const buildPerSessionData = async (sessionId, panePidForGrok?) => ({ context: {...}, modelBadge: string, status: string, ... });
export const getAccountGauges = async () => ({ fiveHour: Slider|null, weekly: Slider|null });
```

`Session` internal shape mirrors Python (used by discovery only).

`Usage` / `Slider` shapes: `{ used, projectedPct, secsToReset, ... }` — match the overlaid dicts from usage_blocks.

## Tasks

### Task 1 — Pure math ports (transcript + context + fmt + buckets)

- [ ] **Step 1 (red):** in `test/status-compute.test.mjs`, add tests for:
  ```js
  import { latestUsed, countMessages, modelWindow, computeContext, fmtTokens } from "../lib/status/compute.mjs";
  // transcript fixture load helper
  const lines = await readFixture("transcript-claude-sample.jsonl");
  assert.equal(latestUsed(lines), 351234);
  assert.equal(countMessages(lines), 5);
  assert.equal(modelWindow("claude-opus-4-8"), 1_000_000);
  assert.equal(modelWindow("claude-3-5-sonnet"), 200_000);
  const ctx = computeContext(lines);
  assert.deepEqual(ctx, {used: 351234, win: 1000000, pct: 35, messages: 5});
  assert.equal(fmtTokens(2700000), "2.7M");
  ```
- [ ] **Step 2:** run `node --test test/status-compute.test.mjs` → fails (no module).
- [ ] **Step 3:** implement the pure fns in `lib/status/compute.mjs` (no fs yet). Port `_is_human`, compact_boundary reset, reversed scan etc. exactly. Export `readFixtureLines` test helper or use node fs in test only.
- [ ] **Step 4:** green + add boundary cases (empty lines, no usage, NaN pct→0, compact_boundary resets count).
- [ ] **Step 5:** commit `feat(status): pure transcript math ports (latestUsed, countMessages, computeContext)`.

### Task 2 — grok-adapter + /proc PPid walk (status file, not stat)

- [ ] **Step 1 (red):** tests (use real /proc/self for some; fake pids for others via mocks or temp? Use direct reads since /proc is stable on linux):
  ```js
  import { readProcStatusPpid, climbProcTree, isGrokProcess, detectGrok } from "../lib/status/grok-adapter.mjs";
  assert.equal(typeof readProcStatusPpid(process.pid), "number");
  const tree = climbProcTree(process.pid);
  assert.ok(tree.length >= 1 && tree[0] === process.pid);
  // grok detection on a non-grok pid returns false
  assert.equal(isGrokProcess(process.pid), false);
  // For positive: we will inject synthetic in test by stubbing fs, or document that positive test uses a crafted fixture pid dir if needed.
  const g = detectGrok(process.pid);
  assert.equal(g.isGrok, false);
  ```
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** implement `grok-adapter.mjs`:
  - `readProcStatusPpid(pid)`: read `/proc/${pid}/status`, parse first `PPid:\t(\d+)` .
  - `climbProcTree(start, max=4)`: collect pids climbing via ppid.
  - `readCmdline(pid)`: read `/proc/.../cmdline`, split('\0'), filter Boolean.
  - `isGrokProcess(pid)`: cmdline some entry matches /grok/i or contains grok binary.
  - `detectGrok(panePid)`: climb, for any pid if isGrokProcess return {isGrok:true, effort: extractEffort(argv), label: `Grok ${effort||''}`.trim() }; else {isGrok:false}.
  - Effort extraction: find `--effort` or `-e` next token; map "xhigh" etc; default "xhigh" only if grok seen and no explicit? (keep conservative — use explicit or empty; operator can configure later).
- [ ] **Step 4:** green. Add a test that forces a "grok-like" argv via a thin fs mock wrapper (or note: positive path exercised in integration later).
- [ ] **Step 5:** commit `feat(status): grok-adapter with /proc/status PPid climb + argv detection`.

### Task 3 — Effort sidecar reader + badge formatting

- [ ] **Step 1 (red):** tests:
  ```js
  const meta = await readSessionMeta("test-sid", "/tmp/meta");
  assert.deepEqual(meta, {});
  // write a temp file in test setup then read
  ```
  plus `shortModelBadge("Opus 4.8 (1M context)", "xhigh") === "Opus 🧠xhigh"`
  `shortModelBadge("claude-sonnet-4-5", "") === "Sonnet"`
  `shortModelBadge("", "") === ""`
  Grok path: `shortModelBadge("Grok build", "xhigh") === "Grok xhigh"` (or handled in detect + badge).
- [ ] **Step 2:** run fails.
- [ ] **Step 3:** implement `readSessionMeta(sessionId, metaDir = "~/.claude/session-meta")` using fs.readFile (async), try/catch → {}. Port `short_model` + `model_badge_short` logic exactly (handle "grok" family too).
- [ ] **Step 4:** green. Test atomic-read tolerance (corrupt json, missing dir).
- [ ] **Step 5:** commit `feat(status): session-meta sidecar reader + shortModelBadge`.

### Task 4 — bridge-token-forecast read (snapshot) + feed hook (exec)

- [ ] **Step 1 (red):** tests:
  ```js
  const usage = await readAccountUsage({ snapshotPath: "test/fixtures/token-forecast-snapshot.json" });
  assert.ok(usage.fiveHour);
  assert.equal(usage.fiveHour.usedPercentage, 12.3);
  assert.equal(usage.caps.fiveHourCap, 220000);  // from cfg or defaults
  // feed is fire-and-forget best effort
  await feedSnapshot({rate_limits: {...}}, {command: "true"}); // no throw
  ```
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** implement `bridge-token-forecast.mjs`:
  - `readSnapshot(path)` → load the json (five_hour / seven_day keys → normalize to internal {usedPercentage, resetsAt, secsToReset, observedAt, stale}).
  - `readAccountUsage(opts)`: read snapshot, compute secs_to_reset etc (mirror _window_view), merge local caps from usage_limits.json or hardcoded DEFAULTS matching python (fiveHourCap 220k, weekly 8M for now — read if possible but keep best-effort).
  - `feedSnapshot(data, {command})`: if command, execFile the command with JSON on stdin (or env), timeout short, ignore errors/stdout. Default command="" → no-op instantly.
- [ ] **Step 4:** green. Fixture snapshot must reproduce a real overlay shape. Add test that unknown snapshot yields nulls (fail-open).
- [ ] **Step 5:** commit `feat(status): token-forecast bridge (read snapshot + exec feed hook)`.

### Task 5 — Discovery + high-level compute facade

- [ ] **Step 1 (red):** tests exercising the full port:
  ```js
  const sessions = await discoverLiveClaudeSessions({ sessionsDir: "test/fixtures" });
  const s = await buildPerSessionData("caa7...", 12345); // grok pid
  assert.ok(s.context && s.modelBadge && "messages" in s);
  const gauges = await getAccountGauges();
  // when no snapshot, gauges may be null or partial
  ```
  Include a fixture-based live session + matching transcript; assert numbers match python on same input.
- [ ] **Step 2:** run fails.
- [ ] **Step 3:** implement `compute.mjs` (re-exports pure math +):
  - `discoverLiveClaudeSessions` using fs.readdir + read + alive check + Session class lite.
  - `buildPerSessionData` loads transcript, computes context+messages, reads meta, runs detectGrok if panePid, assembles badge preferring sidecar.
  - `getAccountGauges` → calls readAccountUsage, shapes for segments (emoji + used etc ready for render).
  - Thin `readLines(path)` async wrapper (used by higher fns).
  - Export a `getRenderContext({sessionId, panePid})` convenience for surfaces.
- [ ] **Step 4:** green on hermetic fixtures. Add a "Grok-only" test path (no transcript → degraded data, badge from detect).
- [ ] **Step 5:** commit `feat(status): compute facade + claude session discovery`.

### Task 6 — Full verification, fixtures, biome, no regressions

- [ ] **Step 1:** `node --test` (the whole suite) → all pass, including prior curtain/status-segments.
- [ ] **Step 2:** `./node_modules/.bin/biome check lib/status/compute.mjs lib/status/grok-adapter.mjs lib/status/bridge-token-forecast.mjs test/status-compute.test.mjs` → 0 (run `--write` only for formatting then recheck).
- [ ] **Step 3:** Manually spot-check parity on one real transcript (use node one-liner or add a temp test) vs the python functions on same data.
- [ ] **Step 4:** `bash -n` any new shell if added (none expected).
- [ ] **Step 5:** commit `feat(status): compute+bridges parity + hermetic tests` (or `test(status): ...` if only tests).
- [ ] **Step 6 (optional but recommended):** Add one small integration test file `test/status-compute.integration.test.mjs` that *does* read real ~/.claude (guarded, skipped in CI unless HERALD_TEST_LIVE=1) — for future 021 parity. Do not make it required for green.

## Done criteria (machine-checkable)
- [ ] `node --test` exits 0; new test file + fixtures present and passing.
- [ ] `./node_modules/.bin/biome check <the new files>` exits 0.
- [ ] Exports listed above are present and exercised.
- [ ] No new runtime deps; I/O strictly behind the three new modules.
- [ ] Fixtures are small committed files (no large real transcripts).
- [ ] On a sample transcript + snapshot fixture, numbers and badges match the Python contract (documented in test comments with "python parity").
- [ ] Grok detect path returns sensible label without crashing on non-grok pids.

## STOP conditions
- If a function requires tmux or writing files outside test tmp, STOP — belongs in 020.
- If changing visibleWidth or segments to make tests pass, STOP — those are already verified.
- If feedSnapshot or read requires a live token-forecast install, make it best-effort (return partial data).
- Never read/write the operator's real ~/.claude/session-meta or live sessions in the default test run.

## Risks to call out in commits
- Transcript glob + jsonl parse must be robust (malformed lines are common).
- /proc on non-Linux: the adapter should no-op gracefully (return false/{}). (We are on linux per env.)
- Concurrent reads of snapshot: use the same best-effort load as Python (no locks needed).

## Next after this plan
After land + review: Plan 020 (surfaces + side-effects + wiring + doctor + config model). 019 commits are safe on the live branch.

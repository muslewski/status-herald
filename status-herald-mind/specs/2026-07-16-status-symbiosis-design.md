# Agent Status Symbiosis — Design

- **Date:** 2026-07-16
- **Status:** Draft for user review
- **Scope:** status-herald curtain reliability rework + optional-integration convention across status-herald, token-oracle, agentic-sage, llm-armory
- **Method:** 7 Grok 4.5 research reports (repo deep-dives ×4, CLI capability matrix, prior art, coupling audit), brainstormed and gated with the user

## 1. Problem statement

Two problems, one design:

1. **The curtain lies.** status-herald's curtain sometimes shows WORKING after the
   session has stopped — worst with Grok CLI. Root causes (research report 01,
   with file:line evidence):
   - **RC1 — leaked synthesized subagent ids (Grok primary).** Claude's `Stop`
     carries `background_tasks[]`, which reconciles the in-flight set to empty.
     Grok's `Stop` carries no task list, so synthesized subagent ids never clear;
     `nextState(Stop)` with `subagents > 0` stays WORKING until the 180s leak
     settle or the next human prompt (`session.mjs:321`, `hook.mjs:262–263`).
   - **RC2 — stuck watchers.** `/loop` and monitor watcher slots block quiet
     settle *forever* (`settle.mjs:83–84`); they clear only on an exact
     `scheduler_delete`/kill-tool classifier match. One missed event = stuck
     WORKING until disarm.
   - **RC3 — silent hook failure.** Hooks not wired / wrong node path fail open
     and the state machine simply never advances.
   - Underlying philosophy: the current design is intentionally **fail-working**
     ("a minute late to DONE beats a minute early", README). That guarantee is
     unachievable across heterogeneous CLIs; the failure mode it produces
     (permanent false WORKING) is worse than the one it prevents.
2. **Four sibling tools, no contract.** status-herald, token-oracle,
   agentic-sage, and llm-armory are open-source siblings that should each work
   standalone and cooperate when co-installed. Today:
   - Herald's bottom-bar token segment reads a **token-forecast** snapshot file
     that token-oracle never writes — the assumed herald↔oracle integration
     does not exist (coupling audit finding #1; `bridge-token-forecast.mjs`).
   - Nobody owns "current model + effort per session"; armory knows it at
     launch, oracle could observe it live, sage and herald both want to show it.
   - Session identity, liveness, and staleness logic are each implemented more
     than once across the repos.

## 2. Locked decisions

Agreed with the user during brainstorming:

| # | Decision |
|---|----------|
| D1 | **Fail-idle with TTL.** Every WORKING claim carries a lease; no fresh evidence → settle. Prefer brief false-idle over stale WORKING. |
| D2 | **Convention spec, no shared code.** A documented file/CLI contract; each repo implements its side independently. Zero hard dependencies between the four tools. |
| D3 | **Break freely, document.** Pre-1.0 posture: no legacy adapters; README/CHANGELOG migration notes where formats/paths change. |
| D4 | **Approach A** — truth-lease curtain core + provider convention (daemon/event-bus explicitly deferred to a possible v2). |
| D5 | **CLI matrix:** implement Claude Code + Grok now; architecture must make Codex/Gemini/OpenCode a one-adapter-file addition. |

## 3. Roles

Each tool owns exactly one kind of truth. Redundancy across repos is resolved by
assigning ownership, not by merging code.

| Tool | Role | Truth it owns |
|---|---|---|
| **agentic-sage** | Session registry + coordination | which sessions are live, zones, claims, liveness |
| **token-oracle** | Usage accounting | tokens, rate limits, **model + effort per session** (new) |
| **llm-armory** | Launch labels | preset / model / effort as launched, worktree, parent |
| **status-herald** | Display | tmux curtain + status bars; pane↔session mapping |

Herald displays; it does not re-derive truths a sibling owns. Siblings never
require herald (or each other) to function.

## 4. Agent Status Providers convention (schema 1)

Normative spec will live at `status-herald/docs/AGENT-STATUS-PROVIDERS.md`.
Tool-neutral naming throughout — no herald branding in paths or env vars, so
providers are not "herald plugins" but generic agent-status providers.

### 4.1 Directory resolution

1. `$AGENT_STATUS_DIR` if set
2. `$XDG_RUNTIME_DIR/agent-status/`
3. `~/.local/state/agent-status/` (fallback when no runtime dir)

### 4.2 Provider heartbeat — `providers/<tool>.json`

```json
{
  "schema": 1,
  "tool": "token-oracle",
  "pid": 1234,
  "ts": 1784200000000,
  "ttl_ms": 30000,
  "capabilities": ["sessions", "ratelimits"]
}
```

Announces "this tool is installed and alive, and offers these capabilities."

### 4.3 Session record — `sessions/<key>.json`

Key: `<source_cli>-<session_id>` (sanitized); fallback `<source_cli>-pid<pid>`.

```json
{
  "schema": 1,
  "source_cli": "grok",
  "session_id": "abc123",
  "pid": 4321,
  "cwd": "/home/user/repo",
  "model": "grok-4.5",
  "effort": "high",
  "preset": "grok-high",
  "written_by": "llm-armory",
  "started_at": 1784200000000,
  "updated_at": 1784200100000,
  "ttl_ms": 60000
}
```

Multiple writers may hold records for the same underlying session (armory writes
at launch; oracle refreshes live). Readers pick the freshest record whose lease
is valid; field-level precedence is reader policy (herald: oracle → armory →
env fallback).

### 4.4 Rules

- **Writes:** atomic (`tmp` + `rename`); refresh cadence ≤ `ttl_ms / 2`.
- **Reads:** lease valid iff `now - ts < ttl_ms` (PID-alive check optional AND);
  expired or absent = feature off; corrupt JSON = absent (log to debug only).
- **Versioning:** additive-only within schema 1; breaking changes bump to
  schema 2 written side-by-side during transition.
- **Soft-fail law:** a reader never lets a provider failure propagate past the
  display element it feeds.

### 4.5 CLI JSON surfaces (second half of the contract)

- **agentic-sage:** existing `sage board --json` / `sage fleet --json` /
  `sage war --json` (schema 1, additive-only). Raw file reads under
  `~/.claude/agentic-sage/` remain unsupported.
- **token-oracle:** new `oracle sessions --json` (live session table) alongside
  the existing `forecast.json` / `ratelimits.json` artifacts, which become the
  single published token contract.

## 5. Herald curtain: truth-lease core

Philosophy inversion (D1): **WORKING is a claim that expires.**

### 5.1 Lease model

Every hold source becomes a lease `{kind, id, expires_at}` stored in the
session-scoped tmux options (same authoritative store as today):

| Lease kind | Created by | Refreshed by | Default TTL (tunable) |
|---|---|---|---|
| `subagent` | `SubagentStart` (incl. synthesized) | any hook activity attributable to the session | 120 s |
| `watcher` (`/loop`, monitor) | scheduler/watch tool classifiers | scheduler activity hooks | 15 min |
| `bg_shell` | task payloads / shell classifiers | task payload updates | 120 s |
| `turn` (thinking / generation) | `UserPromptSubmit`, `PreToolUse`, etc. | every active hook | 120 s |

Expired lease = hold gone; settle proceeds. Watchers are no longer immune to
settle — long TTL, but finite (fixes RC2 structurally).

### 5.2 Grok reconciliation (RC1 structural fix)

`Stop` without a task list **reconciles the synthesized subagent set to empty**
— the same reconciliation point Claude gets from `background_tasks[]`. Lease
expiry remains as backstop for dropped `Stop` events.

### 5.3 Backstops (defense in depth)

1. `SessionEnd` → DONE when no fresh leases.
2. **PID liveness in the card loop:** agent process gone → force settle
   regardless of leases (catches `kill -9`, crashes — no hook fires).
3. Quiet settle (90 s) / leak settle stay as the final net, now applicable to
   all lease kinds. Precedence: lease expiry and settle are independent paths
   to the same outcome — whichever fires first settles; they never hold state
   against each other. (Exact TTL/settle interplay is pinned in the
   implementation plan; the invariant is that no lease kind is exempt.)

### 5.4 Host adapters

- Explicit `hostKind: task_list | synthesis | hybrid` replaces the `tasks_seen`
  bit.
- Per-CLI adapter module: `normalizePayload(raw) → canonical event` for the
  curtain, plus one discovery module per CLI for the bars. Adding
  Codex/Gemini/OpenCode = one new adapter file, zero core edits (D5; hook
  surfaces confirmed for all five CLIs in research report 05).
- The Grok bar adapter loses its hardcoded `status: "busy"`; bar glyph derives
  from the same lease state as the curtain.

### 5.5 Observability (RC3/RC7)

- Settle stamps a health timestamp each run.
- `herald doctor` verifies: hooks wired with absolute node path, settle
  recency, tmux options sane, provider leases fresh. Silent freeze becomes a
  one-command diagnosis.

## 6. Per-repo work

### 6.1 token-oracle

- Session registry: capture model + effort per live session (Claude — parse
  statusline stdin, already on that hot path; Grok — `~/.grok` signals/argv).
  Write session records to the convention dir; ship `oracle sessions --json`.
- Token contract unification: oracle's `forecast.json` / `ratelimits.json` is
  the single published artifact. Herald's bridge re-points to it;
  **token-forecast naming deprecated** (D3 — break freely, migration note).

### 6.2 agentic-sage

- Storage untouched. Emit a provider heartbeat announcing capabilities.
- Optional **war model column**: read oracle session records when fresh
  (`model@effort` per session row); silently absent otherwise.
- Update `docs/interop-status-herald.md` to reference the convention spec.

### 6.3 llm-armory

- Launcher writes a session record at launch (preset, model, effort, worktree,
  parent session); record TTL-expires after child exit.
- Env vars (`LLM_PRESET`, `LLM_GROK`, `GROK_MODEL`, `GROK_EFFORT`,
  `LLM_ARMORY_HOME`) documented as the zero-install fallback detection surface.

### 6.4 status-herald

- Curtain optional lines (config-toggleable): sage zone/claims;
  `model@effort` via freshest-record precedence oracle → armory → env.
- Bar: sage segment via `sage … --json` (cached, off the tmux hot path);
  token segment via oracle artifacts.
- Every provider read cached + soft-fail: a dead provider never freezes bar or
  curtain.

## 7. Data flow (reference scenario)

Armory Grok child in a tmux pane, all four tools installed:

1. `armory grok-high -w foo` → session record
   `{preset: grok-high, model: grok-4.5, effort: high}`.
2. Grok hooks fire → curtain leases refresh → WORKING.
3. Sage emitter registers the session; zone derived from touched globs.
4. Oracle tracks usage; its session record confirms model/effort live.
5. Curtain: `WORKING · grok-4.5@high · zone:lib/curtain · ctx 41%`.
   Sage war shows the same model column.
6. Child dies via `kill -9` (no Stop hook): leases expire + PID backstop →
   curtain DONE within one TTL window.

Partial installs: no oracle → model falls back to armory record/env; no sage →
no zone line; herald alone → curtain + bars, no extras. Nothing errors.

## 8. Error handling

- **Soft-fail law** (§4.4) applies to every reader in every repo.
- **Staleness ladder:** fresh → show; expired → hide (fail-idle);
  corrupt → treat as absent, debug-log only.
- **Atomicity:** writers `tmp` + `rename`; readers schema-validate and tolerate
  torn reads.
- **Diagnosability:** each tool's doctor checks its own side; `herald doctor`
  validates the full chain.
- **Clocks:** single-host convention; wall clock acceptable; TTLs generous
  (≥ 2× writer cadence).

## 9. Testing

- **Herald core:** state-machine tests re-derived for lease semantics — the
  current "Grok Stop keeps WORKING while subagent ids remain" and
  "Stop stays WORKING while watchers > 0" tests flip from documenting the
  behavior to forbidding its unbounded form. Fake-clock TTL tests. Per-CLI
  fixture payloads (Claude, Grok; Codex/Gemini golden samples from research)
  through `normalizePayload`.
- **Contract tests:** JSON-schema golden fixtures for heartbeats and session
  records, *copied* into each repo (no shared dependency) — schema drift breaks
  a test, not a user.
- **Combo matrix smoke:** herald-alone / +sage / +oracle / +armory / all-four —
  absent siblings produce empty segments and zero errors.
- **PID backstop:** spawn dummy process, `kill -9`, assert settle within TTL.

## 10. Documentation (open source)

- Normative spec: `status-herald/docs/AGENT-STATUS-PROVIDERS.md` (versioned).
- Each sibling: short `INTEROP.md` (its side of the contract + spec link).
- Every README: "Works well with" section describing the combo matrix.
- CHANGELOG migration notes for the breaks: herald token-bridge paths,
  token-forecast deprecation, curtain settle behavior change.
- AGENTS.md files updated so future agent sessions know the convention.

## 11. Out of scope / deferred

- `herald serve` daemon / unix-socket push (v2 candidate, per prior-art
  research).
- OSC terminal sequences as detection signals.
- Codex / Gemini / OpenCode adapters (design-ready; not implemented now).
- Backward compatibility with pre-redesign formats (D3).

## 12. Implementation phasing (input to writing-plans)

Each phase is independently shippable and maps to armory Grok executor
children; judgment and review stay with the advisor session.

1. **P1 — herald truth-lease core** (user's acute pain: RC1/RC2/RC3).
2. **P2 — token-oracle:** contract unification + session registry.
3. **P3 — llm-armory:** launch records.
4. **P4 — agentic-sage:** heartbeat + war model column.
5. **P5 — docs sweep** across all four repos.

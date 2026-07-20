# P5 — Cross-Repo Docs Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is split per repo; each repo group is dispatched as its own executor child AFTER that repo's code phase (P1–P4) has merged — docs must describe the code as merged, not as planned.

**Goal:** Every repo documents its side of the Agent Status Providers convention for open-source users: README "Works well with" sections, INTEROP.md files, CHANGELOG migration notes for the breaks, and AGENTS.md updates.

**Architecture:** `status-herald/docs/AGENT-STATUS-PROVIDERS.md` (created in P1 Task 10) is the single normative source. Everything in this plan LINKS to it and never restates schema details (one source of truth; siblings state only their own writer/reader behavior).

**Tech Stack:** Markdown only. No code changes. Gate per repo: existing test suite still green (docs must not touch code), plus a link/path sanity pass.

## Global Constraints

- Verify claims against merged code, not this plan: before writing any statement, read the merged implementation in that repo. Docs that contradict code are plan failures.
- Normative schema lives ONLY in `AGENT-STATUS-PROVIDERS.md`; sibling docs link to it (GitHub URL form: `https://github.com/muslewski/status-herald/blob/main/docs/AGENT-STATUS-PROVIDERS.md` — verify the actual GitHub org/repo slug from each repo's `git remote -v` and use that).
- Tone: match each repo's existing README voice. These are public open-source repos.
- "Works well with" sections describe the combo matrix honestly: each tool standalone-first, extras appear when siblings are installed, nothing errors when absent (spec §7).
- Conventional commits: `docs: …`, one commit per task.
- Do NOT edit code, tests, or config in this plan.

---

### Task 1: status-herald docs

**Files:**
- Modify: `README.md`, `AGENTS.md`
- Create: `CHANGELOG.md` (repo has none yet)

Content:
1. `README.md` — new section **"Works well with"**: token-oracle (token/rate-limit segment + model truth), agentic-sage (zone/claims line + fleet segment), llm-armory (launch labels for children). One paragraph each: what appears on curtain/bar when installed, explicit "herald alone still gives curtain + bars". Link AGENT-STATUS-PROVIDERS.md. Also update any README text still describing the fail-working philosophy ("a minute late to DONE beats a minute early") — the philosophy is now fail-idle with truth leases; rewrite that paragraph truthfully.
2. `CHANGELOG.md` — create with an Unreleased section carrying the migration notes (D3 breaks):
   - curtain settle behavior: WORKING now expires via leases (list the four TTLs + config keys `curtain.lease.*`); watchers no longer block settle forever.
   - removed tmux options (`@herald_bg_*`, `@herald_tasks_seen`) → replaced by `@herald_leases`, `@herald_host_kind`, `@herald_agent_pid`.
   - token feed: default now `~/.local/share/token-oracle/forecast.json` via `bridge-token-oracle.mjs`; `TOKEN_FORECAST_SNAPSHOT` env and token-forecast paths removed; `HERALD_TOKEN_FEED` still overrides.
   - new: `herald doctor`, per-CLI adapters, agent-status provider reader.
3. `AGENTS.md` — verify the P1 edits (new options + config tables) survived merge; fix stale references to removed options anywhere in the file (grep `@herald_bg_`, `tasks_seen`, `token-forecast`).

- [ ] Step 1: Read merged code (`lib/curtain/lease.mjs`, `settle.mjs`, `doctor.mjs`, `lib/status/providers.mjs`, `bridge-token-oracle.mjs`) and `docs/AGENT-STATUS-PROVIDERS.md`.
- [ ] Step 2: Write the three files.
- [ ] Step 3: Sanity: `grep -rn "token-forecast\|@herald_bg_\|tasks_seen" README.md AGENTS.md CHANGELOG.md` → only hits are the CHANGELOG lines describing the removal. `npm test` still green.
- [ ] Step 4: Commit: `docs: works-well-with, changelog migration notes, agents refresh`

---

### Task 2: token-oracle docs

**Files:**
- Create: `INTEROP.md`
- Modify: `README.md`, `CHANGELOG.md`, `AGENTS.md`

Content:
1. `INTEROP.md` — oracle's side of the contract: WRITES provider heartbeat (`providers/token-oracle.json`, capabilities `["forecast","ratelimits","sessions"]`) and session records (Claude via statusline tick, Grok via scanner); PUBLISHES `forecast.json` / `ratelimits.json` (paths) and `oracle sessions --json` (paste the real output schema from the merged CLI); kill switch `TOKEN_ORACLE_NO_AGENT_STATUS=1`. Link the normative spec.
2. `README.md` — "Works well with" section: status-herald (bar token segment + curtain model line read oracle artifacts), agentic-sage (war model column), llm-armory (oracle refreshes what armory stamps at launch). Note the token contract: `forecast.json`/`ratelimits.json` is THE published artifact (token-forecast naming deprecated — one migration sentence pointing at herald's CHANGELOG).
3. `CHANGELOG.md` — Unreleased: `oracle sessions --json` added; agent-status records written; statusline tick now upserts session records (throttled).
4. `AGENTS.md` — short pointer section to INTEROP.md + the new module names.

- [ ] Step 1: Read merged `token_oracle/agent_status.py`, `grok_sessions.py`, CLI sessions subcommand.
- [ ] Step 2: Write files.
- [ ] Step 3: `python -m pytest` still green; links resolve (relative paths exist; GitHub slugs verified via `git remote -v`).
- [ ] Step 4: Commit: `docs: interop contract, works-well-with, changelog`

---

### Task 3: llm-armory docs

**Files:**
- Create: `INTEROP.md`
- Modify: `README.md`, `CHANGELOG.md` (create if absent), `AGENTS.md` (extend the P3 Task 2 section only if drifted)

Content:
1. `INTEROP.md` — armory's side: WRITES launch session record (pid-key naming, field list from merged `bin/llm`, long TTL + reader-must-pid-check rule) + heartbeat; env fallback table (`LLM_PRESET`, `LLM_GROK`, `GROK_MODEL`, `GROK_EFFORT`, `LLM_ARMORY_HOME`) as the zero-install detection surface. Link normative spec.
2. `README.md` — "Works well with": status-herald (curtain shows `model@effort` for armory children), agentic-sage (`SAGE_PARENT` provenance + `parent_session` field), token-oracle (refreshes model truth live after launch). Standalone-first sentence.
3. `CHANGELOG.md` — launch records + heartbeat entry.

- [ ] Step 1: Read merged `bin/llm` helper functions + `tests/test_llm.sh` cases.
- [ ] Step 2: Write files.
- [ ] Step 3: `bash tests/test_llm.sh` still green.
- [ ] Step 4: Commit: `docs: interop contract + works-well-with`

---

### Task 4: agentic-sage docs

**Files:**
- Modify: `docs/interop-status-herald.md`, `README.md`, `CHANGELOG.md`, `AGENTS.md`

Content:
1. `docs/interop-status-herald.md` — rewrite around the convention: sage's CLI JSON (`board/fleet/war --json`, schema 1 additive-only, raw file reads unsupported) is what herald consumes; sage WRITES heartbeat; sage READS oracle/armory session records for the war MODEL column. Link normative spec. Remove any statements the redesign made false (check against merged code).
2. `README.md` — "Works well with": status-herald (fleet segment + curtain zone line via `--json`), token-oracle + llm-armory (war MODEL column). Standalone-first sentence.
3. `CHANGELOG.md` — heartbeat + war model column entries (additive schema note).
4. `AGENTS.md` — pointer to the convention + new `lib/agent-status.mjs`.

- [ ] Step 1: Read merged `lib/agent-status.mjs`, war changes, emitter change.
- [ ] Step 2: Write files.
- [ ] Step 3: `npm test` still green; `sage war --json` still schema-valid.
- [ ] Step 4: Commit: `docs: convention interop rewrite, works-well-with, changelog`

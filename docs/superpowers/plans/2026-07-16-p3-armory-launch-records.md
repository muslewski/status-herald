# P3 — llm-armory Launch Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The armory launcher writes an Agent Status Provider session record (preset, model, effort, worktree, parent) + heartbeat at launch, so any co-installed tool can label armory children without env access.

**Architecture:** `bin/llm` gains three pure-bash helpers (dir resolution, JSON escaping, atomic record write) called immediately before the final `exec`. Because `exec` replaces the launcher, `$$` **is** the child pid — records carry a long TTL (12h) plus `pid`, and the convention obliges readers to pid-check `written_by: "llm-armory"` records (that is how "record expires after child exit" works without a refresher process).

**Tech Stack:** Pure bash (no jq, no python dependency in the launch path). Existing test harness: `tests/test_llm.sh`.

**Repo:** `~/Repositories/llm-armory`. Convention spec: `status-herald/docs/AGENT-STATUS-PROVIDERS.md`.

## Global Constraints

- Pure bash in `bin/llm`; no new dependencies.
- **Soft-fail law:** record writing must NEVER break or delay a launch. Every helper call site guarded (`|| true`); helpers themselves `return 0` on any failure. An unwritable status dir must leave launches fully functional (test-enforced).
- Atomic writes: `mktemp` **in the destination directory** + `mv -f` (same-filesystem rename).
- Schema 1, additive-only; field names exactly as in the JSON below.
- Gates: `bash tests/test_llm.sh` green at every commit (run it first to learn the harness; extend, don't restructure).
- Conventional commits, one per task.
- Do not touch preset semantics, preflight logic, or `sanitize_parent_loadout`.

## File Structure

```
bin/llm            MOD  + agent-status helpers, called pre-exec for grok AND claude launches
.gitignore         MOD  + .claude/worktrees/  (currently missing in this repo)
tests/test_llm.sh  MOD  + record-write and soft-fail test cases
tests/fixtures/agent_status/session-armory.json  NEW  golden fixture
```

Read first: `bin/llm` in full (note where the grok vs claude exec branches are and which env vars a resolved preset exports: `LLM_PRESET`, `GROK_MODEL`, `GROK_EFFORT`, …), `presets/grok-high.env`, `tests/test_llm.sh` (harness pattern), `AGENTS.md`.

---

### Task 1: Agent-status helpers + launch-record write

**Files:**
- Modify: `bin/llm`, `.gitignore`
- Create: `tests/fixtures/agent_status/session-armory.json`
- Test: `tests/test_llm.sh` (new cases)

**Interfaces (bash functions in `bin/llm`):**

```bash
# 1. $AGENT_STATUS_DIR  2. $XDG_RUNTIME_DIR/agent-status  3. ~/.local/state/agent-status
agent_status_dir() {
  if [[ -n "${AGENT_STATUS_DIR:-}" ]]; then printf '%s' "$AGENT_STATUS_DIR"
  elif [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then printf '%s/agent-status' "$XDG_RUNTIME_DIR"
  else printf '%s/.local/state/agent-status' "$HOME"
  fi
}

# minimal JSON string escaping: backslash, double-quote, newline/tab → \\ \" \n \t
json_escape() { ... }

# atomic: mktemp in dest dir + mv -f; every failure path returns 0 (soft-fail)
write_agent_status_record() {
  local child_cli=$1   # "grok" | "claude"
  ...
}
```

Record written to `<dir>/sessions/<child_cli>-pid$$.json` (no session id exists pre-exec — pid-key fallback per convention):

```json
{
  "schema": 1,
  "source_cli": "grok",
  "pid": 12345,
  "cwd": "/home/user/repo",
  "model": "grok-4.5",
  "effort": "high",
  "preset": "grok-high",
  "worktree": "my-feature",
  "parent_session": "sage-parent-id-if-any",
  "written_by": "llm-armory",
  "started_at": 1784200000000,
  "updated_at": 1784200000000,
  "ttl_ms": 43200000
}
```

Field sources: `model` = `$GROK_MODEL` (grok) / the model env the claude branch exports (read `bin/llm` to find it; empty → omit the key); `effort` = `$GROK_EFFORT` (omit when empty); `preset` = resolved loadout name; `worktree` = the `-w` argument when present (omit otherwise); `parent_session` = `$SAGE_PARENT` (omit when empty); timestamps = `$(date +%s%3N)`; `ttl_ms` fixed 43200000. Omit-when-empty keeps the JSON valid without null handling.

Heartbeat `<dir>/providers/llm-armory.json` written in the same helper pass:

```json
{ "schema": 1, "tool": "llm-armory", "pid": 12345, "ts": 1784200000000, "ttl_ms": 43200000, "capabilities": ["launch"] }
```

Call site: in BOTH exec branches (grok and claude), directly before `exec`:

```bash
write_agent_status_record "grok" || true
exec grok ...
```

- [ ] **Step 1:** Add `.claude/worktrees/` to `.gitignore` (this repo is the only sibling missing it).
- [ ] **Step 2: Failing tests** — extend `tests/test_llm.sh` following its existing case pattern (it already fakes launches; if it stubs the child binary via PATH shim, reuse that; otherwise add a `LLM_TEST_NO_EXEC=1` guard that makes `bin/llm` `return` right before `exec` — grep the harness first):

```bash
# case: launch writes a valid session record
export AGENT_STATUS_DIR="$tmpdir/as"
run_launcher grok-high -p "noop"           # harness helper / stubbed child
rec="$AGENT_STATUS_DIR/sessions/grok-pid$child_pid.json"
[[ -f "$rec" ]] || fail "record not written"
python3 -m json.tool "$rec" >/dev/null || fail "record not valid JSON"
grep -q '"written_by": "llm-armory"' "$rec" || fail "missing written_by"
grep -q '"model": "grok-4.5"' "$rec" || fail "missing model pin"
grep -q '"preset": "grok-high"' "$rec" || fail "missing preset"

# case: unwritable status dir does not break launch (soft-fail law)
export AGENT_STATUS_DIR="$tmpdir/ro"; mkdir -p "$AGENT_STATUS_DIR"; chmod 0400 "$AGENT_STATUS_DIR"
run_launcher grok-high -p "noop" || fail "launch must survive unwritable status dir"

# case: worktree + parent fields
export SAGE_PARENT="parent-1"
run_launcher grok-high -w my-feature -p "noop"
grep -q '"worktree": "my-feature"' ... && grep -q '"parent_session": "parent-1"' ...

# case: json escaping (cwd with quotes/spaces survives python3 -m json.tool)
```

(`python3 -m json.tool` is a test-only validator — fine in tests, banned in `bin/llm` itself.)

- [ ] **Step 3:** `bash tests/test_llm.sh` — new cases FAIL.
- [ ] **Step 4:** Implement the three helpers + both call sites.
- [ ] **Step 5:** `bash tests/test_llm.sh` — ALL cases pass (old + new).
- [ ] **Step 6:** Commit: `feat: launch writes agent-status session record + heartbeat (schema 1)`

---

### Task 2: Document the zero-install env fallback surface

**Files:**
- Modify: `AGENTS.md` (agent-facing note; full README/INTEROP docs land in P5 — do NOT write them here)

Add a short section "Agent status conventions" to `AGENTS.md`:
- Records: path pattern, pid-key naming, long-TTL + reader-must-pid-check rule.
- Env fallback table (the zero-install detection surface, spec §6.3): `LLM_PRESET`, `LLM_GROK`, `GROK_MODEL`, `GROK_EFFORT`, `LLM_ARMORY_HOME` — one line each: who sets it, what a detector may infer.
- Kill switch: setting `AGENT_STATUS_DIR=/dev/null` effectively disables writes (soft-fail swallows it) — state this explicitly.

- [ ] **Step 1:** Write the section (match the file's existing tone/format).
- [ ] **Step 2:** `bash tests/test_llm.sh` still green.
- [ ] **Step 3:** Commit: `docs(agents): agent-status records + env fallback surface`

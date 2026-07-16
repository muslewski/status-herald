# P2 — token-oracle Session Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** token-oracle becomes the live owner of "model (+ effort) per session": it writes Agent Status Provider heartbeats + session records and ships `oracle sessions --json`.

**Architecture:** New `token_oracle/agent_status.py` implements the convention (dir resolution, atomic writes, freshness reads). The Claude statusline hot path (already invoked on every statusline tick with model info on stdin) upserts that session's record, throttled. A Grok scanner derives live Grok sessions from `~/.grok/active_sessions.json` + `/proc` argv. `oracle sessions --json` merges fresh records into a stable schema-1 table.

**Tech Stack:** Python (this repo: `pyproject.toml`, pytest, ruff). Zero new dependencies — stdlib only (`json`, `os`, `pathlib`, `tempfile`, `time`).

**Repo:** `~/Repositories/token-oracle`. Convention spec: `status-herald/docs/AGENT-STATUS-PROVIDERS.md` (schema mirrors the JSON below; carry your own fixture copies — no cross-repo imports).

## Global Constraints

- Stdlib only; no new runtime deps.
- Gates: `python -m pytest` and `ruff check .` green at every commit.
- **Soft-fail law:** status-dir writes/reads must never break oracle's primary job. Every convention I/O path wrapped; failure → skip silently (debug log at most). The statusline hot path especially must not slow down or crash (see repo plan `002-emitter-hot-path-cost.md`-style concerns in siblings; same spirit here).
- Atomic writes: `tempfile` in same directory + `os.replace`.
- Lease validity: `now_ms - ts < ttl_ms`. Corrupt JSON = absent.
- Schema 1, additive-only. Field names exactly as in the JSON examples below.
- Conventional commits, one per task.
- Existing artifacts `forecast.json` / `ratelimits.json` are untouched by this plan (they are already the published token contract; herald re-points in its own repo).

## File Structure

```
token_oracle/agent_status.py     NEW  convention dir/read/write primitives
token_oracle/grok_sessions.py    NEW  live Grok session discovery (pid+argv)
token_oracle/cli entrypoint      MOD  add `sessions` subcommand (find the existing
                                      argv dispatcher — same place statusline/snapshot register)
statusline ingest module         MOD  upsert session record on each tick (locate the
                                      module that parses statusline stdin JSON — it
                                      writes ratelimits.json today)
tests/test_agent_status.py       NEW
tests/test_grok_sessions.py      NEW
tests/test_sessions_cli.py       NEW
tests/fixtures/agent_status/**   NEW  golden schema fixtures (own copies)
```

Read first: `token_oracle/core/config.py`, `token_oracle/core/ratelimits.py` (statusline ingest path), `token_oracle/snapshot/writer.py` (atomic-write idiom already used), the CLI dispatcher, `AGENTS.md`, `ADAPTERS.md`.

---

### Task 1: `agent_status.py` convention primitives

**Files:**
- Create: `token_oracle/agent_status.py`
- Test: `tests/test_agent_status.py`

**Interfaces (later tasks + siblings rely on these exact names):**

```python
SCHEMA = 1
TOOL = "token-oracle"
HEARTBEAT_TTL_MS = 30_000
SESSION_TTL_MS = 60_000

def resolve_status_dir(env: dict | None = None) -> Path:
    """1. $AGENT_STATUS_DIR  2. $XDG_RUNTIME_DIR/agent-status  3. ~/.local/state/agent-status"""

def atomic_write_json(path: Path, obj: dict) -> bool:
    """mkdir -p parent; tempfile in same dir + os.replace. True on success, False on ANY failure."""

def read_fresh_json(path: Path, now_ms: int) -> dict | None:
    """None if absent, corrupt, or now_ms - obj['ts'] >= obj['ttl_ms'] (session records use
    'updated_at' as ts field)."""

def write_heartbeat(dir: Path, now_ms: int, pid: int, capabilities: list[str]) -> bool:
    """providers/token-oracle.json; throttled: skip (return True) if existing file mtime
    is younger than HEARTBEAT_TTL_MS/2."""

def session_key(source_cli: str, session_id: str | None, pid: int) -> str:
    """'<source_cli>-<session_id>' sanitized to [A-Za-z0-9._-]; fallback '<source_cli>-pid<pid>'."""

def write_session_record(dir: Path, record: dict) -> bool:
    """sessions/<key>.json; fills schema/written_by/updated_at/ttl_ms defaults; throttled like heartbeat."""

def list_fresh_sessions(dir: Path, now_ms: int) -> list[dict]:
    """All fresh session records in dir/sessions/, corrupt/expired skipped."""
```

Heartbeat JSON written (fixture `tests/fixtures/agent_status/heartbeat.json`):

```json
{
  "schema": 1,
  "tool": "token-oracle",
  "pid": 1234,
  "ts": 1784200000000,
  "ttl_ms": 30000,
  "capabilities": ["forecast", "ratelimits", "sessions"]
}
```

Session record (fixture `tests/fixtures/agent_status/session-claude.json`):

```json
{
  "schema": 1,
  "source_cli": "claude",
  "session_id": "def456",
  "pid": 4321,
  "cwd": "/home/user/repo",
  "model": "claude-fable-5",
  "written_by": "token-oracle",
  "started_at": 1784200000000,
  "updated_at": 1784200100000,
  "ttl_ms": 60000
}
```

(`effort` is an optional key — present for Grok records, absent for Claude.)

- [ ] **Step 1: Failing tests** — `tests/test_agent_status.py` using `tmp_path` + `monkeypatch`:

```python
def test_dir_resolution_order(monkeypatch, tmp_path):
    assert resolve_status_dir({"AGENT_STATUS_DIR": "/x"}) == Path("/x")
    assert resolve_status_dir({"XDG_RUNTIME_DIR": "/run/u"}) == Path("/run/u/agent-status")
    d = resolve_status_dir({})
    assert str(d).endswith(".local/state/agent-status")

def test_atomic_write_and_fresh_read(tmp_path):
    p = tmp_path / "providers" / "token-oracle.json"
    obj = {"schema": 1, "ts": 1000, "ttl_ms": 30000}
    assert atomic_write_json(p, obj)
    assert read_fresh_json(p, now_ms=1000 + 29999) == obj
    assert read_fresh_json(p, now_ms=1000 + 30000) is None  # expired

def test_corrupt_json_is_absent(tmp_path):
    p = tmp_path / "x.json"; p.write_text("{nope")
    assert read_fresh_json(p, now_ms=0) is None

def test_write_failure_is_soft(tmp_path):
    ro = tmp_path / "ro"; ro.mkdir(); ro.chmod(0o400)
    assert atomic_write_json(ro / "sub" / "f.json", {"a": 1}) is False  # no raise

def test_session_key_sanitization():
    assert session_key("grok", "abc/12:3", 9) == "grok-abc_12_3"
    assert session_key("grok", None, 9) == "grok-pid9"

def test_heartbeat_matches_golden(tmp_path):
    write_heartbeat(tmp_path, now_ms=1784200000000, pid=1234,
                    capabilities=["forecast", "ratelimits", "sessions"])
    got = json.loads((tmp_path / "providers" / "token-oracle.json").read_text())
    golden = json.loads(Path("tests/fixtures/agent_status/heartbeat.json").read_text())
    assert got == golden
```

- [ ] **Step 2:** `python -m pytest tests/test_agent_status.py` — FAIL.
- [ ] **Step 3:** Implement (reuse the atomic-write idiom from `snapshot/writer.py`).
- [ ] **Step 4:** pytest + `ruff check .` — PASS.
- [ ] **Step 5:** Commit: `feat: agent-status provider primitives (schema 1)`

---

### Task 2: Statusline hot path upserts Claude session records

**Files:**
- Modify: the statusline ingest module (the code path that today parses statusline stdin JSON and writes `ratelimits.json` — locate via `core/ratelimits.py` and the CLI `statusline` subcommand)
- Test: `tests/test_agent_status.py` additions (or a dedicated test module beside the existing statusline tests — follow the existing test layout)

**Interfaces:**
- Consumes Task 1: `resolve_status_dir`, `write_heartbeat`, `write_session_record`, `session_key`.
- Claude statusline stdin JSON carries (among other fields): `session_id`, `model` (object with `id` and `display_name`), `workspace.current_dir` — inspect an existing fixture/test payload in this repo for the exact shape and reuse it.

Behavior: after the existing ingest succeeds, best-effort (wrapped, soft-fail):
1. `write_heartbeat(dir, now_ms, os.getpid(), ["forecast", "ratelimits", "sessions"])`
2. `write_session_record(dir, {"source_cli": "claude", "session_id": ..., "pid": <statusline payload pid if present, else parent pid>, "cwd": workspace.current_dir, "model": model.id, "started_at": <first-write time>})` — throttling inside `write_session_record` keeps this off the hot path (≤1 write / 30s per session).
- A flag/env kill-switch: `TOKEN_ORACLE_NO_AGENT_STATUS=1` skips all convention writes (document in `--help` text or module docstring).

- [ ] **Step 1:** Failing test: feed the repo's existing sample statusline payload through the ingest entrypoint with `AGENT_STATUS_DIR=tmp_path`; assert `sessions/claude-<id>.json` exists with `model` == payload model id and heartbeat exists. Second call within 30s (fake clock/mtime) does not rewrite (mtime unchanged). With `TOKEN_ORACLE_NO_AGENT_STATUS=1` → no files.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** pytest + ruff — PASS. Also run the real `oracle statusline` once with sample stdin; confirm no stderr noise.
- [ ] **Step 5:** Commit: `feat: statusline tick upserts claude session records + heartbeat`

---

### Task 3: Grok live-session scanner

**Files:**
- Create: `token_oracle/grok_sessions.py`
- Test: `tests/test_grok_sessions.py`

**Interfaces:**

```python
def discover_grok_sessions(grok_home: Path, proc_root: Path = Path("/proc"),
                           now_ms: int | None = None) -> list[dict]:
    """Returns session-record dicts (source_cli='grok') for live Grok CLI processes.
    - read grok_home/'active_sessions.json' (list of {pid, cwd, sessionId,...} — inspect the real
      file on this machine at ~/.grok/active_sessions.json for exact keys; herald's
      lib/status/grok-adapter.mjs discoverLiveGrokSessions is the reference reader)
    - keep entries whose pid is alive (proc_root/<pid> exists)
    - model/effort parsed from proc_root/<pid>/cmdline argv: value after '--model' /
      '--effort'; fallback env-style GROK_MODEL in /proc/<pid>/environ is OUT of scope
      (permission-fragile); missing → model 'grok', no effort key
    """
```

All filesystem roots injectable (`grok_home`, `proc_root`) so tests build fake trees under `tmp_path` — no real `/proc` in tests.

- [ ] **Step 1:** Failing tests: fake `active_sessions.json` with two entries; fake `proc/<pid>/cmdline` (`grok\0--model\0grok-4.5\0--effort\0high\0`) for one pid, absent dir for the other → one record `{source_cli: "grok", model: "grok-4.5", effort: "high", ...}`; corrupt `active_sessions.json` → `[]`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** pytest + ruff — PASS.
- [ ] **Step 5:** Commit: `feat: grok live-session discovery (pid + argv model/effort)`

---

### Task 4: `oracle sessions --json`

**Files:**
- Modify: CLI dispatcher (add `sessions` subcommand next to `statusline`/`snapshot`)
- Test: `tests/test_sessions_cli.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces stdout (stable schema 1, additive-only — this is a published CLI surface, spec §4.5):

```json
{
  "schema": 1,
  "generated_at": 1784200200000,
  "sessions": [
    {
      "source_cli": "grok",
      "session_id": "abc123",
      "pid": 4321,
      "cwd": "/home/user/repo",
      "model": "grok-4.5",
      "effort": "high",
      "written_by": "token-oracle",
      "age_ms": 5000
    }
  ]
}
```

Behavior of the subcommand:
1. Refresh: run `discover_grok_sessions(~/.grok)` and `write_session_record` each result (own records refreshed at read time; Claude records come from statusline ticks).
2. Read back: `list_fresh_sessions(dir, now)` — includes records written by OTHER tools (armory) too; dedupe by `session_key` preferring `written_by: token-oracle`, then freshest.
3. Print the JSON above (`--json` required for machine output; without flag print a small human table).
4. Also `write_heartbeat` on each invocation.
Exit 0 with `"sessions": []` when nothing is live or the dir is unreadable (soft-fail).

- [ ] **Step 1:** Failing test: with `AGENT_STATUS_DIR=tmp_path` pre-seeded with one fresh record + one expired + one corrupt, run the CLI entry function → JSON contains exactly the fresh one; `schema == 1`; exit 0 on empty/unreadable dir.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** pytest + ruff — PASS. Live check: `oracle sessions --json` on this machine (Grok/Claude sessions likely live) — paste output to PROGRESS.md.
- [ ] **Step 5:** Commit: `feat: oracle sessions --json live session table`

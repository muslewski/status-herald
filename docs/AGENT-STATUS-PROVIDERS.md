---
title: "Agent status providers"
description: "Tool-neutral filesystem convention for optional peer heartbeats and session records."
section: reference
order: 30
---

# Agent Status Providers convention

**Schema 1 — 2026-07-16**

Tool-neutral filesystem convention for agent CLIs and companion tools to publish
liveness and session metadata. **Zero shared code** between writers and readers:
each tool ships its own copy of this schema. Paths and env vars carry no
product branding (not “herald plugins”).

Purpose: let optional siblings (token-oracle, agentic-sage, llm-armory, status-herald)
discover each other when co-installed, without hard dependencies. Absent providers
mean empty features, never errors. Token-oracle’s separate `forecast.json` feed is what
powers herald **bar gauges** — see [Works with](./works-with.md).

---

## 1. Directory resolution

Readers and writers resolve the root directory in this order:

1. `$AGENT_STATUS_DIR` if set  
2. `$XDG_RUNTIME_DIR/agent-status/`  
3. `~/.local/state/agent-status/` (fallback when no runtime dir)

Layout under the root:

```
providers/<tool>.json     # heartbeats
sessions/<key>.json       # session records
```

---

## 2. Provider heartbeat — `providers/<tool>.json`

Announces “this tool is installed and alive, and offers these capabilities.”

### Example

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

### Field table

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `schema` | number | yes | Schema major version; currently `1` |
| `tool` | string | yes | Provider id (`token-oracle`, `agentic-sage`, `llm-armory`, …) |
| `pid` | number | yes | Process id of the writing process |
| `ts` | number | yes | Write timestamp, **unix milliseconds** |
| `ttl_ms` | number | yes | Lease duration in ms; reader treats record as live iff `now - ts < ttl_ms` |
| `capabilities` | string[] | no | Capability tags (`sessions`, `ratelimits`, `fleet`, `war`, …) |

Golden fixtures: `test/fixtures/agent-status/providers/token-oracle.json`,
`.../agentic-sage.json`.

---

## 3. Session record — `sessions/<key>.json`

Describes one agent session (model, effort, cwd, pid). Multiple writers may hold
records for the same underlying session (e.g. armory at launch, oracle live).

### Key derivation

1. Preferred: `<source_cli>-<session_id>`  
2. Fallback: `<source_cli>-pid<pid>`  
3. Sanitize to `[A-Za-z0-9._-]` (replace other characters).

Examples: `grok-abc123.json`, `claude-def456.json`.

### Example

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

### Field table

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `schema` | number | yes | Schema major version; currently `1` |
| `source_cli` | string | yes | Host CLI (`grok`, `claude`, …) |
| `session_id` | string | yes | Host session id (or synthetic) |
| `pid` | number | yes* | Agent process id (*required for long-TTL launch records from armory) |
| `cwd` | string | no | Working directory at stamp time |
| `model` | string | yes | Model id / display family |
| `effort` | string | no | Reasoning effort (`high`, `xhigh`, …) |
| `preset` | string | no | Launcher preset name (armory) |
| `written_by` | string | yes | Writer id (`token-oracle`, `llm-armory`, …) |
| `started_at` | number | no | Session start, unix ms |
| `updated_at` | number | yes | Last refresh, unix ms (used for lease + freshest pick) |
| `ttl_ms` | number | yes | Lease duration ms; valid iff `now - updated_at < ttl_ms` (or `ts` if used) |

Golden fixtures: `test/fixtures/agent-status/sessions/grok-abc123.json`,
`claude-def456.json`, `grok-abc123-armory.json`, `corrupt.json` (invalid → absent).

---

## 4. Writer rules

1. **Atomic writes:** write to `*.tmp` then `rename` onto the final path.  
2. **Cadence:** refresh at least every `ttl_ms / 2` while the process is live.  
3. **Long-TTL launch records** (armory): must include `pid`. Readers may require
   the process still be alive (`kill(pid, 0)`; EPERM counts alive).  
4. Do not delete peer tools’ files; expire by TTL only.  
5. `schema` must be `1` for this document; do not invent fields that break
   additive-only rules (unknown fields are ignored by schema-1 readers).

---

## 5. Reader rules

1. **Lease validity:** `now_ms - ts < ttl_ms` (heartbeats use `ts`; session
   records use `updated_at`, falling back to `started_at` / `ts` if needed).  
2. **Corrupt JSON = absent.** Never throw past the display element.  
3. **Soft-fail law:** a reader never lets a provider failure propagate past the
   display element it feeds. Missing dir → `[]`; missing file → skip.  
4. **Field precedence is reader policy.** Herald’s policy for model lines:
   `token-oracle` session records → `llm-armory` (with pid alive) → env hint
   (`GROK_MODEL` / `LLM_PRESET` + optional `GROK_EFFORT`).  
5. No caching is required in the convention; callers may cache.

---

## 6. Versioning

- **Schema 1:** additive-only. New optional fields are fine; required-field
  removals or meaning changes require schema 2.  
- **Schema 2:** written side-by-side (`schema: 2` files or parallel paths)
  during transition; schema-1 readers ignore schema-2 files.

---

## 7. Known writers and readers

| Tool | Role | Notes |
|------|------|--------|
| **status-herald** | reader | Curtain model line, bar glyph/context; `lib/status/providers.mjs` |
| **token-oracle** | writer (+ CLI) | Heartbeat + session records; `forecast.json` is separate artifact under `~/.local/share/token-oracle/` |
| **llm-armory** | writer | Launch session records (long TTL + pid) |
| **agentic-sage** | writer + CLI | Heartbeat; fleet/war/board via `sage … --json` (not raw files) |

Normative location for this document in the herald tree:
`docs/AGENT-STATUS-PROVIDERS.md`. Sibling repos should link here or carry a
verbatim copy of schema 1.

---

## 8. Related herald knobs (non-normative)

- Env: `AGENT_STATUS_DIR`, `XDG_RUNTIME_DIR`  
- Herald token bar feed: `~/.local/share/token-oracle/forecast.json`  
- Herald feed hook override: `HERALD_TOKEN_FEED`  
- Design: `docs/superpowers/specs/2026-07-16-status-symbiosis-design.md` §4  

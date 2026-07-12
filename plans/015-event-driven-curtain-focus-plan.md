# Event-driven Curtain Focus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design spec:** `plans/015-event-driven-curtain-focus.md` — read it first.

**Goal:** Replace the Mac-focus *poll* (osascript over ssh every `pollMs`) with an *event-driven* path: a Mac Hammerspoon emitter fires on Ghostty focus/title change and appends the title to a file; a Manjaro systemd adapter streams that file over the existing ssh direction and drives `herald curtain focus`.

**Architecture:** Three new artifacts + two edits. Mac: `mac/herald-focus.lua` (Hammerspoon emitter). Manjaro: `scripts/focus-agent/ghostty-hammerspoon-stream.sh` (streaming adapter) and `scripts/focus-agent/run.sh` (dispatcher that picks poll-vs-stream from `curtain.focus.source`). Edits: `lib/config.mjs` gains `eventFile`/`heartbeatSec`; the systemd unit's `ExecStart` points at the dispatcher; README documents the new adapter. The box (`herald curtain focus` + cover/reveal) is unchanged — only *when* and *how* the focus signal arrives changes.

**Tech Stack:** Node ≥20 ESM (zero runtime deps), `node --test`, `@biomejs/biome`; bash + `ssh` + `node -e` for adapters (house pattern, already used by the poll adapter); Lua for the Hammerspoon emitter (runs only on the Mac).

## Global Constraints

- **Zero runtime dependencies** — hard invariant. Adapters may shell to `ssh`/`node`/`tail` only (as the poll adapter already does).
- **Verification gates**: `npm test` (i.e. `node --test`) green; `./node_modules/.bin/biome check <changed .mjs>` exit 0. Do NOT use `npx biome` (fetches the wrong version) or `npm run lint` (output mangled by the rtk proxy).
- **Poll adapter stays** the committed default (`source: "ssh-osascript"`) and the agent-free fallback. This plan adds a second adapter; it does not remove or change the poll adapter's behavior.
- **`classic` theme byte-identical** — untouched here; do not edit render/theme code.
- **Do NOT disturb running tmux sessions.** Operator's standing constraint (verbatim): *"for some reason all my tmuxes suddenly diued. so do not make such stuff for me. a lot of stuff are running sessions."* Back up config before mutating; the only service this plan may stop/restart is `status-herald-curtain.service`.
- **Hammerspoon `.app` install on the Mac is a gated, confirmed step** (Task 7) — never automatic.
- **`eventFile` is a Mac path expanded by the *remote* shell** — use `$HOME`, never `~` (tilde does not expand inside the double-quoted remote `tail` command). This exact string is shared by the config default, the stream adapter default, and the README; keep them identical: `$HOME/.local/state/status-herald/focus-events`.
- **Commit only when the task says so**; do not push or open a PR unless the operator asks.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `lib/config.mjs` | Modify | Add `eventFile` + `heartbeatSec` defaults under `curtain.focus`. |
| `test/config.test.mjs` | Modify | Assert new defaults + a `ghostty-hammerspoon` override merge. |
| `mac/herald-focus.lua` | Create | Hammerspoon emitter: fire on Ghostty focus/title change, append title (or `""`) to the event file, heartbeat, self-truncate. |
| `scripts/focus-agent/ghostty-hammerspoon-stream.sh` | Create | Manjaro adapter: startup osascript sync, then `tail -n0 -F` the event file over ssh → `herald curtain focus`. |
| `scripts/focus-agent/run.sh` | Create | Dispatcher: read `curtain.focus.source`, exec the poll or stream adapter. `--print` dry-run for tests. |
| `test/focus-agent.test.mjs` | Create | Drive `run.sh --print` with a stub `herald` on PATH; assert adapter selection. |
| `contrib/systemd/status-herald-curtain.service` | Modify | `ExecStart` → the dispatcher. |
| `README.md` | Modify | New config keys, event-driven adapter setup, cutover, updated "write your own adapter". |

---

## Task 1: Config keys — `eventFile` + `heartbeatSec`

**Files:**
- Modify: `lib/config.mjs:9-15` (the `focus` block of `DEFAULTS`)
- Test: `test/config.test.mjs`

**Interfaces:**
- Consumes: nothing (leaf).
- Produces: `loadConfig().curtain.focus.eventFile` (string, default `"$HOME/.local/state/status-herald/focus-events"`) and `.heartbeatSec` (number, default `20`). The stream adapter (Task 3) and dispatcher (Task 4) read these via `herald config`.

- [ ] **Step 1: Write the failing tests**

Append to `test/config.test.mjs`:

```js
test("curtain focus defaults carry the event-driven adapter knobs", () => {
  const f = loadConfig("/nonexistent/does-not-exist.json").curtain.focus;
  assert.equal(f.source, "ssh-osascript");
  assert.equal(f.eventFile, "$HOME/.local/state/status-herald/focus-events");
  assert.equal(f.heartbeatSec, 20);
});

test("loadConfig honors a hammerspoon focus source override", () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-cfg-"));
  const p = join(dir, "c.json");
  writeFileSync(
    p,
    JSON.stringify({
      curtain: { focus: { source: "ghostty-hammerspoon", eventFile: "/tmp/ev" } },
    }),
  );
  try {
    const f = loadConfig(p).curtain.focus;
    assert.equal(f.source, "ghostty-hammerspoon");
    assert.equal(f.eventFile, "/tmp/ev");
    assert.equal(f.heartbeatSec, 20, "unset keys keep defaults");
    assert.equal(f.terminalApp, "ghostty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/config.test.mjs`
Expected: FAIL — `f.eventFile` is `undefined` (key not yet in DEFAULTS).

- [ ] **Step 3: Add the defaults**

In `lib/config.mjs`, change the `focus` block of `DEFAULTS.curtain` to:

```js
    focus: {
      source: "ssh-osascript",
      pollMs: 350,
      eventFile: "$HOME/.local/state/status-herald/focus-events",
      heartbeatSec: 20,
      ssh: { host: "mac-music", connectTimeout: 4 },
      terminalApp: "ghostty",
      titleStripPrefixes: ["[mosh] "],
    },
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test test/config.test.mjs`
Expected: PASS (all config tests, including the two new ones).

- [ ] **Step 5: Full suite + lint**

Run: `npm test && ./node_modules/.bin/biome check lib/config.mjs test/config.test.mjs`
Expected: all tests pass (was 171, now 173); biome exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/config.mjs test/config.test.mjs
git commit -m "feat(curtain): config keys for event-driven focus (eventFile, heartbeatSec)"
```

---

## Task 2: Mac emitter — `mac/herald-focus.lua`

Promotes the Phase-0 spike (`mac/herald-spike.lua`) into the production emitter. Lua runs only on the Mac (Hammerspoon), so it is not `node`-testable; verification is a syntax parse + deferred live integration (Task 7).

**Files:**
- Create: `mac/herald-focus.lua`

**Interfaces:**
- Consumes: nothing at build time. At runtime, appends lines to `$HOME/.local/state/status-herald/focus-events` on the Mac (must match `curtain.focus.eventFile` expanded to the Mac's home).
- Produces: the event file's line protocol — one raw Ghostty window title per focus/title change, `""` (empty line) when a non-Ghostty app is frontmost, and `__hb__ <unix-ts>` heartbeat lines every `heartbeatSec`. The stream adapter (Task 3) reads exactly this protocol.

- [ ] **Step 1: Write the emitter**

Create `mac/herald-focus.lua`:

```lua
-- status-herald event-driven focus emitter (Hammerspoon).
-- Promotes mac/herald-spike.lua into the production emitter. Fires the instant
-- a Ghostty window/tab is focused or its title changes, appends the raw title
-- to EVENT_FILE, and appends "" when a non-Ghostty app takes focus. A Manjaro
-- adapter streams EVENT_FILE over ssh (tail -n0 -F) into `herald curtain focus`.
--
-- Install: copy to ~/.hammerspoon/herald-focus.lua and add this line to
-- ~/.hammerspoon/init.lua:
--     dofile(hs.configdir .. "/herald-focus.lua")
-- Then reload Hammerspoon (hs.reload() in the console, or the menubar item).
--
-- The constants below MUST match curtain.focus on the box: EVENT_FILE is
-- curtain.focus.eventFile with $HOME expanded to the Mac's home; APP_NAME is
-- curtain.focus.terminalApp (capitalized as the macOS app name); HEARTBEAT_SEC
-- is curtain.focus.heartbeatSec.

local APP_NAME      = "Ghostty"
local EVENT_FILE    = os.getenv("HOME") .. "/.local/state/status-herald/focus-events"
local HEARTBEAT_SEC = 20
local MAX_BYTES     = 64 * 1024 -- truncate the event file once it grows past this

-- mkdir -p the parent dir (ignore errors if it already exists).
hs.execute("mkdir -p '" .. EVENT_FILE:match("(.*)/[^/]*$") .. "'")

local last = nil -- dedup: only write when the emitted value changes

local function truncateIfLarge()
  local f = io.open(EVENT_FILE, "r")
  if not f then return end
  local size = f:seek("end")
  f:close()
  if size and size > MAX_BYTES then
    local w = io.open(EVENT_FILE, "w")
    if w then w:close() end
  end
end

local function append(line)
  local f = io.open(EVENT_FILE, "a")
  if not f then return end
  f:write(line .. "\n")
  f:close()
end

-- Emit a focus title (deduped). nil/"" means "no Ghostty window is frontmost".
local function emit(title)
  title = title or ""
  if title == last then return end
  last = title
  truncateIfLarge()
  append(title)
end

-- Ghostty window focus + title changes -> emit that window's title. Both are
-- needed: switching between Ghostty windows fires windowFocused; switching
-- tabs inside one window fires only windowTitleChanged (the window's title
-- changes to the active tab).
local wf = hs.window.filter.new(false):setAppFilter(APP_NAME, {})
wf:subscribe(hs.window.filter.windowFocused, function(w)
  emit(w and w:title() or "")
end)
wf:subscribe(hs.window.filter.windowTitleChanged, function(w)
  emit(w and w:title() or "")
end)

-- App activation: non-Ghostty -> "" (box covers all); Ghostty -> its focused
-- window's title (covers switching back to Ghostty from another app).
local appWatcher = hs.application.watcher.new(function(name, event, app)
  if event == hs.application.watcher.activated then
    if name == APP_NAME then
      local w = app and app:focusedWindow()
      emit(w and w:title() or "")
    else
      emit("")
    end
  end
end)
appWatcher:start()

-- Heartbeat: proves the emitter is alive so the reader's read-timeout is tripped
-- only by a *dead* emitter, not an idle one. Not a focus event -> the reader
-- skips lines beginning with "__hb__".
local heartbeat = hs.timer.doEvery(HEARTBEAT_SEC, function()
  append("__hb__ " .. os.time())
end)

-- Keep references alive past this chunk's scope (Hammerspoon GCs otherwise).
_G.heraldFocus = { wf = wf, appWatcher = appWatcher, heartbeat = heartbeat }

-- Emit current state once at load so the box is correct immediately (and after
-- every hs.reload()).
do
  local app = hs.application.frontmostApplication()
  if app and app:name() == APP_NAME then
    local w = app:focusedWindow()
    emit(w and w:title() or "")
  else
    emit("")
  end
end

print("herald-focus emitter armed -> " .. EVENT_FILE)
```

- [ ] **Step 2: Syntax-check (best-effort)**

Run: `command -v luac >/dev/null && luac -p mac/herald-focus.lua && echo SYNTAX-OK || echo "luac absent — syntax validated on the Mac at hs.reload() (Task 7)"`
Expected: `SYNTAX-OK`, or the fallback note if `luac` is not installed on the box. (Do NOT install packages to satisfy this; the authoritative check is `hs.reload()` on the Mac in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add mac/herald-focus.lua
git commit -m "feat(curtain): Hammerspoon focus emitter (event-driven, replaces poll)"
```

---

## Task 3: Manjaro stream adapter — `ghostty-hammerspoon-stream.sh`

**Files:**
- Create: `scripts/focus-agent/ghostty-hammerspoon-stream.sh`

**Interfaces:**
- Consumes: `curtain.focus.{ssh.host, ssh.connectTimeout, terminalApp, eventFile, heartbeatSec}` via `herald config`; the event-file line protocol from Task 2.
- Produces: repeated `herald curtain focus "<title>"` calls; a `--once` mode that prints the current frontmost title and exits (parity with the poll adapter's `--once`); exit code 1 on stream end / dead-emitter so systemd restarts it.

- [ ] **Step 1: Write the adapter**

Create `scripts/focus-agent/ghostty-hammerspoon-stream.sh` (make it executable in Step 2):

```bash
#!/usr/bin/env bash
# Event-driven focus adapter: stream the Mac's Ghostty focus events (emitted by
# the Hammerspoon herald-focus emitter) over ssh and drive `herald curtain
# focus`. Config-driven (herald config). Replaces the poll adapter's per-tick
# osascript with a single long-lived `tail -n0 -F` of the emitter's event file.
set -u
ONCE=0
while [ $# -gt 0 ]; do case "$1" in
  --once) ONCE=1;;
  *) echo "usage: $0 [--once]" >&2; exit 2;; esac; shift; done

cfg() { herald config 2>/dev/null | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).curtain.focus;process.stdout.write(String(process.argv[1].split(".").reduce((o,k)=>o?.[k],c)??""))}catch{}})' "$1"; }

HOST="$(cfg ssh.host)";            HOST="${HOST:-mac-music}"
CTMO="$(cfg ssh.connectTimeout)";  CTMO="${CTMO:-4}"
APP="$(cfg terminalApp)";          APP="${APP:-ghostty}"
EVENTFILE="$(cfg eventFile)";      EVENTFILE="${EVENTFILE:-\$HOME/.local/state/status-herald/focus-events}"
HB="$(cfg heartbeatSec)";          HB="${HB:-20}"
RTMO=$(( 2 * HB + 5 ))

SSH=(ssh -o ConnectTimeout="$CTMO" -o BatchMode=yes
     -o ServerAliveInterval=15 -o ServerAliveCountMax=3
     -o ControlMaster=auto -o ControlPath=/tmp/cm-shcurtain-%r@%h:%p -o ControlPersist=30s "$HOST")

# One-shot sync read of the current frontmost title -- identical to the poll
# adapter's read, so state is correct immediately and after every restart/gap.
read_title() {
  "${SSH[@]}" "osascript -e 'tell application \"System Events\"
    set fp to first process whose frontmost is true
    if name of fp is \"$APP\" then
      try
        return title of front window of fp
      on error
        return \"\"
      end try
    else
      return \"\"
    end if
  end tell'" 2>/dev/null
}

if [ "$ONCE" = 1 ]; then read_title; echo; exit 0; fi

# Initial sync before subscribing to the stream.
herald curtain focus "$(read_title)" 2>/dev/null

# Stream the emitter's event file. Real line -> focus. Heartbeat lines
# (__hb__ ...) only keep the stream warm and are skipped. `read -t` fires when
# nothing (not even a heartbeat) arrives within 2*heartbeatSec+5s -> the emitter
# is dead -> fall through and exit nonzero so systemd restarts + re-syncs.
# EXPANSION: $EVENTFILE is a variable value ($HOME/...); bash does not re-expand
# it locally, so the remote shell expands $HOME inside the double quotes.
"${SSH[@]}" "tail -n0 -F \"$EVENTFILE\"" 2>/dev/null | while IFS= read -r -t "$RTMO" line; do
  case "$line" in
    __hb__*) continue ;;
  esac
  herald curtain focus "$line" 2>/dev/null
done

# Stream ended or read timed out. Exit nonzero for systemd Restart=on-failure.
# Do NOT reveal-all here: a transient blip must hold last state (the resync on
# restart corrects it); the service's ExecStopPost owns reveal-all on a real stop.
exit 1
```

- [ ] **Step 2: Make executable + syntax-check**

Run: `chmod +x scripts/focus-agent/ghostty-hammerspoon-stream.sh && bash -n scripts/focus-agent/ghostty-hammerspoon-stream.sh && echo SYNTAX-OK`
Expected: `SYNTAX-OK`.

- [ ] **Step 3: Verify the `--once` read path is non-mutating (safe, read-only)**

Run: `scripts/focus-agent/ghostty-hammerspoon-stream.sh --once`
Expected: prints the Mac's frontmost Ghostty title (blank if Ghostty is not frontmost) — same output shape as `ghostty-ssh-poll.sh --once`. No tmux/curtain mutation. (If the Hammerspoon emitter is not yet installed this still works — `--once` uses the osascript read, not the event file.)

- [ ] **Step 4: Commit**

```bash
git add scripts/focus-agent/ghostty-hammerspoon-stream.sh
git commit -m "feat(curtain): ghostty-hammerspoon streaming focus adapter"
```

---

## Task 4: Dispatcher — `run.sh` (+ node test)

**Files:**
- Create: `scripts/focus-agent/run.sh`
- Test: `test/focus-agent.test.mjs`

**Interfaces:**
- Consumes: `curtain.focus.source` via `herald config`; the two adapter scripts by filename in its own directory.
- Produces: with no args, `exec`s the selected adapter; with `--print`, prints `"<source> -> <adapter-path>"` and exits 0 (the test seam). `HERALD_FOCUS_AGENT_DIR` overrides where it looks for the adapters (defaults to the script's own dir, so it works from the repo and from the installed `~/.local/share/status-herald`).

- [ ] **Step 1: Write the failing test**

Create `test/focus-agent.test.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const RUN = fileURLToPath(
  new URL("../scripts/focus-agent/run.sh", import.meta.url),
);
const AGENT_DIR = dirname(RUN);

// run.sh --print with a stub `herald` on PATH that reports the given source.
const printFor = (source) => {
  const dir = mkdtempSync(join(tmpdir(), "herald-stub-"));
  const stub = join(dir, "herald");
  const json = JSON.stringify({ curtain: { focus: { source } } });
  writeFileSync(stub, `#!/usr/bin/env bash\ncat <<'JSON'\n${json}\nJSON\n`);
  chmodSync(stub, 0o755);
  try {
    return execFileSync("bash", [RUN, "--print"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        HERALD_FOCUS_AGENT_DIR: AGENT_DIR,
      },
    }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("run.sh selects the poll adapter for ssh-osascript", () => {
  assert.match(printFor("ssh-osascript"), /ssh-osascript -> .*ghostty-ssh-poll\.sh$/);
});

test("run.sh selects the stream adapter for ghostty-hammerspoon", () => {
  assert.match(
    printFor("ghostty-hammerspoon"),
    /ghostty-hammerspoon -> .*ghostty-hammerspoon-stream\.sh$/,
  );
});

test("run.sh falls back to the poll adapter for an unknown source", () => {
  assert.match(printFor("who-knows"), /ghostty-ssh-poll\.sh$/);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test test/focus-agent.test.mjs`
Expected: FAIL — `run.sh` does not exist yet (execFileSync throws ENOENT).

- [ ] **Step 3: Write the dispatcher**

Create `scripts/focus-agent/run.sh` (make executable in Step 4):

```bash
#!/usr/bin/env bash
# Focus-adapter dispatcher. Reads curtain.focus.source from `herald config` and
# execs the matching reference adapter. The systemd unit's ExecStart points
# here, so switching adapters is a config edit + `systemctl --user restart`,
# never a unit-file edit. `--print` reports the choice without exec (test seam).
set -u

# Adapters live next to this script by default; overridable so the installed
# copy under ~/.local/share/status-herald resolves too.
DIR="${HERALD_FOCUS_AGENT_DIR:-$(cd "$(dirname "$0")" && pwd)}"

SOURCE="$(herald config 2>/dev/null | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).curtain.focus.source||""))}catch{}})')"
SOURCE="${SOURCE:-ssh-osascript}"

case "$SOURCE" in
  ghostty-hammerspoon) ADAPTER="$DIR/ghostty-hammerspoon-stream.sh" ;;
  ssh-osascript | *)   ADAPTER="$DIR/ghostty-ssh-poll.sh" ;;
esac

if [ "${1:-}" = "--print" ]; then
  echo "$SOURCE -> $ADAPTER"
  exit 0
fi

exec bash "$ADAPTER" "$@"
```

- [ ] **Step 4: Make executable, run the test, verify it passes**

Run: `chmod +x scripts/focus-agent/run.sh && node --test test/focus-agent.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Full suite + lint**

Run: `npm test && ./node_modules/.bin/biome check test/focus-agent.test.mjs`
Expected: all tests pass (now 176); biome exit 0. (`biome` lints only the `.mjs` test; the shell scripts are out of biome's scope, like the existing poll adapter.)

- [ ] **Step 6: Commit**

```bash
git add scripts/focus-agent/run.sh test/focus-agent.test.mjs
git commit -m "feat(curtain): focus-adapter dispatcher (source -> poll|stream)"
```

---

## Task 5: Point the systemd unit at the dispatcher

**Files:**
- Modify: `contrib/systemd/status-herald-curtain.service:1,12`

**Interfaces:**
- Consumes: `run.sh` (Task 4) installed to `~/.local/share/status-herald/run.sh`.
- Produces: a unit that runs the dispatcher instead of the poll script directly — identical behavior while `source` is `ssh-osascript`.

- [ ] **Step 1: Edit the unit template**

In `contrib/systemd/status-herald-curtain.service`:

Change line 1 (Description):
```
Description=status-herald per-tab curtain focus agent (dispatcher: poll or event stream)
```

Change the `ExecStart` line (was `.../ghostty-ssh-poll.sh`):
```
ExecStart=/usr/bin/env bash %h/.local/share/status-herald/run.sh
```

Leave `ExecStartPre` (`herald curtain arm-all`), `ExecStopPost` (`herald curtain reveal-all`), `Restart=on-failure`, and `RestartSec` unchanged.

- [ ] **Step 2: Verify the template**

Run: `grep -n "run.sh\|ExecStartPre\|ExecStopPost" contrib/systemd/status-herald-curtain.service`
Expected: `ExecStart` names `run.sh`; `ExecStartPre`/`ExecStopPost` still present.

- [ ] **Step 3: Commit**

```bash
git add contrib/systemd/status-herald-curtain.service
git commit -m "feat(curtain): run focus dispatcher from the systemd unit"
```

*(Deploying the edited unit to `~/.config/systemd/user/` and restarting the live service is Task 7 — gated, non-destructive.)*

---

## Task 6: Documentation

**Files:**
- Modify: `README.md` — config reference (add keys), a new event-driven adapter subsection, the systemd install block, and the "write your own adapter" note.

**Interfaces:**
- Consumes: everything above (final names/paths).
- Produces: operator-facing docs. No code contract.

- [ ] **Step 1: Extend the config reference**

In `README.md`, in the `focus` JSON block of the config reference (around line 158), add the two keys so it reads:

```json
  "focus": {
    "source": "ssh-osascript",
    "pollMs": 350,
    "eventFile": "$HOME/.local/state/status-herald/focus-events",
    "heartbeatSec": 20,
    "ssh": { "host": "mac-music", "connectTimeout": 4 },
    "terminalApp": "ghostty",
    "titleStripPrefixes": ["[mosh] "]
  },
```

Update the `focus.source` bullet and add two bullets after the `focus.pollMs` bullet:

```
- `focus.source` — which reference adapter the dispatcher (`run.sh`) runs:
  `"ssh-osascript"` (poll, the default + agent-free fallback) or
  `"ghostty-hammerspoon"` (event-driven stream; needs the Mac emitter).
- `focus.pollMs` — how often the **poll** adapter re-reads the frontmost tab
  title (ignored by the event-driven adapter).
- `focus.eventFile` — path **on the Mac** the Hammerspoon emitter appends to and
  the stream adapter tails. Expanded by the remote shell, so use `$HOME`, not
  `~` (tilde does not expand inside the quoted remote `tail`).
- `focus.heartbeatSec` — how often the emitter writes a keepalive line; the
  stream adapter treats no line for `2*heartbeatSec+5`s as a dead emitter and
  restarts.
```

- [ ] **Step 2: Add the event-driven adapter subsection**

Insert after the `### ssh-poll quickstart` section (before `### systemd install`):

````markdown
### Event-driven (Hammerspoon) adapter

The poll adapter reads the Mac ~every `pollMs`; the event-driven adapter reacts
the instant a Ghostty window/tab is focused, with **zero** idle cost. It needs a
small emitter running on the Mac (Hammerspoon) plus `source: "ghostty-hammerspoon"`.

```bash
# On the Mac:
# 1. Install Hammerspoon (https://www.hammerspoon.org) and grant it
#    Accessibility (System Settings -> Privacy & Security -> Accessibility).
# 2. Install the emitter and load it from your Hammerspoon config:
mkdir -p ~/.hammerspoon
cp mac/herald-focus.lua ~/.hammerspoon/herald-focus.lua      # from a repo checkout
printf '\ndofile(hs.configdir .. "/herald-focus.lua")\n' >> ~/.hammerspoon/init.lua
# 3. Reload Hammerspoon (console: hs.reload()). The console prints
#    "herald-focus emitter armed -> <event file>".

# On the box: point the config at the stream adapter, then restart the service.
#   curtain.focus.source = "ghostty-hammerspoon"
```

The emitter's `EVENT_FILE`, `APP_NAME`, and `HEARTBEAT_SEC` constants must match
`curtain.focus.eventFile` (with `$HOME` expanded), `terminalApp`, and
`heartbeatSec`. The stream adapter falls back to a one-shot osascript read on
startup and after any reconnect, so state is always correct even across a Mac
sleep or a Hammerspoon restart.
````

- [ ] **Step 3: Update the systemd install block**

In `### systemd install`, change the copy commands to install the dispatcher and both adapters (the unit now runs `run.sh`):

```bash
mkdir -p ~/.local/share/status-herald ~/.config/systemd/user
cp scripts/focus-agent/run.sh \
   scripts/focus-agent/ghostty-ssh-poll.sh \
   scripts/focus-agent/ghostty-hammerspoon-stream.sh \
   ~/.local/share/status-herald/
cp contrib/systemd/status-herald-curtain.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now status-herald-curtain
```

- [ ] **Step 4: Update "write your own adapter"**

Replace the `mac/herald-spike.lua` paragraph (around line 278) with:

```
`mac/herald-focus.lua` is the shipped event-driven adapter: a Hammerspoon
(`hs.window.filter` + `hs.application.watcher`) emitter that appends the
frontmost Ghostty title to an event file the moment focus changes, which
`scripts/focus-agent/ghostty-hammerspoon-stream.sh` tails over ssh into `herald
curtain focus` — no polling, no per-event ssh round trip. See "Event-driven
(Hammerspoon) adapter" above. `mac/herald-spike.lua` remains as the minimal
Phase-0 demo.
```

- [ ] **Step 5: Verify the docs**

Run: `grep -c "ghostty-hammerspoon\|eventFile\|herald-focus.lua\|heartbeatSec" README.md`
Expected: ≥ 6 matches.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs(curtain): event-driven Hammerspoon focus adapter + config keys"
```

---

## Task 7: Live rollout (GATED — operator confirmation required)

Not a code commit — this is the operational cutover on the operator's live machines. It is gated by the standing safety constraint and the Hammerspoon-install confirmation. Execute only with the operator present/approving; touch **only** `status-herald-curtain.service` and the Mac.

**Preconditions:** Tasks 1–6 committed; `npm test` green.

- [ ] **Step 1: Back up config (non-destructive)**

```bash
cp ~/.config/status-herald/config.json ~/.config/status-herald/config.json.bak-$(date +%s)
```

- [ ] **Step 2: Install the Mac emitter — CONFIRM FIRST**

Confirm with the operator before touching the Mac. Then, per README "Event-driven (Hammerspoon) adapter": install Hammerspoon if absent (`brew install --cask hammerspoon` or the .dmg), grant Accessibility, copy `mac/herald-focus.lua` to `~/.hammerspoon/`, add the `dofile` line to `init.lua`, and `hs.reload()`.

Verify (read-only, from the box): after switching a couple of Ghostty windows, the event file grows:
```bash
ssh mac-music 'tail -n 5 "$HOME/.local/state/status-herald/focus-events"'
```
Expected: recent title lines and `__hb__ <ts>` heartbeats.

- [ ] **Step 3: Deploy the box-side scripts**

```bash
cp scripts/focus-agent/run.sh \
   scripts/focus-agent/ghostty-ssh-poll.sh \
   scripts/focus-agent/ghostty-hammerspoon-stream.sh \
   ~/.local/share/status-herald/
cp contrib/systemd/status-herald-curtain.service ~/.config/systemd/user/
```

- [ ] **Step 4: Flip the source + restart (non-destructive cutover)**

Set `curtain.focus.source` to `"ghostty-hammerspoon"` in `~/.config/status-herald/config.json`, then:
```bash
systemctl --user daemon-reload
systemctl --user restart status-herald-curtain   # ExecStopPost reveals all first -> no stuck cards
systemctl --user status status-herald-curtain    # confirm active
journalctl --user -u status-herald-curtain -n 20 # confirm it streamed the startup sync
```

- [ ] **Step 5: Integration checklist (from the spec)**

1. Arm sessions (`herald curtain arm-all` runs via `ExecStartPre`); switch Ghostty windows → reveal < 120 ms (target ≈70–100).
2. Switch tabs *within* one Ghostty window → reveal (proves `windowTitleChanged`).
3. Focus Safari (or any non-Ghostty app) → every armed session covers.
4. `killall Hammerspoon` on the Mac → within `2*heartbeatSec+5`s the reader times out, systemd restarts, the startup sync restores correct state; relaunch Hammerspoon → live again.
5. Confirm no `osascript` poll process idles on the Mac in event mode: `ssh mac-music 'pgrep -fl osascript'` returns nothing steady-state.

- [ ] **Step 6: Rollback path (document, do not run unless needed)**

If anything misbehaves: set `source` back to `"ssh-osascript"` and `systemctl --user restart status-herald-curtain`. The poll adapter is untouched, so this is a clean revert with no card left stuck (ExecStopPost reveals all on the restart).

---

## Self-Review

**Spec coverage** (each spec section → task):
- Data flow / emitter → Task 2. Stream adapter (sync, tail, heartbeat-skip, read-timeout, no reveal-all on exit) → Task 3. Dispatcher → Task 4. Config keys (`source`/`eventFile`/`heartbeatSec`) → Task 1. systemd lifecycle ownership → Task 5. Config default stays `ssh-osascript` → Task 1 (unchanged) + asserted. Fallback intact → Task 4 test + Task 7 rollback. Docs → Task 6. Rollout safety / Hammerspoon gating / non-destructive cutover → Task 7. Robustness (dead SSH, dead emitter, blip holds state) → Task 3 code + Task 7 checklist. Done criteria → Task 7 Step 5. **No gaps.**

**Placeholder scan:** every code step carries complete code; every command has an expected result. None of the forbidden patterns present.

**Type/name consistency:** `curtain.focus.eventFile` / `heartbeatSec` / `source: "ghostty-hammerspoon"` identical across Tasks 1, 3, 4, 6. Event-file path string `$HOME/.local/state/status-herald/focus-events` identical in config default (T1), stream adapter default (T3), README (T6); the Lua (T2) builds the same path from `os.getenv("HOME")`. Heartbeat sentinel `__hb__` emitted in T2, skipped in T3. Read-timeout `2*heartbeatSec+5` consistent (T3 `RTMO`, T6 docs, T7 checklist). Adapter filenames match between `run.sh` (T4) and the files created in T2/T3. `HERALD_FOCUS_AGENT_DIR` used identically in `run.sh` (T4) and its test (T4).

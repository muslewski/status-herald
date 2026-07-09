# HERALD Curtain — OSS Config + ssh-poll Adapter Plan (Slice 2′)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** Make the per-tab curtain a configurable, environment-agnostic OSS feature: a zero-dep config layer, a config-driven pluggable focus trigger (ship the proven ssh-osascript Ghostty poller), `arm-all`, and opt-in `systemd --user` deployment.

**Architecture:** New `lib/config.mjs` (XDG JSON, defaults baked, hook-safe) feeds the CLI. The box contract `herald curtain focus "<title>"` is unchanged; the CLI boundary normalizes the incoming title per config (`titleStripPrefixes`) and gates all per-tab verbs on `curtain.enabled`. The reference adapter `scripts/focus-agent/ghostty-ssh-poll.sh` reads config and drives `focus` on tab change. `session.mjs` core stays pure/exact-match.

**Tech Stack:** Node ≥20 ESM (`node:*`, `node:test`), tmux, bash, ssh (ControlMaster), systemd --user (opt-in).

**Source spec:** `docs/superpowers/specs/2026-07-09-herald-per-tab-curtain-design.md` (see the OSS addendum).

## Global Constraints
- Zero runtime deps; ESM `.mjs`; `node:*` only; Node≥20; `node:test`; biome (`lineWidth: 80`).
- Hook-safe everywhere: bad config / missing file / broken tmux ⇒ defaults or no-op, never a throw.
- `session.mjs` core stays pure (exact-match `focus`); all config coupling lives in `lib/config.mjs` and the CLI boundary.
- Config path: `HERALD_CONFIG` else `${XDG_CONFIG_HOME:-~/.config}/status-herald/config.json`. Absent ⇒ `DEFAULTS`.
- Push only when the user asks. Commit per task.

---

## Task 1: config loader + `herald config`

**Files:** Create `lib/config.mjs`; Modify `lib/cli.mjs`; Create `test/config.test.mjs`.

**Interfaces — Produces:** `DEFAULTS` (plain object), `loadConfig(path?)→config`, `stripTitle(raw, prefixes)→string`.

- [ ] **Step 1: failing tests** — `test/config.test.mjs`:
```js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, loadConfig, stripTitle } from "../lib/config.mjs";

test("loadConfig returns DEFAULTS when the file is absent", () => {
  assert.equal(loadConfig(join(tmpdir(), "nope-herald-xyz.json")).curtain.enabled, true);
  assert.deepEqual(loadConfig(join(tmpdir(), "nope-herald-xyz.json")).curtain.coverableStates, ["working", "done", "needs"]);
});

test("loadConfig deep-merges overrides onto defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-cfg-"));
  const p = join(dir, "c.json");
  writeFileSync(p, JSON.stringify({ curtain: { enabled: false, focus: { pollMs: 200 } } }));
  try {
    const c = loadConfig(p);
    assert.equal(c.curtain.enabled, false);
    assert.equal(c.curtain.focus.pollMs, 200);
    assert.equal(c.curtain.focus.terminalApp, "ghostty", "unspecified keys keep defaults");
    assert.deepEqual(c.curtain.coverableStates, ["working", "done", "needs"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("loadConfig falls back to DEFAULTS on bad JSON (no throw)", () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-cfg-"));
  const p = join(dir, "c.json");
  writeFileSync(p, "{ not json");
  try { assert.equal(loadConfig(p).curtain.enabled, DEFAULTS.curtain.enabled); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("stripTitle removes the first matching prefix and trims", () => {
  assert.equal(stripTitle("[mosh] All of wave 0 loop", ["[mosh] "]), "All of wave 0 loop");
  assert.equal(stripTitle("  Plain Label  ", ["[mosh] "]), "Plain Label");
  assert.equal(stripTitle("", ["[mosh] "]), "");
  assert.equal(stripTitle("No prefix", []), "No prefix");
});
```

- [ ] **Step 2:** `node --test test/config.test.mjs` → FAIL (module missing).

- [ ] **Step 3:** write `lib/config.mjs`:
```js
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULTS = {
  curtain: {
    enabled: true,
    coverableStates: ["working", "done", "needs"],
    focus: {
      source: "ssh-osascript",
      pollMs: 350,
      ssh: { host: "mac-music", connectTimeout: 4 },
      terminalApp: "ghostty",
      titleStripPrefixes: ["[mosh] "],
    },
    autoArm: { enabled: true, sessionGlob: "*" },
  },
};

const configPath = () =>
  process.env.HERALD_CONFIG ||
  join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "status-herald",
    "config.json",
  );

// Deep-merge plain objects; arrays and scalars in `over` replace the base.
const merge = (base, over) => {
  if (over === undefined) return base;
  if (Array.isArray(base) || base === null || typeof base !== "object") return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
};

export const loadConfig = (path = configPath()) => {
  try {
    if (!existsSync(path)) return DEFAULTS;
    return merge(DEFAULTS, JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    process.stderr.write(
      `herald: bad config at ${path}, using defaults (${e?.message ?? e})\n`,
    );
    return DEFAULTS;
  }
};

// Normalize a raw terminal-tab title: strip the first matching transport
// prefix (e.g. mosh's "[mosh] ") and trim. Adapters send raw; the box
// normalizes here so session.mjs can stay exact-match.
export const stripTitle = (raw, prefixes) => {
  let t = raw ?? "";
  for (const p of prefixes || []) {
    if (t.startsWith(p)) { t = t.slice(p.length); break; }
  }
  return t.trim();
};
```

- [ ] **Step 4:** add a top-level `config` verb to `lib/cli.mjs`. Add import `import { loadConfig } from "./config.mjs";` and, in `main`, before the final usage fallthrough:
```js
    if (verb === "config") {
      process.stdout.write(`${JSON.stringify(loadConfig(), null, 2)}\n`);
      return;
    }
```
Update the top usage string to `usage: herald <render|curtain|config> ...`.

- [ ] **Step 5:** `node --test` full suite → PASS. `node_modules/.bin/biome check .` clean.

- [ ] **Step 6: Commit**
```bash
git add lib/config.mjs lib/cli.mjs test/config.test.mjs
git commit -m "feat(config): zero-dep XDG config loader + title normalize + herald config"
```

---

## Task 2: config-gate the curtain verbs + normalize focus title

**Files:** Modify `lib/cli.mjs`; Modify `test/curtain-cli.test.mjs`.

**Interfaces — Consumes:** `loadConfig`, `stripTitle` from `./config.mjs`. Behavior: when `curtain.enabled === false`, the per-tab verbs (`arm|disarm|cover|reveal|reveal-all|focus|arm-all`) no-op (return 0). `focus` normalizes its raw title argument via `stripTitle(raw, cfg.curtain.focus.titleStripPrefixes)` before calling `session.focus`.

- [ ] **Step 1: failing tests** — append to `test/curtain-cli.test.mjs`:
```js
import { mkdtempSync as _mk, rmSync as _rm, writeFileSync as _wf } from "node:fs";
import { tmpdir as _td } from "node:os";
import { join as _j } from "node:path";

test("curtain arm no-ops (exit 0) when curtain.enabled=false", () => {
  const dir = _mk(_j(_td(), "herald-cfg-"));
  const p = _j(dir, "c.json");
  _wf(p, JSON.stringify({ curtain: { enabled: false } }));
  try { runCli(["curtain", "arm", "nope-sess"], { HERALD_CONFIG: p }); }
  finally { _rm(dir, { recursive: true, force: true }); }
});

test("curtain focus normalizes a [mosh] prefix before matching (no throw off-tmux)", () => {
  // Off tmux, listArmed() is empty so focus is a no-op; this asserts the
  // normalized path runs without throwing and exits cleanly.
  const out = runCli(["curtain", "focus", "[mosh] Something"]);
  assert.equal(typeof out, "string");
});
```

- [ ] **Step 2:** `node --test test/curtain-cli.test.mjs` → the enabled-gate test FAILS (arm runs regardless of config).

- [ ] **Step 3:** in `lib/cli.mjs`, add imports `import { loadConfig, stripTitle } from "./config.mjs";`. At the top of `runCurtain`'s `try`, load config once and gate:
```js
  const [sub, ...rest] = args;
  const cfg = loadConfig().curtain;
  const GATED = new Set(["arm","disarm","cover","reveal","reveal-all","focus","arm-all"]);
  if (!cfg.enabled && GATED.has(sub)) return 0;
  try {
```
(Reuse the existing `const [sub, ...rest] = args;` — do not duplicate it.) Change the `focus` case to normalize:
```js
      case "focus":
        focus(stripTitle(rest[0] || "", cfg.focus.titleStripPrefixes));
        return 0;
```

- [ ] **Step 4:** `node --test` full suite → PASS. biome clean.

- [ ] **Step 5: Commit**
```bash
git add lib/cli.mjs test/curtain-cli.test.mjs
git commit -m "feat(curtain): config-gate per-tab verbs + normalize focus title"
```

---

## Task 3: `arm-all` (config-scoped)

**Files:** Modify `lib/curtain/tmux.mjs`; Modify `lib/curtain/session.mjs`; Modify `lib/cli.mjs`; Modify `test/session.test.mjs`.

**Interfaces — Produces:** `tmux.listSessions()→string[]`; `session.armAll(glob, t?)` arms every session whose name matches `glob` (`*` = all; `prefix*`, exact supported). CLI `herald curtain arm-all` arms per `cfg.autoArm.sessionGlob` (respects enabled + `autoArm.enabled`).

- [ ] **Step 1: failing tests** — append to `test/session.test.mjs`:
```js
import { armAll } from "../lib/curtain/session.mjs";

test("armAll arms every session matching the glob", () => {
  const t = makeT({
    "web-1": { opts: {}, active: "@a", windows: { "@a": "Web 1" } },
    "web-2": { opts: {}, active: "@b", windows: { "@b": "Web 2" } },
    "api":   { opts: {}, active: "@c", windows: { "@c": "Api" } },
  });
  t.listSessions = () => ["web-1", "web-2", "api"];
  armAll("web*", t);
  assert.equal(t.getSessOpt("web-1", "@herald_armed"), "1");
  assert.equal(t.getSessOpt("web-2", "@herald_armed"), "1");
  assert.equal(t.getSessOpt("api", "@herald_armed"), "", "non-match not armed");
});

test("armAll with * arms all", () => {
  const t = makeT({
    s1: { opts: {}, active: "@a", windows: { "@a": "S1" } },
    s2: { opts: {}, active: "@b", windows: { "@b": "S2" } },
  });
  t.listSessions = () => ["s1", "s2"];
  armAll("*", t);
  assert.equal(t.getSessOpt("s1", "@herald_armed"), "1");
  assert.equal(t.getSessOpt("s2", "@herald_armed"), "1");
});
```
(The `makeT` double lacks `listSessions`; each test injects it, mirroring how the stampSession test injects `sessionOf`.)

- [ ] **Step 2:** `node --test test/session.test.mjs` → FAIL (`armAll` not a function).

- [ ] **Step 3a:** `lib/curtain/tmux.mjs` — add to `buildArgs`: `listSessions: () => ["list-sessions", "-F", "#{session_name}"],` and export:
```js
export const listSessions = () => {
  const raw = run(buildArgs.listSessions());
  return raw ? raw.split("\n").filter(Boolean) : [];
};
```

- [ ] **Step 3b:** `lib/curtain/session.mjs` — add (after imports) a tiny glob matcher and `armAll`:
```js
// Minimal glob: "*" becomes ".*"; every other char is matched literally.
const globToRe = (g) =>
  new RegExp(
    `^${g.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`,
  );

export const armAll = (glob = "*", t = realTmux) => {
  const re = globToRe(glob);
  for (const name of t.listSessions()) if (re.test(name)) arm(name, t);
};
```
`session.mjs` already does `import * as realTmux from "./tmux.mjs"`, so `realTmux.listSessions` resolves — no import edit needed.

- [ ] **Step 3c:** `lib/cli.mjs` — import `armAll` from `./curtain/session.mjs` (merge into the existing session import), add case:
```js
      case "arm-all":
        if (cfg.autoArm.enabled) armAll(cfg.autoArm.sessionGlob);
        return 0;
```
Add `arm-all` to the `default` usage string.

- [ ] **Step 4:** `node --test` full suite → PASS. biome clean.

- [ ] **Step 5: Commit**
```bash
git add lib/curtain/tmux.mjs lib/curtain/session.mjs lib/cli.mjs test/session.test.mjs
git commit -m "feat(curtain): arm-all across sessions by config glob"
```

---

## Task 4: reference ssh-poll adapter + systemd template + README

**Files:** Create `scripts/focus-agent/ghostty-ssh-poll.sh`; Create `contrib/systemd/status-herald-curtain.service`; Modify `README.md`.

- [ ] **Step 1:** `scripts/focus-agent/ghostty-ssh-poll.sh` — reads config via `herald config` (piped through node for zero-dep JSON access), polls the Mac's focused terminal-tab title over ssh, sends the RAW title to `herald curtain focus` (the box normalizes). `--once` prints one read (for testing); optional `--sentinel FILE` / `--max SEC` bound the loop; unbounded by default (service).
```bash
#!/usr/bin/env bash
# Reference focus adapter: poll the Mac's frontmost terminal-tab title over ssh
# and drive `herald curtain focus`. Config-driven (herald config). The box
# normalizes the title (titleStripPrefixes), so this sends the raw title.
set -u
ONCE=0; SENTINEL=""; MAXSEC=0
while [ $# -gt 0 ]; do case "$1" in
  --once) ONCE=1;; --sentinel) SENTINEL="$2"; shift;; --max) MAXSEC="$2"; shift;;
  *) echo "usage: $0 [--once] [--sentinel FILE] [--max SEC]" >&2; exit 2;; esac; shift; done

cfg() { herald config 2>/dev/null | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).curtain.focus;process.stdout.write(String(process.argv[1].split(".").reduce((o,k)=>o?.[k],c)??""))}catch{}})' "$1"; }

HOST="$(cfg ssh.host)";           HOST="${HOST:-mac-music}"
CTMO="$(cfg ssh.connectTimeout)"; CTMO="${CTMO:-4}"
APP="$(cfg terminalApp)";         APP="${APP:-ghostty}"
POLLMS="$(cfg pollMs)";           POLLMS="${POLLMS:-350}"
POLL="$(awk "BEGIN{printf \"%.3f\", ${POLLMS}/1000}")"

SSH=(ssh -o ConnectTimeout="$CTMO" -o BatchMode=yes
     -o ControlMaster=auto -o ControlPath=/tmp/cm-shcurtain-%r@%h:%p -o ControlPersist=30s "$HOST")

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

last="__init__"; start=$(date +%s)
while :; do
  [ -n "$SENTINEL" ] && [ ! -f "$SENTINEL" ] && break
  [ "$MAXSEC" -gt 0 ] && [ $(( $(date +%s) - start )) -ge "$MAXSEC" ] && break
  t="$(read_title)"
  if [ "$t" != "$last" ]; then herald curtain focus "$t" 2>/dev/null; last="$t"; fi
  sleep "$POLL"
done
herald curtain reveal-all 2>/dev/null
```
`chmod +x scripts/focus-agent/ghostty-ssh-poll.sh`.

- [ ] **Step 2:** `contrib/systemd/status-herald-curtain.service`:
```ini
[Unit]
Description=status-herald per-tab curtain focus agent (ssh poll)
After=network-online.target

[Service]
Type=simple
ExecStartPre=/usr/bin/env herald curtain arm-all
ExecStart=/usr/bin/env bash %h/.local/share/status-herald/ghostty-ssh-poll.sh
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

- [ ] **Step 3:** rewrite the README per-tab section: the adapter model, the `herald curtain focus "<title>"` contract, the config reference (paste the `curtain` block), the ssh-poll quickstart (grant macOS Accessibility to the ssh path; verify with `ghostty-ssh-poll.sh --once`), the systemd install (`cp` the adapter to `~/.local/share/status-herald/`, unit to `~/.config/systemd/user/`, `systemctl --user enable --now status-herald-curtain`), and a "write your own adapter" note. Keep the Hammerspoon file as the documented alternative.

- [ ] **Step 4: Commit**
```bash
git add scripts/focus-agent/ghostty-ssh-poll.sh contrib/systemd/status-herald-curtain.service README.md
git commit -m "feat(curtain): reference ssh-poll focus adapter + systemd unit + docs"
```

---

## Task 5: deploy on the box (user-collaborative)

**Files:** none (system deploy + live verify).

- [ ] Stop the demo: `rm -f /tmp/herald-focus.on` (scratchpad poller → reveal-all), then `for s in syndcast-2 syndcast-3 syndcast-4; do herald curtain disarm $s; done` to clear the faked working states.
- [ ] Write `~/.config/status-herald/config.json` (or accept defaults; `ssh.host=mac-music` already matches).
- [ ] Install: copy `scripts/focus-agent/ghostty-ssh-poll.sh` → `~/.local/share/status-herald/`, `contrib/systemd/*.service` → `~/.config/systemd/user/`, then `systemctl --user daemon-reload && systemctl --user enable --now status-herald-curtain`.
- [ ] Verify: `ghostty-ssh-poll.sh --once` prints the focused tab title; `systemctl --user status status-herald-curtain` active; switch tabs → background working sessions cover, focused reveals. `journalctl --user -u status-herald-curtain -f` to watch.
- [ ] Record PASS/FAIL; any FAIL feeds a fix task.

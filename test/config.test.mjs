import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, loadConfig, merge, stripTitle } from "../lib/config.mjs";

test("loadConfig returns DEFAULTS when the file is absent", () => {
  assert.equal(
    loadConfig(join(tmpdir(), "nope-herald-xyz.json")).curtain.enabled,
    true,
  );
  assert.deepEqual(
    loadConfig(join(tmpdir(), "nope-herald-xyz.json")).curtain.coverableStates,
    ["working", "done", "needs", "compacting"],
  );
});

test("loadConfig deep-merges overrides onto defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-cfg-"));
  const p = join(dir, "c.json");
  writeFileSync(
    p,
    JSON.stringify({ curtain: { enabled: false, focus: { pollMs: 200 } } }),
  );
  try {
    const c = loadConfig(p);
    assert.equal(c.curtain.enabled, false);
    assert.equal(c.curtain.focus.pollMs, 200);
    assert.equal(
      c.curtain.focus.terminalApp,
      "ghostty",
      "unspecified keys keep defaults",
    );
    assert.deepEqual(c.curtain.coverableStates, [
      "working",
      "done",
      "needs",
      "compacting",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig falls back to DEFAULTS on bad JSON (no throw)", () => {
  const dir = mkdtempSync(join(tmpdir(), "herald-cfg-"));
  const p = join(dir, "c.json");
  writeFileSync(p, "{ not json");
  try {
    assert.equal(loadConfig(p).curtain.enabled, DEFAULTS.curtain.enabled);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stripTitle removes the first matching prefix and trims", () => {
  assert.equal(
    stripTitle("[mosh] All of wave 0 loop", ["[mosh] "]),
    "All of wave 0 loop",
  );
  assert.equal(stripTitle("  Plain Label  ", ["[mosh] "]), "Plain Label");
  assert.equal(stripTitle("", ["[mosh] "]), "");
  assert.equal(stripTitle("No prefix", []), "No prefix");
});

test("curtain defaults carry the theme knobs", () => {
  const c = loadConfig("/nonexistent/does-not-exist.json").curtain;
  assert.equal(c.theme, "classic");
  assert.deepEqual(c.themeBySession, {});
  assert.deepEqual(c.themes, {});
  assert.equal(c.animation.fps, 2);
  // No global background override is defaulted (themes decide their own).
  assert.equal(c.background, undefined);
});

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
      curtain: {
        focus: { source: "ghostty-hammerspoon", eventFile: "/tmp/ev" },
      },
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

test("curtain.tmuxBar defaults to keep (no bar change)", () => {
  assert.equal(DEFAULTS.curtain.tmuxBar.whenCovered, "keep");
});

test("a user can override tmuxBar.whenCovered to transparent", () => {
  const cfg = merge(DEFAULTS, {
    curtain: { tmuxBar: { whenCovered: "transparent" } },
  });
  assert.equal(cfg.curtain.tmuxBar.whenCovered, "transparent");
});

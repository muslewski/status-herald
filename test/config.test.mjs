import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, loadConfig, stripTitle } from "../lib/config.mjs";

test("loadConfig returns DEFAULTS when the file is absent", () => {
  assert.equal(
    loadConfig(join(tmpdir(), "nope-herald-xyz.json")).curtain.enabled,
    true,
  );
  assert.deepEqual(
    loadConfig(join(tmpdir(), "nope-herald-xyz.json")).curtain.coverableStates,
    ["working", "done", "needs"],
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
    assert.deepEqual(c.curtain.coverableStates, ["working", "done", "needs"]);
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

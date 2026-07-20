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

test("animation defaults include enabled, reducedMotion, and draw timing", () => {
  const a = loadConfig(join(tmpdir(), "nope-herald-anim-xyz.json")).curtain
    .animation;
  assert.equal(a.enabled, true);
  assert.equal(a.fps, 2);
  assert.equal(a.reducedMotion, false);
  assert.equal(a.drawFrames, 8);
  assert.equal(a.drawMs, 600);
});

test("user can disable motion via merge (enabled false or reducedMotion)", () => {
  const off = merge(DEFAULTS, {
    curtain: { animation: { enabled: false } },
  });
  assert.equal(off.curtain.animation.enabled, false);
  assert.equal(off.curtain.animation.fps, 2, "fps preserved");
  const reduced = merge(DEFAULTS, {
    curtain: { animation: { reducedMotion: true } },
  });
  assert.equal(reduced.curtain.animation.reducedMotion, true);
  assert.equal(reduced.curtain.animation.enabled, true);
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

test("curtain.tmuxBar defaults to keep + wash off (context first)", () => {
  assert.equal(DEFAULTS.curtain.tmuxBar.whenCovered, "keep");
  assert.equal(DEFAULTS.curtain.tmuxBar.wash, false);
  assert.equal(DEFAULTS.curtain.tmuxBar.doneFlashSec, 3);
});

test("curtain.settle defaults are fleet-safe quiet/leak windows", () => {
  const s = DEFAULTS.curtain.settle;
  assert.equal(s.settleSynthQuietSec, 300);
  assert.equal(s.settleSynthLeakSec, 360);
  assert.equal(s.maxWorkingSec, 0);
  assert.equal(s.maxNeedsSec, 0);
});

test("a user can override tmuxBar.whenCovered to transparent", () => {
  const cfg = merge(DEFAULTS, {
    curtain: { tmuxBar: { whenCovered: "transparent" } },
  });
  assert.equal(cfg.curtain.tmuxBar.whenCovered, "transparent");
});

test("bars defaults reproduce today's look (account on, model off, claude on)", () => {
  const cfg = loadConfig(join(tmpdir(), "nope-herald-bars-xyz.json"));
  assert.ok(cfg.bars, "bars section should exist");
  assert.equal(cfg.bars.tmux.enabled, true);
  assert.equal(cfg.bars.claude.enabled, true);
  assert.equal(cfg.bars.claude.silentCapture, false);
  assert.equal(cfg.bars.segments.context.enabled, true);
  assert.equal(cfg.bars.segments.context.priority, 100);
  assert.equal(cfg.bars.segments.model.enabled, false);
  assert.equal(cfg.bars.segments.model.priority, 60);
  assert.equal(cfg.bars.segments.state.enabled, true);
  assert.equal(cfg.bars.segments.account5h.enabled, true);
  assert.equal(cfg.bars.segments.accountWeekly.enabled, true);
  assert.equal(cfg.bars.segments.clock.enabled, true);
  assert.equal(cfg.bars.segments.notify.enabled, true);
});

test("bars partial override merges per-segment without clobbering siblings", () => {
  const cfg = merge(DEFAULTS, {
    bars: {
      segments: {
        account5h: { enabled: false },
        model: { enabled: true },
      },
    },
  });
  assert.equal(cfg.bars.segments.account5h.enabled, false);
  assert.equal(cfg.bars.segments.model.enabled, true);
  assert.equal(cfg.bars.segments.context.enabled, true);
  assert.equal(cfg.bars.segments.accountWeekly.enabled, true);
  assert.equal(cfg.bars.tmux.enabled, true);
});

test("bars unknown segment keys in config are preserved by merge (ignored by consumers)", () => {
  const cfg = merge(DEFAULTS, {
    bars: { segments: { totallyUnknown: { enabled: true, priority: 1 } } },
  });
  assert.equal(cfg.bars.segments.totallyUnknown.enabled, true);
  assert.equal(cfg.bars.segments.context.enabled, true);
});

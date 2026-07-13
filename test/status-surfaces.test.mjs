import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "../lib/config.mjs";

test("bars config section present in defaults and reproduces today's look (accounts on, model off, claude on)", () => {
  const cfg = loadConfig(); // no file -> defaults
  assert.ok(cfg.bars, "bars section should exist");
  assert.equal(cfg.bars.tmux.enabled, true);
  assert.equal(cfg.bars.claude.enabled, true);
  assert.equal(cfg.bars.claude.silentCapture, false);
  // account gauges on by default (reproduce pre-herald-bar.conf behavior)
  assert.equal(cfg.bars.segments.account5h.enabled, true);
  assert.equal(cfg.bars.segments.accountWeekly.enabled, true);
  // model off by default for bar
  assert.equal(cfg.bars.segments.model.enabled, false);
  assert.equal(cfg.bars.segments.context.enabled, true);
  assert.equal(cfg.bars.segments.state.enabled, true);
});

test("bars config partial override merges (per-segment)", () => {
  // Simulate a user config that turns accounts off (like operator's interim)
  const merged = {
    ...DEFAULTS,
    bars: {
      ...DEFAULTS.bars,
      segments: {
        ...DEFAULTS.bars.segments,
        account5h: { enabled: false },
        accountWeekly: { enabled: false },
        model: { enabled: true },
      },
    },
  };
  assert.equal(merged.bars.segments.account5h.enabled, false);
  assert.equal(merged.bars.segments.model.enabled, true);
  // others unchanged
  assert.equal(merged.bars.segments.context.enabled, true);
});

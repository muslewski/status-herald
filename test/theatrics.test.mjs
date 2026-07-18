import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRIFT_GLYPHS,
  breatheAmp,
  coverageRatio,
  drawFrameMs,
  driftField,
  motionDisabled,
  selectEffects,
  sparkRain,
  stageCurtain,
} from "../lib/curtain/theatrics.mjs";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC strips for plain geometry asserts.
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("motionDisabled when enabled false or reducedMotion", () => {
  assert.equal(motionDisabled({ enabled: false }), true);
  assert.equal(motionDisabled({ reducedMotion: true }), true);
  assert.equal(motionDisabled({ enabled: true, reducedMotion: false }), false);
  assert.equal(motionDisabled({}), false);
});

test("stageCurtain shut: first frame open, last closed, monotonic coverage", () => {
  const cols = 40;
  const rows = 12;
  const frames = 8;
  let prev = -1;
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const lines = stageCurtain(cols, rows, t, "shut");
    assert.equal(lines.length, rows);
    for (const l of lines) {
      assert.equal(plain(l).length, cols, "every line fills cols");
    }
    const cov = coverageRatio(lines);
    if (i === 0) assert.ok(cov < 0.15, `first ≈ open, got ${cov}`);
    if (i === frames - 1) assert.ok(cov > 0.85, `last ≈ closed, got ${cov}`);
    assert.ok(cov + 1e-9 >= prev, `monotonic coverage ${prev} → ${cov}`);
    prev = cov;
  }
});

test("stageCurtain open: first closed, last open, coverage falls", () => {
  const cols = 32;
  const rows = 8;
  const frames = 8;
  let prev = 2;
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const lines = stageCurtain(cols, rows, t, "open");
    const cov = coverageRatio(lines);
    if (i === 0) assert.ok(cov > 0.85, `first ≈ closed, got ${cov}`);
    if (i === frames - 1) assert.ok(cov < 0.15, `last ≈ open, got ${cov}`);
    assert.ok(cov <= prev + 1e-9, `coverage falls ${prev} → ${cov}`);
    prev = cov;
  }
});

test("stageCurtain is deterministic for (cols, rows, t, dir)", () => {
  const a = stageCurtain(24, 6, 0.5, "shut").join("\n");
  const b = stageCurtain(24, 6, 0.5, "shut").join("\n");
  assert.equal(a, b);
  const open = stageCurtain(24, 6, 0.5, "open").join("\n");
  // open(t) ≈ shut(1-t)
  const shutInv = stageCurtain(24, 6, 0.5, "shut").join("\n");
  assert.equal(open, shutInv);
});

test("stageCurtain uses density ramp glyphs (░▒▓█)", () => {
  const mid = stageCurtain(40, 6, 0.6, "shut").join("");
  assert.match(mid, /[░▒▓█]/);
});

test("sparkRain: 3–5 frame sequence, deterministic, sparse sparks", () => {
  const cols = 40;
  const rows = 12;
  const frames = 5;
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const lines = sparkRain(cols, rows, t, { palette: "done" });
    assert.equal(lines.length, rows);
    for (const l of lines) assert.equal(plain(l).length, cols);
  }
  // Early frames have sparks; not a solid flood.
  const early = sparkRain(40, 12, 0.2, { palette: "done" }).join("");
  assert.match(early, /[*.·+]/);
  const cov = coverageRatio(sparkRain(40, 12, 0.2, { palette: "done" }));
  assert.ok(cov < 0.35, "sparks are sparse, not a solid fill");
  assert.equal(
    sparkRain(20, 6, 0.4).join("\n"),
    sparkRain(20, 6, 0.4).join("\n"),
  );
});

test("breatheAmp is soft 0..1 cycle (no hard strobe edges)", () => {
  const samples = [];
  for (let i = 0; i < 20; i++) samples.push(breatheAmp(i * 0.25, 3));
  for (const a of samples) {
    assert.ok(a >= 0 && a <= 1, `amp in range: ${a}`);
  }
  // Adjacent samples at 0.25s of a 3s period must not jump full range (no strobe).
  for (let i = 1; i < samples.length; i++) {
    assert.ok(
      Math.abs(samples[i] - samples[i - 1]) < 0.55,
      "no hard strobe step",
    );
  }
  // Full period returns near start.
  assert.ok(Math.abs(breatheAmp(0, 3) - breatheAmp(3, 3)) < 1e-9);
});

test("selectEffects: classic → none", () => {
  const e = selectEffects({
    state: "done",
    themeName: "classic",
    animCfg: { enabled: true, reducedMotion: false },
  });
  assert.equal(e.stageDraw, false);
  assert.equal(e.sparkRain, false);
  assert.equal(e.barFlash, false);
  assert.equal(e.breathe, false);
});

test("selectEffects: DONE → spark-rain + bar flash (non-classic)", () => {
  const e = selectEffects({
    state: "done",
    themeName: "forge",
    animCfg: { enabled: true, reducedMotion: false },
  });
  assert.equal(e.sparkRain, true);
  assert.equal(e.barFlash, true);
  assert.equal(e.breathe, false);
  assert.equal(e.stageDraw, true);
});

test("selectEffects: NEEDS → breathe (non-classic)", () => {
  const e = selectEffects({
    state: "needs",
    themeName: "forge",
    animCfg: { enabled: true },
  });
  assert.equal(e.breathe, true);
  assert.equal(e.sparkRain, false);
  assert.equal(e.barFlash, false);
  assert.equal(e.stageDraw, true);
});

test("selectEffects: motion off disables all theatrics", () => {
  for (const animCfg of [
    { enabled: false },
    { enabled: true, reducedMotion: true },
  ]) {
    const e = selectEffects({
      state: "needs",
      themeName: "forge",
      animCfg,
    });
    assert.equal(e.stageDraw, false);
    assert.equal(e.sparkRain, false);
    assert.equal(e.barFlash, false);
    assert.equal(e.breathe, false);
  }
});

test("selectEffects: working/compacting get stageDraw only when non-classic", () => {
  const w = selectEffects({
    state: "working",
    themeName: "minimal",
    animCfg: { enabled: true },
  });
  assert.equal(w.stageDraw, true);
  assert.equal(w.sparkRain, false);
  assert.equal(w.breathe, false);
});

test("drawFrameMs divides draw budget across frames", () => {
  assert.equal(drawFrameMs({ drawFrames: 8, drawMs: 600 }), 75);
  assert.equal(drawFrameMs({ drawFrames: 10, drawMs: 600 }), 60);
  assert.equal(drawFrameMs({ drawFrames: 0, drawMs: 600 }), 1000);
  assert.equal(drawFrameMs({}), 75); // defaults 8 / 600
});

test("driftField: exact geometry — rows lines each cols wide, sparse", () => {
  const lines = driftField(40, 12, 1.0, { seed: 7 });
  assert.equal(lines.length, 12);
  for (const l of lines) assert.equal(plain(l).length, 40);
  const cov = coverageRatio(lines); // fabric glyphs → 0 here, but assert sparse ink
  assert.ok(cov < 0.35, "field is sparse, not a flood");
});

test("driftField: identity is COORDINATE-ONLY — no per-frame re-randomization", () => {
  // The flicker bug was phase XOR'd into the hash. With fade off and tiny t
  // steps (sub-cell, no drift), consecutive frames must be BYTE-IDENTICAL:
  // the same lattice points are motes every frame.
  const a = driftField(40, 12, 0.0, { seed: 3, fade: false }).join("\n");
  const b = driftField(40, 12, 0.01, { seed: 3, fade: false }).join("\n");
  const c = driftField(40, 12, 0.02, { seed: 3, fade: false }).join("\n");
  assert.equal(a, b, "no re-sample between adjacent frames");
  assert.equal(b, c, "no re-sample between adjacent frames");
});

test("driftField: motes drift along dir over time (slide, not vanish)", () => {
  const t0 = driftField(40, 12, 0.0, { seed: 5, fade: false, dir: "lateral" });
  const t1 = driftField(40, 12, 8.0, { seed: 5, fade: false, dir: "lateral" });
  const ink = (ls) => ls.join("").replace(/ /g, "").length;
  assert.notEqual(t0.join("\n"), t1.join("\n"), "field advanced with t");
  // Motes moved, they did not disappear: ink count stays close (fade off).
  assert.ok(
    Math.abs(ink(t0) - ink(t1)) <= Math.ceil(ink(t0) * 0.25),
    "motes persist",
  );
});

test("driftField: age ramp fades glyphs through the ramp over lifetime", () => {
  const seen = new Set();
  for (let i = 0; i <= 24; i++) {
    for (const ch of driftField(40, 12, i * 0.25, { seed: 9 }).join("")) {
      if (ch !== " ") seen.add(ch);
    }
  }
  // every painted glyph is from the ramp, and ≥2 distinct ramp glyphs appear
  for (const ch of seen)
    assert.ok(DRIFT_GLYPHS.includes(ch), `ramp glyph: ${ch}`);
  assert.ok(
    [...seen].filter((c) => c !== " ").length >= 2,
    "fade uses ≥2 ramp steps",
  );
});

test("driftField: deterministic for same args", () => {
  assert.equal(
    driftField(30, 8, 1.7, { seed: 2 }).join("\n"),
    driftField(30, 8, 1.7, { seed: 2 }).join("\n"),
  );
});

test("driftField: different seeds → different fields (per-tab variety)", () => {
  const a = driftField(40, 12, 1.0, { seed: 1 }).join("\n");
  const b = driftField(40, 12, 1.0, { seed: 999 }).join("\n");
  assert.notEqual(a, b);
});

test("driftField: zero dims → empty grid, no throw", () => {
  assert.deepEqual(driftField(0, 0, 1, { seed: 1 }), []);
  assert.equal(driftField(0, 5, 1).length, 5);
});

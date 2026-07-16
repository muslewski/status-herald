import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMET,
  TRACK,
  composeWashStyle,
  formatSlideLine,
  sampleWash,
  slidePos,
} from "../lib/curtain/wash.mjs";

test("sampleWash idle has empty line and transparent intent", () => {
  const w = sampleWash({ state: "idle", nowSec: 10 });
  assert.equal(w.barBg, "default");
  assert.equal(w.line, "");
  assert.equal(w.mode, "static");
  assert.equal(w.settled, true);
});

test("sampleWash working slides a horizontal comet (no solid barBg colour)", () => {
  const a = sampleWash({ state: "working", nowSec: 0 });
  const b = sampleWash({ state: "working", nowSec: 3 });
  assert.equal(a.barBg, "default");
  assert.match(a.line, /bg=default/);
  assert.match(a.line, /━/);
  assert.equal(a.mode, "loop");
  // Position moves over time (bounce/sweep).
  assert.notEqual(a.pos, b.pos);
  assert.notEqual(a.line, b.line);
});

test("sampleWash done settles to empty line after doneFlashSec", () => {
  const early = sampleWash({
    state: "done",
    sinceSec: 100,
    nowSec: 101,
    doneFlashSec: 3,
  });
  const late = sampleWash({
    state: "done",
    sinceSec: 100,
    nowSec: 110,
    doneFlashSec: 3,
  });
  assert.equal(early.settled, false);
  assert.match(early.line, /━/);
  assert.equal(late.settled, true);
  assert.equal(late.line, "");
});

test("slidePos bounces between ends", () => {
  const max = TRACK - COMET;
  assert.equal(slidePos(0, 4, max), 0);
  assert.ok(slidePos(2, 4, max) > 0);
  assert.equal(slidePos(4, 4, max), max);
  // return trip
  assert.ok(slidePos(6, 4, max) < max);
});

test("formatSlideLine keeps fixed track width", () => {
  const s = formatSlideLine({
    pos: 2,
    dimFg: "colour240",
    hotFg: "colour214",
  });
  // strip tmux markup → pure glyphs
  const plain = s.replace(/#\[[^\]]*\]/g, "");
  assert.equal(plain.length, TRACK);
  assert.match(plain, /━{3}/);
});

test("composeWashStyle always forces transparent bg", () => {
  assert.equal(composeWashStyle({ userBase: "" }), "bg=default");
  assert.equal(
    composeWashStyle({ userBase: "fg=white" }),
    "fg=white,bg=default",
  );
  assert.equal(
    composeWashStyle({ userBase: "fg=white,bg=colour94" }),
    "fg=white,bg=default",
  );
});

test("sampleWash DONE does one soft flash then calm settle (no solid bar flood)", () => {
  const flash = sampleWash({
    state: "done",
    sinceSec: 100,
    nowSec: 100.2,
    doneFlashSec: 3,
  });
  assert.equal(flash.flash, true);
  assert.equal(flash.barBg, "default");
  assert.match(flash.line, /bg=default/);
  assert.match(flash.line, /colour82|colour70/); // soft green family
  const mid = sampleWash({
    state: "done",
    sinceSec: 100,
    nowSec: 102,
    doneFlashSec: 3,
  });
  assert.equal(mid.flash, false);
  assert.equal(mid.settled, false);
  assert.match(mid.line, /━/);
});

test("sampleWash NEEDS breathes crimson amp without pure-red strobe", () => {
  const amps = [];
  const colors = new Set();
  for (let t = 0; t < 12; t++) {
    const w = sampleWash({ state: "needs", nowSec: t * 0.5 });
    assert.equal(w.mode, "loop");
    assert.equal(w.barBg, "default");
    assert.match(w.line, /bg=default/);
    assert.ok(typeof w.amp === "number" && w.amp >= 0 && w.amp <= 1);
    amps.push(w.amp);
    // Extract fg colours from markup
    for (const m of w.line.matchAll(/fg=(colour\d+)/g)) colors.add(m[1]);
  }
  assert.ok(amps.some((a) => a > 0.6) && amps.some((a) => a < 0.4), "cycles");
  // Soft rose family — not pure red / colour196 hard strobe.
  assert.ok([...colors].every((c) => c !== "colour196" && c !== "red"));
  assert.ok(colors.size >= 1);
});

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

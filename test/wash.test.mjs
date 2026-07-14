import assert from "node:assert/strict";
import { test } from "node:test";
import { composeWashStyle, sampleWash } from "../lib/curtain/wash.mjs";

test("sampleWash idle is default static", () => {
  const w = sampleWash({ state: "idle", nowSec: 10 });
  assert.equal(w.barBg, "default");
  assert.equal(w.mode, "static");
});

test("sampleWash working steps through amber family", () => {
  const a = sampleWash({ state: "working", nowSec: 0 });
  const b = sampleWash({ state: "working", nowSec: 4 });
  assert.match(a.barBg, /^colour\d+$/);
  assert.equal(a.mode, "loop");
  assert.notEqual(a.barBg, b.barBg);
});

test("sampleWash done settles to default after doneFlashSec", () => {
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
  assert.match(early.barBg, /^colour/);
  assert.equal(late.settled, true);
  assert.equal(late.barBg, "default");
});

test("composeWashStyle appends wash bg", () => {
  assert.equal(
    composeWashStyle({ userBase: "fg=white", barBg: "colour94" }),
    "fg=white,bg=colour94",
  );
  assert.equal(
    composeWashStyle({ userBase: "", barBg: "colour94" }),
    "bg=colour94",
  );
  assert.equal(
    composeWashStyle({ userBase: "fg=white", barBg: "default" }),
    "fg=white",
  );
});

test("composeWashStyle cover transparent only with default bg", () => {
  assert.equal(
    composeWashStyle({
      userBase: "fg=white",
      barBg: "default",
      coverTransparent: true,
    }),
    "fg=white,bg=default",
  );
});

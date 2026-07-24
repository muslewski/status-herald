import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hitChrome,
  keyChrome,
  layoutChrome,
  paintChromePlain,
} from "../lib/curtain/card-chrome.mjs";
import {
  denizenCel,
  morphCelDissolve,
  nextSpecies,
  prevSpecies,
} from "../lib/curtain/denizens.mjs";

test("layoutChrome places buttons on bottom row, right-aligned", () => {
  const L = layoutChrome(80, 24);
  assert.ok(L.length >= 2);
  assert.equal(L[0].id, "pause");
  assert.equal(L[1].id, "pet");
  assert.equal(L[0].row, 23);
  assert.ok(L[0].c0 < L[0].c1);
  assert.ok(L[1].c0 >= L[0].c1);
  assert.ok(L[1].c1 <= 80);
});

test("hitChrome matches button cells (1-based mouse coords)", () => {
  const L = layoutChrome(80, 24);
  const pause = L.find((b) => b.id === "pause");
  const pet = L.find((b) => b.id === "pet");
  // mid-cell of pause
  const px = pause.c0 + 1 + 1; // 1-based
  const py = pause.row + 1;
  assert.equal(hitChrome(80, 24, px, py), "pause");
  assert.equal(hitChrome(80, 24, pet.c0 + 1, pet.row + 1), "pet");
  assert.equal(hitChrome(80, 24, 1, 1), null);
});

test("keyChrome maps x/o → pause, a/p → pet", () => {
  assert.equal(keyChrome("x"), "pause");
  assert.equal(keyChrome("O"), "pause");
  assert.equal(keyChrome("a"), "pet");
  assert.equal(keyChrome("P"), "pet");
  assert.equal(keyChrome("z"), null);
});

test("paintChromePlain writes labels into soft spaces only", () => {
  const rows = 10;
  const cols = 40;
  const lines = Array.from({ length: rows }, () => " ".repeat(cols));
  const out = paintChromePlain(lines, cols, rows);
  const bottom = out[rows - 1];
  assert.match(bottom, /off|×/);
  assert.match(bottom, /pet|↻/);
});

test("nextSpecies cycles fox→cat→owl→fox", () => {
  assert.equal(nextSpecies("fox"), "cat");
  assert.equal(nextSpecies("cat"), "owl");
  assert.equal(nextSpecies("owl"), "fox");
  assert.ok(["fox", "cat", "owl"].includes(nextSpecies("")));
});

test("prevSpecies cycles fox←cat←owl←fox", () => {
  assert.equal(prevSpecies("fox"), "owl");
  assert.equal(prevSpecies("cat"), "fox");
  assert.equal(prevSpecies("owl"), "cat");
  assert.ok(["fox", "cat", "owl"].includes(prevSpecies("")));
  // next then prev returns home
  assert.equal(prevSpecies(nextSpecies("fox")), "fox");
});

test("morphCelDissolve: endpoints and mid differ", () => {
  const a = denizenCel({
    species: "fox",
    state: "done",
    tier: "full",
    tick: 0,
    seed: 1,
  });
  const b = denizenCel({
    species: "owl",
    state: "done",
    tier: "full",
    tick: 0,
    seed: 1,
  });
  assert.ok(a.length && b.length);
  const at0 = morphCelDissolve(a, b, 0, 1);
  const at1 = morphCelDissolve(a, b, 1, 1);
  const mid = morphCelDissolve(a, b, 0.5, 1);
  assert.ok(at0.length && at1.length && mid.length);
  // Endpoints differ from each other and from mid (dissolve actually runs).
  assert.notEqual(at0.join("\n"), at1.join("\n"));
  assert.notEqual(mid.join("\n"), at0.join("\n"));
  assert.notEqual(mid.join("\n"), at1.join("\n"));
});

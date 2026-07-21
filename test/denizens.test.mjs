import assert from "node:assert/strict";
import { test } from "node:test";
import { DENIZENS } from "../lib/curtain/denizens-data.mjs";
import {
  ROSTER,
  denizenCel,
  hashStr,
  inkBounds,
  placeDenizen,
  seedFor,
  speciesFor,
  tierFor,
} from "../lib/curtain/denizens.mjs";

const STATES = ["working", "done", "needs", "compacting", "idle"];

test("hashStr is deterministic uint32", () => {
  assert.equal(hashStr("s1"), hashStr("s1"));
  const h = hashStr("Syndcast Backlog");
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

test("speciesFor deterministic and in roster", () => {
  const a = speciesFor("s1");
  assert.equal(a, speciesFor("s1"));
  assert.ok(ROSTER.includes(a));
});

test("speciesFor honors explicit species override", () => {
  assert.equal(
    speciesFor("s1", { animation: { denizens: { species: "fox" } } }),
    "fox",
  );
  assert.equal(
    speciesFor("s1", { animation: { denizens: { species: "owl" } } }),
    "owl",
  );
});

test("roster ≥ 3 species and speciesFor spreads", () => {
  assert.ok(ROSTER.length >= 3);
  const set = new Set([...Array(50)].map((_, i) => speciesFor(`sess-${i}`)));
  assert.ok(set.size >= 2, `expected spread, got ${[...set]}`);
});

test("seedFor stable per name", () => {
  assert.equal(seedFor("s1"), seedFor("s1"));
  assert.notEqual(seedFor("s1"), seedFor("s2"));
});

// RECONCILE R1 thresholds
test("tierFor thresholds (RECONCILE R1)", () => {
  assert.equal(tierFor(24, 80), "full");
  assert.equal(tierFor(12, 26), "full");
  assert.equal(tierFor(10, 30), "compact");
  assert.equal(tierFor(5, 11), "compact");
  assert.equal(tierFor(4, 10), "none");
  assert.equal(tierFor(24, 10), "none");
  assert.equal(tierFor(11, 25), "compact");
});

test("denizenCel returns rows for known species/state/tier", () => {
  const cel = denizenCel({
    species: "fox",
    state: "working",
    tier: "full",
    tick: 0,
    seed: 0,
  });
  assert.equal(cel.length, DENIZENS.fox.tiers.full.rows);
  for (const r of cel) assert.equal(r.length, DENIZENS.fox.tiers.full.cols);
});

test("denizenCel frame folds seed phase offset", () => {
  const t0s0 = denizenCel({
    species: "fox",
    state: "working",
    tier: "full",
    tick: 0,
    seed: 0,
  });
  const t0s1 = denizenCel({
    species: "fox",
    state: "working",
    tier: "full",
    tick: 0,
    seed: 1,
  });
  assert.notDeepEqual(t0s0, t0s1);
  assert.deepEqual(
    denizenCel({
      species: "fox",
      state: "working",
      tier: "full",
      tick: 2,
      seed: 0,
    }),
    t0s0,
  );
});

test("inkBounds tracks non-space silhouette, not pad box", () => {
  const cel = ["  /\\_/\\  ", " (=^.^=) ", "  (   )  "];
  const b = inkBounds(cel);
  assert.ok(b);
  assert.equal(b.minC, 1); // leading spaces
  assert.ok(b.inkW < 9, "ink narrower than padded line");
});

test("placeDenizen centers cat ink on card midline", () => {
  const cel = denizenCel({
    species: "cat",
    state: "working",
    tier: "full",
    tick: 0,
    seed: 1,
  });
  const cols = 60;
  const { top, left, cel: cropped } = placeDenizen(cel, cols, 24);
  assert.ok(cropped.length >= 3);
  // Reconstruct where ink lands on the card
  let min = Infinity;
  let max = -1;
  for (const line of cropped) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === " ") continue;
      const col = left + i;
      if (col < min) min = col;
      if (col > max) max = col;
    }
  }
  const mid = (min + max) / 2;
  assert.ok(
    Math.abs(mid - (cols - 1) / 2) < 1.1,
    `ink mid ${mid} should be near screen mid ${(cols - 1) / 2}`,
  );
  assert.ok(top >= 0);
});

test("denizenCel fail-open", () => {
  assert.deepEqual(
    denizenCel({ species: "dragon", state: "working", tier: "full" }),
    [],
  );
  assert.deepEqual(
    denizenCel({ species: "fox", state: "working", tier: "none" }),
    [],
  );
  assert.deepEqual(denizenCel({}), []);
});

test("every denizen: 5 states × both tiers, rectangular, whitespace-safe, ≤8 frames", () => {
  for (const [name, rec] of Object.entries(DENIZENS)) {
    for (const st of STATES) {
      const pose = rec.poses[st];
      assert.ok(pose, `${name}.${st} missing`);
      for (const tier of ["full", "compact"]) {
        const frames = pose[tier];
        assert.ok(
          Array.isArray(frames) && frames.length >= 1 && frames.length <= 8,
          `${name}.${st}.${tier} frame count`,
        );
        const { rows, cols } = rec.tiers[tier];
        // RECONCILE R1 caps
        assert.ok(
          rows <= (tier === "full" ? 5 : 3),
          `${name} ${tier} rows cap`,
        );
        assert.ok(
          cols <= (tier === "full" ? 12 : 8),
          `${name} ${tier} cols cap`,
        );
        for (const fr of frames) {
          assert.equal(fr.length, rows, `${name}.${st}.${tier} row count`);
          for (const line of fr) {
            assert.equal(line.length, cols, `${name}.${st}.${tier} width`);
            // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char ban check
            assert.doesNotMatch(line, /[\x00-\x1f]/, "no control chars");
          }
        }
      }
    }
  }
});

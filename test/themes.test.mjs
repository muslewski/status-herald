import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILTINS,
  isAnimated,
  resolveThemeByName,
  themeNameFor,
} from "../lib/curtain/themes.mjs";

test("classic is a solid, glyph/label theme for every state", () => {
  const c = BUILTINS.classic;
  assert.equal(c.background, "solid");
  for (const s of ["working", "compacting", "done", "needs", "idle"])
    assert.ok(c.states[s], `classic missing ${s}`);
  assert.equal(c.states.working.label, "WORKING");
});

test("themeNameFor picks the first matching session glob, else the default", () => {
  const cfg = {
    theme: "minimal",
    themeBySession: { "token-oracle*": "forge", "syndcast*": "neon" },
  };
  assert.equal(themeNameFor("token-oracle-3", cfg), "forge");
  assert.equal(themeNameFor("syndcast-web", cfg), "neon");
  assert.equal(themeNameFor("random", cfg), "minimal");
});

test("themeNameFor defaults to classic when nothing is configured", () => {
  assert.equal(themeNameFor("anything", {}), "classic");
});

test("resolveThemeByName merges user override over the builtin", () => {
  const cfg = { themes: { classic: { states: { working: { fg: 200 } } } } };
  const t = resolveThemeByName("classic", cfg);
  assert.equal(t.states.working.fg, 200); // overridden
  assert.equal(t.states.working.label, "WORKING"); // inherited from builtin
});

test("top-level background override wins and reaches the resolved theme", () => {
  const t = resolveThemeByName("classic", { background: "transparent" });
  assert.equal(t.background, "transparent");
});

test("an unknown theme name falls back to classic", () => {
  assert.equal(
    resolveThemeByName("does-not-exist", {}).states.done.label,
    "DONE",
  );
});

test("isAnimated is true only when a state has more than one frame", () => {
  assert.equal(isAnimated(BUILTINS.classic), false);
  assert.equal(isAnimated({ states: { x: { frames: [["a"], ["b"]] } } }), true);
  assert.equal(isAnimated({ states: { x: { frames: [["a"]] } } }), false);
});

test("minimal is transparent glyph/label", () => {
  assert.equal(BUILTINS.minimal.background, "transparent");
  assert.equal(BUILTINS.minimal.states.done.label, "DONE");
  assert.ok(!BUILTINS.minimal.states.working.frames);
});

test("forge is a transparent, animated theme", () => {
  assert.equal(BUILTINS.forge.background, "transparent");
  assert.ok(BUILTINS.forge.states.working.frames.length >= 2);
  assert.equal(isAnimated(BUILTINS.forge), true);
});

test("forge done and compacting are animated with a settle on done", () => {
  assert.ok(BUILTINS.forge.states.done.frames.length >= 2);
  assert.equal(BUILTINS.forge.states.done.settleAfter, 10);
  assert.ok(BUILTINS.forge.states.compacting.frames.length >= 2);
  assert.equal(BUILTINS.forge.states.compacting.settleAfter, undefined);
});

test("forge done art is multi-row ASCII (same scale as working), not a lone emoji", () => {
  const frames = BUILTINS.forge.states.done.frames;
  assert.ok(frames.length >= 4, "settle sequence with room to breathe");
  for (const fr of frames) {
    assert.ok(fr.length >= 4, "at least 4 art rows per frame");
    const joined = fr.join("\n");
    assert.doesNotMatch(joined, /[✅✓]/, "no thin emoji checkmark");
    assert.match(joined, /=======/, "anvil base retained");
  }
  // Settled last frame is a large ASCII check on the anvil.
  const last = frames[frames.length - 1].join("\n");
  assert.match(last, /V|\\\\/, "ASCII check form present");
});

test("minimal gains animated done/compacting but keeps working static", () => {
  assert.ok(BUILTINS.minimal.states.done.frames.length >= 2);
  assert.ok(!BUILTINS.minimal.states.working.frames);
  assert.equal(isAnimated(BUILTINS.minimal), true);
});

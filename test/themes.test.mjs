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

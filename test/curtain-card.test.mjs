import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { renderCard } from "../lib/surfaces/curtain-card.mjs";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR sequence; intentional.
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("renderCard returns exactly `rows` lines", () => {
  assert.equal(renderCard("working", 42, 40, 10).length, 10);
});

test("working card shows label and elapsed", () => {
  const text = renderCard("working", 42, 40, 10).map(plain).join("\n");
  assert.match(text, /WORKING/);
  assert.match(text, /0:42/);
});

test("done card shows DONE and hint", () => {
  const text = renderCard("done", 0, 40, 10).map(plain).join("\n");
  assert.match(text, /DONE/);
  assert.match(text, /focus to open/);
});

test("needs card shows NEEDS YOU", () => {
  const text = renderCard("needs", 0, 40, 10).map(plain).join("\n");
  assert.match(text, /NEEDS YOU/);
});

test("working card names the subagents that are keeping it busy", () => {
  const one = renderCard("working", 42, 60, 10, { subagents: 1 })
    .map(plain)
    .join("\n");
  assert.match(one, /0:42 · 1 subagent(?!s)/);
  const many = renderCard("working", 42, 60, 10, { subagents: 3 })
    .map(plain)
    .join("\n");
  assert.match(many, /0:42 · 3 subagents/);
});

test("done card reports background shells you can safely leave running", () => {
  const one = renderCard("done", 0, 60, 10, { shells: 1 })
    .map(plain)
    .join("\n");
  assert.match(one, /DONE/);
  assert.match(one, /focus to open · 1 shell in bg/);
  const many = renderCard("done", 0, 60, 10, { shells: 2 })
    .map(plain)
    .join("\n");
  assert.match(many, /focus to open · 2 shells in bg/);
});

test("a working card with no subagents keeps the bare elapsed clock", () => {
  const text = renderCard("working", 42, 40, 10, { subagents: 0 })
    .map(plain)
    .join("\n");
  assert.doesNotMatch(text, /subagent/);
});

test("subagents never leak onto the DONE card, nor shells onto WORKING", () => {
  // Stop with subagents in flight is never DONE, and a shell never blocks you,
  // so each count belongs to exactly one card.
  const done = renderCard("done", 0, 60, 10, { subagents: 3 })
    .map(plain)
    .join("\n");
  assert.doesNotMatch(done, /subagent/);
  const working = renderCard("working", 5, 60, 10, { shells: 2 })
    .map(plain)
    .join("\n");
  assert.doesNotMatch(working, /shell/);
});

test("unknown state falls back to idle without throwing", () => {
  assert.equal(renderCard("bogus", 0, 40, 6).length, 6);
});

test("CLI render prints a clear-screen frame with WORKING", () => {
  const out = execFileSync(
    "node",
    [
      "bin/herald",
      "render",
      "--surface",
      "curtain-card",
      "--state",
      "working",
      "--since",
      "0",
      "--cols",
      "30",
      "--rows",
      "8",
      "--color",
      "always",
    ],
    { encoding: "utf8" },
  );
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte the clear-screen sequence starts with; intentional.
  assert.match(out, /\x1b\[2J/); // clear screen
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR/CSI sequence; intentional.
  assert.match(out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""), /WORKING/);
});

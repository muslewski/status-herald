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

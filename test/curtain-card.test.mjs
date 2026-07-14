import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { BUILTINS } from "../lib/curtain/themes.mjs";
import { renderCard, renderCardFrame } from "../lib/surfaces/curtain-card.mjs";

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

test("compacting card announces the compaction instead of looking done", () => {
  const text = renderCard("compacting", 0, 40, 10).map(plain).join("\n");
  assert.match(text, /COMPACTING/);
  assert.doesNotMatch(text, /DONE/);
});

test("done card reports how long the turn worked", () => {
  const text = renderCard("done", 0, 60, 10, { worked: 125 })
    .map(plain)
    .join("\n");
  assert.match(text, /worked 2:05/);
  assert.match(text, /focus to open/);
});

test("done card omits the worked line when nothing was timed", () => {
  const text = renderCard("done", 0, 60, 10, { worked: 0 })
    .map(plain)
    .join("\n");
  assert.doesNotMatch(text, /worked/);
});

test("done card stacks the worked clock above the shells hint", () => {
  const text = renderCard("done", 0, 60, 12, { worked: 90, shells: 2 })
    .map(plain)
    .join("\n");
  assert.match(text, /worked 1:30/);
  assert.match(text, /2 shells in bg/);
});

test("unknown state falls back to idle without throwing", () => {
  assert.equal(renderCard("bogus", 0, 40, 6).length, 6);
});

test("CLI render repaints in place (no full-screen clear that would flicker)", () => {
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
  // The flicker fix: home the cursor and overwrite in place rather than erase the
  // whole screen (2J) each frame -- the 2J blanks every row before the repaint.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte the erase-screen sequence starts with; intentional.
  assert.doesNotMatch(out, /\x1b\[2J/); // must NOT clear the screen
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte the cursor-home sequence starts with; intentional.
  assert.match(out, /\x1b\[H/); // homes the cursor instead
  // Wrap is turned off around the paint so a double-width glyph cannot spill onto
  // the next row and scroll the block (which ghosted the label as a second copy).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte the DECAWM sequence starts with; intentional.
  assert.match(out, /\x1b\[\?7l/); // wrap disabled
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR/CSI sequence; intentional.
  assert.match(out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""), /WORKING/);
});

test("CLI render selects the themed frame by --theme and --tick", () => {
  const run = (theme, tick) =>
    execFileSync(
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
        "24",
        "--rows",
        "8",
        "--theme",
        theme,
        "--tick",
        String(tick),
        "--color",
        "always",
      ],
      { encoding: "utf8" },
    )
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR sequence; intentional.
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  // 'classic' has no frames — WORKING is always present regardless of tick.
  assert.match(run("classic", 0), /WORKING/);
  assert.match(run("classic", 7), /WORKING/);
});

test("classic renderCard output is unchanged when theme/tick default", () => {
  // The existing tests above already assert classic content; this pins that
  // passing an explicit classic theme + tick 0 yields the same lines.
  const implicit = renderCard("working", 42, 40, 10);
  const explicit = renderCard("working", 42, 40, 10, {}, BUILTINS.classic, 0);
  assert.deepEqual(explicit, implicit);
});

test("an animated theme selects its frame by tick", () => {
  const theme = {
    background: "transparent",
    states: {
      working: { fg: 33, label: "W", frames: [["AAA"], ["BBB"], ["CCC"]] },
    },
  };
  const at = (tick) =>
    renderCard("working", 0, 20, 8, {}, theme, tick).map(plain).join("\n");
  assert.match(at(0), /AAA/);
  assert.match(at(1), /BBB/);
  assert.match(at(2), /CCC/);
  assert.match(at(3), /AAA/); // wraps: tick % frames.length
});

test("art centers by its ink box on cols, ignoring baked-in indentation", () => {
  // Every line indented 6, ink is 4 wide -> the block must center on cols/2, not
  // sit shifted right because of the leading spaces the author happened to type.
  const theme = {
    background: "transparent",
    states: {
      working: { fg: 33, label: "W", frames: [["      ####", "      ####"]] },
    },
  };
  const cols = 24;
  const lines = renderCard("working", 0, cols, 8, {}, theme, 0).map(plain);
  const row = lines.find((l) => l.includes("####"));
  const lead = row.length - row.trimStart().length;
  const center = lead + 4 / 2;
  assert.ok(
    Math.abs(center - cols / 2) <= 1,
    `ink center ${center} vs ${cols / 2}`,
  );
});

test("forge working art keeps the head centered over the anvil", () => {
  const cols = 30;
  const lines = renderCard("working", 0, cols, 10, {}, BUILTINS.forge, 0).map(
    plain,
  );
  const inkCenter = (l) => {
    const lead = l.length - l.trimStart().length;
    const t = l.replace(/\s+$/, "");
    return (lead + t.length) / 2;
  };
  const anvil = lines.find((l) => l.includes("======="));
  const head = lines.find((l) => l.includes("###"));
  assert.ok(anvil && head, "expected an anvil row and a head row in forge art");
  assert.ok(
    Math.abs(inkCenter(head) - inkCenter(anvil)) <= 1,
    `head center ${inkCenter(head)} vs anvil center ${inkCenter(anvil)}`,
  );
});

test("forge DONE settled frame is multi-row ASCII check on anvil", () => {
  const cols = 40;
  const lines = renderCard(
    "done",
    0,
    cols,
    14,
    { worked: 99 },
    BUILTINS.forge,
    99,
  ).map(plain);
  const joined = lines.join("\n");
  assert.match(joined, /=======/);
  assert.match(joined, /V/);
  assert.doesNotMatch(joined, /[✅✓]/);
  const anvil = lines.find((l) => /=======/.test(l));
  const check = lines.find((l) => /V/.test(l));
  assert.ok(anvil && check, "expected anvil + ASCII check rows");
});

// Plan 014 contract: theme owns art; herald still owns dynamic info under frames.
// Forge geometry tests alone would pass if info concat were dropped.
test("forge framed working card still shows elapsed and subagent info under art", () => {
  const lines = renderCard(
    "working",
    65, // elapsed seconds → 1:05
    40,
    20,
    { subagents: 2, shells: 0, worked: 0 },
    BUILTINS.forge,
    0,
  ).map(plain);
  const joined = lines.join("\n");
  // infoLines working format: `${formatElapsed(elapsed)} · ${plural(n, "subagent")}`
  assert.match(joined, /1:05 · 2 subagents/);
  // Art still present so this is framed path, not classic glyph/label only.
  assert.match(joined, /=======/, "forge anvil art still rendered");
});

test("transparent theme paints no background fill", () => {
  const theme = {
    background: "transparent",
    states: { working: { fg: 33, glyph: "●", label: "W" } },
  };
  const lines = renderCard("working", 0, 20, 6, {}, theme, 0);
  // No line carries a bg SGR (40 = black bg, or 48;5;… = 256 bg).
  for (const l of lines) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR sequence; intentional.
    assert.doesNotMatch(l, /\x1b\[[0-9;]*4[0-9]m/);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR sequence; intentional.
    assert.doesNotMatch(l, /\x1b\[48;5;/);
  }
});

test("solid theme paints a full-width background on every line", () => {
  const lines = renderCard("working", 0, 20, 6, {}, BUILTINS.classic, 0);
  for (const l of lines) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR sequence; intentional.
    assert.match(l, /\x1b\[[0-9;]*40m/); // black bg present (may follow fg codes)
  }
});

test("renderCardFrame erases to end of line on each row (anti-ghost)", () => {
  const theme = {
    background: "transparent",
    states: { done: { fg: 32, glyph: "✓", label: "DONE" } },
  };
  const out = renderCardFrame({
    state: "done",
    elapsedSec: 0,
    cols: 20,
    rows: 6,
    bg: {},
    theme,
    tick: 0,
  });
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR sequence; intentional.
  assert.match(out, /\x1b\[K/); // per-line erase present
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR sequence; intentional.
  assert.doesNotMatch(out, /\x1b\[2J/); // still no full-screen clear
});

test("settleAfter freezes an animated state on its last frame", () => {
  const theme = {
    background: "transparent",
    states: {
      done: {
        fg: 32,
        label: "DONE",
        frames: [["AAA"], ["BBB"], ["CCC"]],
        settleAfter: 3,
      },
    },
  };
  const at = (tick) =>
    renderCard("done", 0, 20, 8, {}, theme, tick).map(plain).join("\n");
  assert.match(at(0), /AAA/); // animating
  assert.match(at(1), /BBB/);
  assert.match(at(2), /CCC/);
  assert.match(at(3), /AAA/); // tick 3 == settleAfter -> still cycling (3 % 3)
  assert.match(at(4), /CCC/, "past settleAfter -> frozen on last frame");
  assert.match(at(50), /CCC/, "stays frozen");
});

test("forge DONE animates sparks then settles on large ASCII check", () => {
  const sparks = renderCard("done", 0, 24, 14, {}, BUILTINS.forge, 0)
    .map(plain)
    .join("\n");
  assert.match(sparks, /\* \. \*/, "tick 0 shows sparks over the billet");
  assert.match(sparks, /=======/, "keeps the anvil");
  assert.match(sparks, /\|###\|/, "working-scale billet");
  const settled = renderCard("done", 0, 24, 14, {}, BUILTINS.forge, 99)
    .map(plain)
    .join("\n");
  assert.doesNotMatch(settled, /\*/, "settled frame has no sparks");
  assert.match(settled, /V/, "ASCII check, not emoji");
  assert.doesNotMatch(settled, /[✅✓]/);
});

test("forge COMPACTING squeezes inward and loops (no settle)", () => {
  const at = (t) =>
    renderCard("compacting", 0, 24, 8, {}, BUILTINS.forge, t)
      .map(plain)
      .join("\n");
  assert.match(at(0), /# # #/, "widest at tick 0");
  assert.match(at(2), /»#«/, "tightest mid-cycle");
  assert.match(at(4), /# # #/, "loops back — compacting never freezes");
});

test("minimal DONE blinks a smile then settles", () => {
  const at = (t) =>
    renderCard("done", 0, 24, 8, {}, BUILTINS.minimal, t).map(plain).join("\n");
  assert.match(at(0), /\^o\^/);
  assert.match(at(99), /\^_\^/, "settles on the calm smile");
});

test("minimal COMPACTING collapses dots to the center", () => {
  const at = (t) =>
    renderCard("compacting", 0, 24, 8, {}, BUILTINS.minimal, t)
      .map(plain)
      .join("\n");
  assert.match(at(0), /· · · · ·/);
  assert.match(at(2), /···/);
});

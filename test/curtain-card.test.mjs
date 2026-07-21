import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { tierFor } from "../lib/curtain/denizens.mjs";
import { BUILTINS } from "../lib/curtain/themes.mjs";
import {
  infoLines,
  renderCard,
  renderCardFrame,
} from "../lib/surfaces/curtain-card.mjs";

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

test("done tail lists parked subagents before shells and monitors", () => {
  const lines = infoLines("done", {
    worked: 297,
    subagents: 2,
    shells: 3,
    watchers: 1,
  });
  const tail = lines.find((l) => l.includes("in bg"));
  assert.ok(tail, "expected a bg inventory line");
  assert.match(tail, /2 subagents in bg · 3 shells in bg · 1 monitor in bg/);
});

test("shells show on WORKING without being called loops or tasks", () => {
  // Bg shells show on WORKING as "N shell" (Claude/Grok background shells).
  const working = renderCard("working", 5, 60, 10, { shells: 2 })
    .map(plain)
    .join("\n");
  assert.match(working, /2 shells/);
  assert.doesNotMatch(working, /loop|watcher|\btasks?\b/);
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

test("infoLines includes tmux session name when provided", () => {
  const lines = infoLines("working", {
    elapsed: 42,
    subagents: 0,
    shells: 0,
    watchers: 0,
    worked: 0,
    sessionName: "grid-a",
  });
  assert.ok(lines.includes("grid-a"), `expected session name in ${lines}`);
});

test("renderCard paints session name on working card", () => {
  const text = renderCard("working", 12, 60, 12, {
    sessionName: "my-sess",
  })
    .map(plain)
    .join("\n");
  assert.match(text, /my-sess/);
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

test("forge framed card: anvil divider shares center with label and figure", () => {
  // Root cause of "equals not aligned": labels used full-width padCenter while
  // art used a rigid 7-col block — DONE/NEEDS YOU left edges drifted from =======.
  const cols = 89;
  const inkCenter = (l) => {
    const a = l.search(/\S/);
    const b = l.trimEnd().length;
    return (a + b) / 2;
  };
  for (const [state, tick, labelRe] of [
    ["working", 0, /WORKING/],
    ["done", 99, /\bDONE\b/],
    ["needs", 0, /NEEDS YOU/],
  ]) {
    const lines = renderCard(
      state,
      0,
      cols,
      24,
      { worked: 90 },
      BUILTINS.forge,
      tick,
    ).map(plain);
    const anvil = lines.find((l) => /={3,}/.test(l));
    const label = lines.find((l) => labelRe.test(l));
    assert.ok(anvil && label, `${state}: anvil + label`);
    assert.ok(
      Math.abs(inkCenter(anvil) - inkCenter(label)) <= 0.5,
      `${state}: anvil center ${inkCenter(anvil)} vs label ${inkCenter(label)}`,
    );
  }
});

test("forge DONE settled check sits on the anvil center axis", () => {
  const cols = 89;
  const lines = renderCard("done", 0, cols, 24, {}, BUILTINS.forge, 99).map(
    plain,
  );
  const inkCenter = (l) => {
    const a = l.search(/\S/);
    const b = l.trimEnd().length;
    return (a + b) / 2;
  };
  const anvil = lines.find((l) => /={3,}/.test(l));
  const vee = lines.find((l) => /V/.test(l));
  const slash = lines.find((l) => /\/\s*$/.test(l.trimEnd()) || /\/\s/.test(l));
  assert.ok(anvil && vee, "anvil + V");
  assert.ok(
    Math.abs(inkCenter(anvil) - inkCenter(vee)) <= 0.5,
    `V center ${inkCenter(vee)} vs anvil ${inkCenter(anvil)}`,
  );
  // Top slash must not sit a full cell right of the anvil center (old art: / at col 5 of 0..6).
  if (slash) {
    assert.ok(
      Math.abs(inkCenter(anvil) - inkCenter(slash)) <= 1.5,
      `slash center ${inkCenter(slash)} vs anvil ${inkCenter(anvil)}`,
    );
  }
});

test("forge art is single-cell ASCII (no ambiguous middle-dot ·)", () => {
  // · is East-Asian Ambiguous width; on some terminals it is 2 cells and
  // walks the ======= divider off the figure mid-animation.
  const frames = Object.values(BUILTINS.forge.states).flatMap(
    (s) => s.frames || [],
  );
  for (const fr of frames) {
    for (const line of fr) {
      assert.doesNotMatch(line, /[·•✅⚠●—…]/);
    }
    // Anvil frames are a fixed 7-col author grid so ======= stays locked to the figure.
    if (fr.some((l) => /={3,}/.test(l))) {
      for (const line of fr) {
        assert.equal(
          line.length,
          7,
          `anvil-grid line must be 7 cols, got ${JSON.stringify(line)}`,
        );
      }
    }
  }
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
  // tick 1 uses ASCII '.' sparks (not middle-dot ·) so cell width stays 1
  const cool = renderCard("done", 0, 24, 14, {}, BUILTINS.forge, 1)
    .map(plain)
    .join("\n");
  assert.match(cool, /\. \./, "cooling sparks are ASCII dots");
  assert.doesNotMatch(cool, /·/);
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

test("optional model line renders when enabled with data", () => {
  const withModel = renderCard("working", 10, 60, 10, {
    subagents: 0,
    modelLine: "grok-4.5@high",
  })
    .map(plain)
    .join("\n");
  assert.match(withModel, /grok-4\.5@high/);
  const off = renderCard("working", 10, 60, 10, { subagents: 0 })
    .map(plain)
    .join("\n");
  assert.doesNotMatch(off, /grok-4\.5/);
});

// --- Act I theatrics (classic stays static; forge gets draw/sparks/breathe) ---

test("classic with theatrics opts stays static (no fabric, no spark flood)", () => {
  const base = renderCard("done", 0, 40, 10, {}, BUILTINS.classic, 0)
    .map(plain)
    .join("\n");
  const withOpts = renderCard("done", 0, 40, 10, {}, BUILTINS.classic, 0, {
    themeName: "classic",
    animCfg: { enabled: true },
    draw: "shut",
    drawProgress: 1,
  })
    .map(plain)
    .join("\n");
  assert.equal(withOpts, base, "classic is the regression baseline");
  assert.doesNotMatch(withOpts, /[░▒▓█]/);
});

test("forge DONE with theatrics paints spark rain into whitespace only", () => {
  const art = renderCard("done", 0, 40, 14, {}, BUILTINS.forge, 0)
    .map(plain)
    .join("\n");
  const rainy = renderCard("done", 0, 40, 14, {}, BUILTINS.forge, 0, {
    themeName: "forge",
    animCfg: { enabled: true },
  })
    .map(plain)
    .join("\n");
  // Sacred anvil / billet markers survive.
  assert.match(rainy, /=======/);
  assert.match(rainy, /\|###\|/);
  // Sparks appear somewhere (overlay may land in margins).
  assert.match(rainy, /[*.+]/);
  // Art rows that had * . * already — still have structure.
  assert.match(art, /\* \. \*/);
});

test("forge stage-curtain shut covers more cells as drawProgress rises", () => {
  const early = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 0, {
    themeName: "forge",
    animCfg: { enabled: true },
    draw: "shut",
    drawProgress: 0.1,
  })
    .map(plain)
    .join("");
  const late = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 0, {
    themeName: "forge",
    animCfg: { enabled: true },
    draw: "shut",
    drawProgress: 0.95,
  })
    .map(plain)
    .join("");
  const count = (s) => (s.match(/[░▒▓█]/g) || []).length;
  assert.ok(count(late) > count(early), "shut ramps fabric coverage");
  assert.match(late, /[░▒▓█]/);
});

test("forge NEEDS breathe modulates red family without hard on/off only", () => {
  // Render at two breathe phases; both stay "needs" red-ish SGR, differ in code.
  const dim = renderCard("needs", 0, 40, 12, {}, BUILTINS.forge, 0, {
    themeName: "forge",
    animCfg: { enabled: true },
    breatheT: 0, // cos(0)=1 → amp 1 → brightRed
  }).join("\n");
  const mid = renderCard("needs", 0, 40, 12, {}, BUILTINS.forge, 0, {
    themeName: "forge",
    animCfg: { enabled: true },
    breatheT: 1.5, // half period of 3s → cos(π)=-1 → amp 0 → red
  }).join("\n");
  assert.match(dim, /NEEDS YOU|\/!\\/);
  assert.match(mid, /NEEDS YOU|\/!\\/);
  // Different SGR (brightRed 91 vs red 31) when color on.
  assert.notEqual(dim, mid);
});

test("forge WORKING paints ambient motes into whitespace only (art sacred)", () => {
  const base = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3)
    .map(plain)
    .join("\n");
  const mo = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3, {
    themeName: "forge",
    animCfg: { enabled: true },
    seed: 1,
  })
    .map(plain)
    .join("\n");
  // Anvil art survives (sacred), motes appear somewhere.
  assert.match(mo, /=======/);
  assert.match(mo, /[·˙ʼ]/, "ambient drift motes present");
  // Every non-space cell of base is still present (no art overwritten).
  const bl = base.split("\n");
  const ml = mo.split("\n");
  for (let r = 0; r < bl.length; r++) {
    for (let c = 0; c < bl[r].length; c++) {
      if (bl[r][c] !== " ") {
        assert.equal(ml[r][c], bl[r][c], `art cell (${r},${c}) preserved`);
      }
    }
  }
});

test("forge WORKING motion-off is byte-identical to no-theatrics baseline", () => {
  const baseline = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3).join(
    "\n",
  );
  const off = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3, {
    themeName: "forge",
    animCfg: { enabled: false },
    seed: 1,
  }).join("\n");
  assert.equal(off, baseline, "motion-off ≡ static baseline (byte-identical)");
});

test("classic WORKING with theatrics stays static (no motes)", () => {
  const base = renderCard("working", 5, 40, 12, {}, BUILTINS.classic, 3).join(
    "\n",
  );
  const withOpts = renderCard("working", 5, 40, 12, {}, BUILTINS.classic, 3, {
    themeName: "classic",
    animCfg: { enabled: true },
    seed: 1,
  }).join("\n");
  assert.equal(withOpts, base);
});

test("WORKING motes render keeps exact rows×cols geometry", () => {
  const out = renderCard("working", 5, 37, 11, {}, BUILTINS.forge, 2, {
    themeName: "forge",
    animCfg: { enabled: true },
    seed: 4,
  });
  assert.equal(out.length, 11);
  for (const l of out) {
    const w = plain(l).length;
    assert.ok(w === 0 || w === 37, `line width ${w} is 0 or exactly cols`);
  }
});

test("WORKING field varies with seed (per-tab variety)", () => {
  const a = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3, {
    themeName: "forge",
    animCfg: { enabled: true },
    seed: 1,
  })
    .map(plain)
    .join("\n");
  const b = renderCard("working", 5, 40, 12, {}, BUILTINS.forge, 3, {
    themeName: "forge",
    animCfg: { enabled: true },
    seed: 900,
  })
    .map(plain)
    .join("\n");
  assert.notEqual(a, b);
});

test("resolveModelLine records beat hint; disabled yields empty", async () => {
  const { resolveModelLine } = await import("../lib/surfaces/curtain-card.mjs");
  assert.equal(resolveModelLine({ enabled: false, modelHint: "x" }), "");
  assert.equal(
    resolveModelLine({
      enabled: true,
      records: [{ model: "m", effort: "high", written_by: "token-oracle" }],
      bestModelRecordFn: () => ({
        model: "m",
        effort: "high",
        written_by: "token-oracle",
      }),
    }),
    "m@high",
  );
  assert.equal(
    resolveModelLine({ enabled: true, modelHint: "hint-only" }),
    "hint-only",
  );
});

// --- Denizens P2 ---
const den = (over = {}) => ({
  themeName: "forge",
  animCfg: { enabled: true },
  entity: "fox",
  seed: 0,
  ...over,
});

test("forge working card renders a denizen into whitespace", () => {
  const out = renderCard("working", 5, 60, 20, {}, BUILTINS.forge, 0, den())
    .map(plain)
    .join("\n");
  assert.match(out, /=======/, "anvil art still present");
  assert.match(out, /o\.o|\^\.\^|~\^~|> \^ <|\/\\_\/\\/, "fox glyphs present");
});

test("denizen never overwrites base art (art sacred)", () => {
  const out = renderCard("working", 5, 60, 20, {}, BUILTINS.forge, 0, den())
    .map(plain)
    .join("\n");
  assert.match(out, /\|###\|/);
  assert.match(out, /=======/);
});

test("classic ignores entity/seed (byte-identical)", () => {
  const base = renderCard("working", 5, 60, 20, {}, BUILTINS.classic, 0)
    .map(plain)
    .join("\n");
  const withEnt = renderCard("working", 5, 60, 20, {}, BUILTINS.classic, 0, {
    themeName: "classic",
    animCfg: { enabled: true },
    entity: "fox",
    seed: 3,
  })
    .map(plain)
    .join("\n");
  assert.equal(withEnt, base);
});

test("renderCard keeps exact geometry with a denizen", () => {
  const lines = renderCard("working", 5, 60, 20, {}, BUILTINS.forge, 0, den());
  assert.equal(lines.length, 20);
  for (const line of lines.map(plain)) {
    assert.ok(line.length <= 60, `line width ${line.length}`);
  }
});

test("too-small card degrades: no denizen glyphs", () => {
  // RECONCILE R1: none when rows < 5 || cols < 11
  assert.equal(tierFor(4, 12), "none");
  assert.equal(tierFor(5, 10), "none");
  const tiny = renderCard("working", 5, 10, 4, {}, BUILTINS.forge, 0, den())
    .map(plain)
    .join("\n");
  assert.doesNotMatch(tiny, /o\.o/);
});

test("motion-off freezes denizen to cel 0", () => {
  // Theme art may still flip; denizen itself is frozen at tick 0.
  // fox working full frame0 has "( o.o )~"; frame1 has "( o.o)~ " (tail side flip).
  const opts = den({ animCfg: { enabled: false } });
  const a = renderCard("working", 5, 60, 20, {}, BUILTINS.forge, 0, opts)
    .map(plain)
    .join("\n");
  const b = renderCard("working", 5, 60, 20, {}, BUILTINS.forge, 5, opts)
    .map(plain)
    .join("\n");
  assert.match(a, /\( o\.o \)~/);
  assert.match(b, /\( o\.o \)~/);
  // Unfrozen would use tick%2 → frame1 at tick 5 with seed 0
  const live = renderCard(
    "working",
    5,
    60,
    20,
    {},
    BUILTINS.forge,
    5,
    den({ animCfg: { enabled: true } }),
  )
    .map(plain)
    .join("\n");
  assert.match(live, /\( o\.o\)~/);
});

test("seed phase-offsets co-launched tabs", () => {
  const s0 = renderCard(
    "working",
    5,
    60,
    20,
    {},
    BUILTINS.forge,
    0,
    den({ seed: 0 }),
  )
    .map(plain)
    .join("\n");
  const s1 = renderCard(
    "working",
    5,
    60,
    20,
    {},
    BUILTINS.forge,
    0,
    den({ seed: 1 }),
  )
    .map(plain)
    .join("\n");
  assert.notEqual(s0, s1);
});

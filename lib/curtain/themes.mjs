import { globToRe, loadConfig, merge } from "../config.mjs";

// The current hardcoded look, now expressed as data. Byte-identical: solid
// black background, same glyph/label/fg per state as the old CARDS map. This
// is the default, so a user who configures nothing sees no change.
export const BUILTINS = {
  classic: {
    background: "solid",
    bgColor: "black",
    states: {
      working: { fg: "brightYellow", glyph: "●", label: "WORKING" },
      compacting: { fg: "cyan", glyph: "⟳", label: "COMPACTING" },
      done: { fg: "brightGreen", glyph: "✅", label: "DONE" },
      needs: { fg: "brightRed", glyph: "⚠", label: "NEEDS YOU" },
      idle: { fg: "gray", glyph: "—", label: "" },
    },
  },
  minimal: {
    background: "transparent",
    states: {
      working: { fg: "brightYellow", glyph: "●", label: "WORKING" },
      compacting: {
        fg: "cyan",
        label: "COMPACTING",
        frames: [["· · · · ·"], ["· ··· ·"], ["···"], ["· ··· ·"]],
      },
      done: {
        fg: "brightGreen",
        label: "DONE",
        frames: [["^o^"], ["^_^"]],
        settleAfter: 6,
      },
      needs: { fg: "brightRed", glyph: "⚠", label: "NEEDS YOU" },
      idle: { fg: "gray", glyph: "—", label: "" },
    },
  },
  forge: {
    background: "transparent",
    states: {
      working: {
        fg: "brightYellow",
        label: "WORKING",
        // Mallet taps the anvil: head raised, drops a row, strikes with sparks.
        // 5-row grid, every line 7 wide with the head centered over the anvil so
        // the whole figure shares one axis.
        frames: [
          [" .---. ", " |###| ", " '-+-' ", "   |   ", "======="],
          ["       ", " .---. ", " |###| ", " '-+-' ", "======="],
          ["       ", " .---. ", "*|###|*", " '-+-' ", "==='==="],
        ],
      },
      compacting: {
        fg: "cyan",
        label: "COMPACTING",
        // Jaws squeeze the stock to center, then breathe back out (loops).
        frames: [["» # # # «"], ["» ### «"], ["»#«"], ["» ### «"]],
      },
      done: {
        fg: "brightGreen",
        label: "DONE",
        // Struck piece cooling on the anvil: sparks fade to a clean ✓, then hold.
        frames: [
          [" * ✓ *", "======="],
          [" · ✓ ·", "======="],
          ["   ✓   ", "======="],
        ],
        settleAfter: 6,
      },
      needs: {
        fg: "brightRed",
        label: "NEEDS YOU",
        frames: [["  /!\\", "  ! !"]],
      },
      idle: { fg: "gray", glyph: "—", label: "" },
    },
  },
};

// Which theme a session wears: first themeBySession glob to match, else the
// global default, else classic. Reuses the arming glob matcher.
export const themeNameFor = (sessionName, cfg = loadConfig().curtain) => {
  const map = cfg?.themeBySession || {};
  for (const glob of Object.keys(map))
    if (globToRe(glob).test(sessionName)) return map[glob];
  return cfg?.theme || "classic";
};

// Resolve a theme NAME to its merged object: builtin base, then the user's
// same-named override/definition, then top-level visual overrides last. An
// unknown name falls back to classic so render never throws on a typo.
export const resolveThemeByName = (name, cfg = loadConfig().curtain) => {
  const base = BUILTINS[name] || BUILTINS.classic;
  const user = cfg?.themes?.[name] || {};
  const top = {};
  for (const k of ["background", "bgColor", "layout"])
    if (cfg?.[k] !== undefined) top[k] = cfg[k];
  return merge(merge(base, user), top);
};

export const isAnimated = (theme) =>
  Object.values(theme?.states || {}).some(
    (s) => Array.isArray(s?.frames) && s.frames.length > 1,
  );

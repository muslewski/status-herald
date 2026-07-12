// Minimal ANSI render helpers for HERALD surfaces.
// Forward-compatible with the full plan-002 render core (same export shape).

export const ESC = "\x1b";
export const CSI = `${ESC}[`;

const FG = {
  default: 39,
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
};
const BG = { default: 49, black: 40 };

// Resolve a color spec to an SGR parameter string: a named key, a raw number
// (30-107 style SGR), or a pre-formed digit/semicolon string ("38;5;208").
const sgrOf = (val, table) => {
  if (val == null) return null;
  if (typeof val === "number") return String(val);
  if (table[val] != null) return String(table[val]);
  if (typeof val === "string" && /^[0-9;]+$/.test(val)) return val;
  return null;
};

export const color = (text, { fg, bg, bold } = {}) => {
  const codes = [];
  if (bold) codes.push(1);
  const f = sgrOf(fg, FG);
  if (f) codes.push(f);
  const b = sgrOf(bg, BG);
  if (b) codes.push(b);
  if (codes.length === 0) return text;
  return `${CSI}${codes.join(";")}m${text}${CSI}0m`;
};

// Visible width, ignoring SGR escapes. Codepoint count (emoji may render
// wider; card centering tolerates a 1-col drift — cosmetic only).
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte that opens an SGR sequence; intentional.
export const visibleWidth = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;

export const padCenter = (text, width) => {
  const w = visibleWidth(text);
  if (w >= width) return text;
  const left = Math.floor((width - w) / 2);
  const right = width - w - left;
  return " ".repeat(left) + text + " ".repeat(right);
};

export const clearScreen = () => `${CSI}2J${CSI}H`;
// Home the cursor without erasing. A repainting TUI that clears the whole screen
// (2J) every frame flashes: the screen goes blank, then the text draws back in.
// Homing and overwriting each cell in place skips the blank frame entirely -- an
// unchanged cell is rewritten with its own value, so nothing visibly flickers.
export const cursorHome = () => `${CSI}H`;
// Erase from the cursor to the end of the screen. Used once after a full-frame
// repaint to clear anything the previous, taller frame left below (resize down).
export const eraseBelow = () => `${CSI}J`;
// Turn line-wrap (DECAWM) off / on. A "full-width" line built with padCenter is
// padded to `cols` by codepoint count, but a double-width glyph (✅ is two cells)
// makes it one cell too wide -- with wrap on, that spills onto the next row and
// scrolls the block, ghosting the label. Wrap off clips the overflow at the
// margin instead, which is exactly what a full-screen repaint wants.
export const disableWrap = () => `${CSI}?7l`;
export const enableWrap = () => `${CSI}?7h`;
export const hideCursor = () => `${CSI}?25l`;

// Erase from the cursor to the end of the line. Emitted after every rendered
// line in transparent mode so a shorter new frame cannot leave the previous
// frame's cells behind (no full-width bg fill overwrites them there).
export const eraseLine = () => `${CSI}K`;

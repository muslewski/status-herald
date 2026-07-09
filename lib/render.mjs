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

export const color = (text, { fg, bg, bold } = {}) => {
  const codes = [];
  if (bold) codes.push(1);
  if (fg && FG[fg] != null) codes.push(FG[fg]);
  if (bg && BG[bg] != null) codes.push(BG[bg]);
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
export const hideCursor = () => `${CSI}?25l`;

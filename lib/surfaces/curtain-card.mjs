import { color, padCenter, clearScreen, hideCursor } from "../render.mjs";
import { STATES, formatElapsed } from "../curtain/state.mjs";

const CARDS = {
  [STATES.WORKING]: (e) => ({ glyph: "●", label: "WORKING", sub: formatElapsed(e), fg: "brightYellow" }),
  [STATES.DONE]:    () => ({ glyph: "✅", label: "DONE", sub: "focus to open", fg: "brightGreen" }),
  [STATES.NEEDS]:   () => ({ glyph: "⚠", label: "NEEDS YOU", sub: "focus to open", fg: "brightRed" }),
  [STATES.IDLE]:    () => ({ glyph: "—", label: "", sub: "", fg: "gray" }),
};

// Pure: exactly `rows` strings, each a full-width black-bg line, card centered.
export const renderCard = (state, elapsedSec, cols, rows) => {
  const spec = (CARDS[state] || CARDS[STATES.IDLE])(elapsedSec);
  const block = [spec.glyph, spec.label, spec.sub].filter((l) => l !== "");
  const top = Math.max(0, Math.floor((rows - block.length) / 2));
  const blank = color(" ".repeat(cols), { bg: "black" });
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const bi = r - top;
    if (bi >= 0 && bi < block.length) {
      lines.push(color(padCenter(block[bi], cols), { bg: "black", fg: spec.fg, bold: block[bi] === spec.label }));
    } else {
      lines.push(blank);
    }
  }
  return lines;
};

export const renderCardFrame = ({ state, elapsedSec, cols, rows }) =>
  hideCursor() + clearScreen() + renderCard(state, elapsedSec, cols, rows).join("\r\n");

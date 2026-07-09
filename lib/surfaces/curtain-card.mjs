import { STATES, formatElapsed } from "../curtain/state.mjs";
import { clearScreen, color, hideCursor, padCenter } from "../render.mjs";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const CARDS = {
  // Subagents keep the main agent busy, so they belong on the WORKING card:
  // they explain why a session that already printed its answer is still going.
  [STATES.WORKING]: ({ elapsed, subagents }) => ({
    glyph: "●",
    label: "WORKING",
    sub: subagents
      ? `${formatElapsed(elapsed)} · ${plural(subagents, "subagent")}`
      : formatElapsed(elapsed),
    fg: "brightYellow",
  }),
  // A background shell does not hold you up -- a CI watch can finish on its own
  // while you move to the next thing -- so it annotates DONE rather than blocking it.
  [STATES.DONE]: ({ shells }) => ({
    glyph: "✅",
    label: "DONE",
    sub: shells
      ? `focus to open · ${plural(shells, "shell")} in bg`
      : "focus to open",
    fg: "brightGreen",
  }),
  [STATES.NEEDS]: () => ({
    glyph: "⚠",
    label: "NEEDS YOU",
    sub: "focus to open",
    fg: "brightRed",
  }),
  [STATES.IDLE]: () => ({ glyph: "—", label: "", sub: "", fg: "gray" }),
};

// Pure: exactly `rows` strings, each a full-width black-bg line, card centered.
export const renderCard = (state, elapsedSec, cols, rows, bg = {}) => {
  const spec = (CARDS[state] || CARDS[STATES.IDLE])({
    elapsed: elapsedSec,
    subagents: Number(bg.subagents) || 0,
    shells: Number(bg.shells) || 0,
  });
  const block = [spec.glyph, spec.label, spec.sub].filter((l) => l !== "");
  const top = Math.max(0, Math.floor((rows - block.length) / 2));
  const blank = color(" ".repeat(cols), { bg: "black" });
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const bi = r - top;
    if (bi >= 0 && bi < block.length) {
      lines.push(
        color(padCenter(block[bi], cols), {
          bg: "black",
          fg: spec.fg,
          bold: block[bi] === spec.label,
        }),
      );
    } else {
      lines.push(blank);
    }
  }
  return lines;
};

export const renderCardFrame = ({ state, elapsedSec, cols, rows, bg }) =>
  hideCursor() +
  clearScreen() +
  renderCard(state, elapsedSec, cols, rows, bg).join("\r\n");

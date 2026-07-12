import { STATES, formatElapsed } from "../curtain/state.mjs";
import {
  color,
  cursorHome,
  disableWrap,
  enableWrap,
  eraseBelow,
  hideCursor,
  padCenter,
} from "../render.mjs";

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
  // Compaction is under way: a distinct face so a moshed tab reads as busy, not
  // ready. No count -- it is the main agent itself that is occupied.
  [STATES.COMPACTING]: () => ({
    glyph: "⟳",
    label: "COMPACTING",
    sub: "compressing context…",
    fg: "cyan",
  }),
  // A background shell does not hold you up -- a CI watch can finish on its own
  // while you move to the next thing -- so it annotates DONE rather than blocking
  // it. The frozen `worked` clock (top line) says how long the turn took.
  [STATES.DONE]: ({ shells, worked }) => ({
    glyph: "✅",
    label: "DONE",
    sub: [
      worked ? `worked ${formatElapsed(worked)}` : "",
      shells
        ? `focus to open · ${plural(shells, "shell")} in bg`
        : "focus to open",
    ],
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
    worked: Number(bg.worked) || 0,
  });
  // `sub` may be one line or several (DONE stacks "worked" above the hint).
  const subLines = Array.isArray(spec.sub) ? spec.sub : [spec.sub];
  const block = [spec.glyph, spec.label, ...subLines].filter(
    (l) => l !== "" && l != null,
  );
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

// Repaint in place: home the cursor, overwrite every full-width row, then erase
// anything a taller previous frame left below. No 2J clear, so the card never
// blanks between frames -- that full-screen erase is what made the rows flicker.
// Wrap is disabled around the paint so a double-width glyph (✅) that pushes its
// row one cell past `cols` is clipped at the margin instead of wrapping onto the
// next row and scrolling the block -- the wrap-scroll is what doubled the label.
export const renderCardFrame = ({ state, elapsedSec, cols, rows, bg }) =>
  hideCursor() +
  disableWrap() +
  cursorHome() +
  renderCard(state, elapsedSec, cols, rows, bg).join("\r\n") +
  eraseBelow() +
  enableWrap();

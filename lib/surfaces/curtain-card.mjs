import { formatElapsed } from "../curtain/state.mjs";
import { BUILTINS } from "../curtain/themes.mjs";
import {
  color,
  cursorHome,
  disableWrap,
  enableWrap,
  eraseBelow,
  eraseLine,
  hideCursor,
  padCenter,
  visibleWidth,
} from "../render.mjs";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Herald-owned dynamic lines: the live numbers a theme must not rewrite. Same
// text the old CARDS map produced as `sub`, so classic stays byte-identical.
export const infoLines = (state, { elapsed, subagents, shells, worked }) => {
  switch (state) {
    case "working":
      return [
        subagents
          ? `${formatElapsed(elapsed)} · ${plural(subagents, "subagent")}`
          : formatElapsed(elapsed),
      ];
    case "compacting":
      return ["compressing context…"];
    case "done":
      return [
        worked ? `worked ${formatElapsed(worked)}` : "",
        shells
          ? `focus to open · ${plural(shells, "shell")} in bg`
          : "focus to open",
      ];
    case "needs":
      return ["focus to open"];
    default:
      return [""];
  }
};

const bgOf = (theme) =>
  typeof theme.bgColor === "number"
    ? `48;5;${theme.bgColor}`
    : theme.bgColor || "black";

// Pick this tick's frame. A state may set `settleAfter`: once tick passes it,
// freeze on the last frame — so "done" can breathe a few cycles then hold calm
// without making the stateless loop stateful (tick is supplied per render).
const pickFrame = (st, tick) => {
  if (!Array.isArray(st?.frames) || !st.frames.length) return null;
  const n = st.frames.length;
  if (Number.isFinite(st.settleAfter) && tick > st.settleAfter)
    return st.frames[n - 1];
  return st.frames[tick % n];
};

// Center an art frame as a RIGID block on its TIGHT ink box: strip the common
// leading indent (so whatever spaces the author happened to type don't push the
// block off-center) and trailing space, then center by the widest ink line. The
// frame still moves as one unit — its internal shape (e.g. a hammer head over an
// anvil) is the author's and is preserved; only the block's own margin is set.
const marginFrame = (frame, cols) => {
  const ink = frame.filter((l) => l.trim() !== "");
  const indent = ink.length
    ? Math.min(...ink.map((l) => l.length - l.trimStart().length))
    : 0;
  const trimmed = frame.map((l) => l.slice(indent).replace(/\s+$/, ""));
  const w = Math.max(0, ...trimmed.map(visibleWidth));
  const left = Math.max(0, Math.floor((cols - w) / 2));
  const pad = " ".repeat(left);
  return trimmed.map((l) => pad + l);
};

const fillTo = (s, cols) => {
  const w = visibleWidth(s);
  return w < cols ? s + " ".repeat(cols - w) : s;
};

// A single short line (glyph/label/info), centered. Solid: padCenter + bg fill
// (identical to the old classic path). Transparent: left margin only, no fill.
const textLine = (text, cols, solid, bgSpec, fg, bold) =>
  solid
    ? color(padCenter(text, cols), { bg: bgSpec, fg, bold })
    : " ".repeat(Math.max(0, Math.floor((cols - visibleWidth(text)) / 2))) +
      color(text, { fg, bold });

// A pre-margined art line. Solid: right-fill to cols on the bg. Transparent:
// as-is (the per-line eraseLine in the frame clears the rest).
const artLine = (marginedText, cols, solid, bgSpec, fg) =>
  solid
    ? color(fillTo(marginedText, cols), { bg: bgSpec, fg })
    : color(marginedText, { fg });

const blankLine = (cols, solid, bgSpec) =>
  solid ? color(" ".repeat(cols), { bg: bgSpec }) : "";

// Pure: exactly `rows` strings. Theme owns the visual (art frame, or glyph +
// label); herald owns the info lines. classic (no frames) reproduces the old
// glyph/label/info block, solid, byte-for-byte.
export const renderCard = (
  state,
  elapsedSec,
  cols,
  rows,
  bg = {},
  theme = BUILTINS.classic,
  tick = 0,
) => {
  const st = (theme.states && (theme.states[state] || theme.states.idle)) || {};
  const solid = theme.background !== "transparent";
  const bgSpec = solid ? bgOf(theme) : undefined;
  const fg = st.fg;

  const frame = pickFrame(st, tick);
  const art = frame ? marginFrame(frame, cols) : [];
  const info = infoLines(state, {
    elapsed: elapsedSec,
    subagents: Number(bg.subagents) || 0,
    shells: Number(bg.shells) || 0,
    worked: Number(bg.worked) || 0,
  });
  // With frames, the label (if any) rides below the art; without frames it is
  // the classic glyph + label pair.
  const text = (frame ? (st.label ? [st.label] : []) : [st.glyph, st.label])
    .concat(info)
    .filter((l) => l !== "" && l != null);

  const blockLen = art.length + text.length;
  const top = Math.max(0, Math.floor((rows - blockLen) / 2));
  const out = [];
  for (let r = 0; r < rows; r++) {
    const bi = r - top;
    if (bi >= 0 && bi < art.length) {
      out.push(artLine(art[bi], cols, solid, bgSpec, fg));
    } else if (bi >= art.length && bi < blockLen) {
      const line = text[bi - art.length];
      const bold = st.label !== "" && st.label != null && line === st.label;
      out.push(textLine(line, cols, solid, bgSpec, fg, bold));
    } else {
      out.push(blankLine(cols, solid, bgSpec));
    }
  }
  return out;
};

// Repaint in place: home the cursor, overwrite each row, erase to end-of-line
// after every row (clears a shorter transparent frame's ghosts; a no-op after a
// full-width solid line), then erase below for a shrunk frame. Wrap off/on so a
// wide glyph clips at the margin instead of wrap-scrolling the block.
export const renderCardFrame = ({
  state,
  elapsedSec,
  cols,
  rows,
  bg,
  theme,
  tick,
}) =>
  hideCursor() +
  disableWrap() +
  cursorHome() +
  renderCard(state, elapsedSec, cols, rows, bg, theme, tick)
    .map((l) => l + eraseLine())
    .join("\r\n") +
  eraseBelow() +
  enableWrap();

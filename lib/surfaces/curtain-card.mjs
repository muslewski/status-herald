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
export const infoLines = (
  state,
  { elapsed, subagents, shells, watchers, worked },
) => {
  const w = Number(watchers) || 0;
  const sh = Number(shells) || 0;
  switch (state) {
    case "working": {
      // Distinct labels: subagents · loops/watchers · bg tasks (not all "loops").
      const bits = [formatElapsed(elapsed)];
      if (subagents) bits.push(plural(subagents, "subagent"));
      if (w) bits.push(plural(w, "watcher"));
      if (sh) bits.push(plural(sh, "task"));
      return [bits.join(" · ")];
    }
    case "compacting":
      return ["compressing context…"];
    case "done": {
      const tail = [];
      if (sh) tail.push(`${plural(sh, "task")} in bg`);
      if (w) tail.push(`${plural(w, "watcher")} in bg`);
      return [
        worked ? `worked ${formatElapsed(worked)}` : "",
        tail.length ? `focus to open · ${tail.join(" · ")}` : "focus to open",
      ];
    }
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

// Normalize an art frame to a RIGID equal-width block (no screen centering yet):
// strip common leading indent + trailing space, then right-pad every line to the
// ink-box width. Without the pad, author padding like " .---. " loses its
// trailing spaces and head/anvil no longer share a center axis.
const normalizeFrame = (frame) => {
  const ink = frame.filter((l) => l.trim() !== "");
  const indent = ink.length
    ? Math.min(...ink.map((l) => l.length - l.trimStart().length))
    : 0;
  const trimmed = frame.map((l) => l.slice(indent).replace(/\s+$/, ""));
  const w = Math.max(0, ...trimmed.map(visibleWidth));
  return trimmed.map((l) => {
    const gap = w - visibleWidth(l);
    return gap > 0 ? l + " ".repeat(gap) : l;
  });
};

// Center `text` inside a fixed cell width (pad both sides). Used so art +
// labels + info share one horizontal block whose divider (=======) lines up
// with everything above/below instead of each line re-centering on `cols`.
const centerIn = (text, width) => {
  const tw = visibleWidth(text);
  if (tw >= width) return text;
  const left = Math.floor((width - tw) / 2);
  const right = width - tw - left;
  return " ".repeat(left) + text + " ".repeat(right);
};

// Legacy name kept for tests/docs: normalize + screen-center the art alone.
const marginFrame = (frame, cols) => {
  const boxed = normalizeFrame(frame);
  const w = boxed.length ? Math.max(...boxed.map(visibleWidth)) : 0;
  const left = Math.max(0, Math.floor((cols - w) / 2));
  const pad = " ".repeat(left);
  return boxed.map((l) => pad + l);
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

// A pre-margined line already positioned in the content block. Solid: right-fill
// to cols on the bg. Transparent: color the whole pre-padded string (leading
// spaces stay inside SGR so the block does not shift).
const blockLine = (marginedText, cols, solid, bgSpec, fg, bold) =>
  solid
    ? color(fillTo(marginedText, cols), { bg: bgSpec, fg, bold })
    : color(marginedText, { fg, bold });

const blankLine = (cols, solid, bgSpec) =>
  solid ? color(" ".repeat(cols), { bg: bgSpec }) : "";

// Pure: exactly `rows` strings. Theme owns the visual (art frame, or glyph +
// label); herald owns the info lines. classic (no frames) reproduces the old
// glyph/label/info block, solid, byte-for-byte.
//
// Framed themes (forge/minimal): art + label + info are ONE horizontal block.
// All lines share the same left margin (centered on max width). That keeps the
// forge anvil divider (=======) aligned with the figure and the labels instead
// of each text line independently re-centering on the full terminal width.
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
  const info = infoLines(state, {
    elapsed: elapsedSec,
    subagents: Number(bg.subagents) || 0,
    shells: Number(bg.shells) || 0,
    watchers: Number(bg.watchers) || 0,
    worked: Number(bg.worked) || 0,
  });
  // With frames, the label (if any) rides below the art; without frames it is
  // the classic glyph + label pair.
  const text = (frame ? (st.label ? [st.label] : []) : [st.glyph, st.label])
    .concat(info)
    .filter((l) => l !== "" && l != null);

  const out = [];
  if (frame) {
    // Art is a rigid ink box (e.g. forge 7-col anvil grid). Screen-center that
    // box once; nest short labels inside it; pin longer info to the SAME center
    // axis. Do NOT grow the art box to the widest text — that inset the =======
    // divider with side padding and made the equals look shifted under WORKING.
    const art = normalizeFrame(frame);
    const artW = art.length ? Math.max(...art.map(visibleWidth)) : 0;
    const artLeft = Math.max(0, Math.floor((cols - artW) / 2));
    const artPad = " ".repeat(artLeft);
    const artCenter = artLeft + artW / 2;
    const content = [
      ...art.map((l) => ({
        plain: artPad + l, // already artW wide from normalizeFrame
        bold: false,
      })),
      ...text.map((l) => {
        const tw = visibleWidth(l);
        let plain;
        if (tw <= artW) {
          plain = artPad + centerIn(l, artW);
        } else {
          const left = Math.max(0, Math.floor(artCenter - tw / 2));
          plain = " ".repeat(left) + l;
        }
        return {
          plain,
          bold: st.label !== "" && st.label != null && l === st.label,
        };
      }),
    ];
    const top = Math.max(0, Math.floor((rows - content.length) / 2));
    for (let r = 0; r < rows; r++) {
      const bi = r - top;
      if (bi >= 0 && bi < content.length) {
        out.push(
          blockLine(content[bi].plain, cols, solid, bgSpec, fg, content[bi].bold),
        );
      } else {
        out.push(blankLine(cols, solid, bgSpec));
      }
    }
  } else {
    // Classic path: each short line independently centered (byte-stable).
    const top = Math.max(0, Math.floor((rows - text.length) / 2));
    for (let r = 0; r < rows; r++) {
      const bi = r - top;
      if (bi >= 0 && bi < text.length) {
        const line = text[bi];
        const bold = st.label !== "" && st.label != null && line === st.label;
        out.push(textLine(line, cols, solid, bgSpec, fg, bold));
      } else {
        out.push(blankLine(cols, solid, bgSpec));
      }
    }
  }
  return out;
};

// Exported for unit tests that pin rigid art geometry.
export { marginFrame, normalizeFrame, centerIn };

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

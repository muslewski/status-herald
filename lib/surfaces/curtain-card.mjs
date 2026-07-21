import { denizenCel, placeDenizen, tierFor } from "../curtain/denizens.mjs";
import { formatElapsed } from "../curtain/state.mjs";
import {
  applyTheatrics,
  breatheAmp,
  motionDisabled,
  selectEffects,
} from "../curtain/theatrics.mjs";
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
// Optional model / sage zone lines append when cfg.lines.* is on and data exists.
export const infoLines = (
  state,
  {
    elapsed,
    subagents,
    shells,
    watchers,
    worked,
    modelLine,
    sageZone,
    sessionName,
  },
) => {
  const w = Number(watchers) || 0;
  const sh = Number(shells) || 0;
  const extras = [];
  // Tmux session name on the card so multi-pane grids are scannable.
  const sess = String(sessionName || "").trim();
  if (sess) extras.push(sess);
  if (modelLine) extras.push(String(modelLine));
  if (sageZone) extras.push(`zone ${sageZone}`);
  switch (state) {
    case "working": {
      // Match Claude Code inventory: shells · monitors · agents (subagents).
      // Grok /loop + scheduler watchers share the monitor label (same role).
      const bits = [formatElapsed(elapsed)];
      if (subagents) bits.push(plural(subagents, "subagent"));
      if (sh) bits.push(plural(sh, "shell"));
      if (w) bits.push(plural(w, "monitor"));
      return [bits.join(" · "), ...extras];
    }
    case "compacting":
      return ["compressing context…", ...extras];
    case "done": {
      const tail = [];
      const subs = Number(subagents) || 0;
      if (subs) tail.push(`${plural(subs, "subagent")} in bg`);
      if (sh) tail.push(`${plural(sh, "shell")} in bg`);
      if (w) tail.push(`${plural(w, "monitor")} in bg`);
      return [
        worked ? `worked ${formatElapsed(worked)}` : "",
        tail.length ? `focus to open · ${tail.join(" · ")}` : "focus to open",
        ...extras,
      ];
    }
    case "needs":
      return ["focus to open", ...extras];
    default:
      return ["", ...extras];
  }
};

/**
 * Resolve optional model line: session records → @herald_model_hint.
 * Soft-fail: returns "" when disabled or data absent.
 */
export const resolveModelLine = ({
  enabled = false,
  records = [],
  sourceCli = "",
  pid = 0,
  modelHint = "",
  bestModelRecordFn,
} = {}) => {
  if (!enabled) return "";
  try {
    const pick =
      typeof bestModelRecordFn === "function" ? bestModelRecordFn : null;
    if (pick) {
      const best = pick(records, { sourceCli, pid });
      if (best?.model) {
        return best.effort ? `${best.model}@${best.effort}` : best.model;
      }
    }
    if (modelHint) return String(modelHint);
  } catch {
    /* soft-fail */
  }
  return "";
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
//
// Optional 8th arg `theatrics` (Act I): stage-curtain draw, DONE spark rain,
// NEEDS breathe. classic + motion-off leave this path unused → byte-identical.
export const renderCard = (
  state,
  elapsedSec,
  cols,
  rows,
  bg = {},
  theme = BUILTINS.classic,
  tick = 0,
  theatrics = null,
) => {
  const st = (theme.states && (theme.states[state] || theme.states.idle)) || {};
  const solid = theme.background !== "transparent";
  const bgSpec = solid ? bgOf(theme) : undefined;
  let fg = st.fg;

  // Resolve which Act I effects apply (classic / motion-off → none).
  const effects =
    theatrics?.effects ||
    (theatrics
      ? selectEffects({
          state,
          themeName: theatrics.themeName || "classic",
          animCfg: theatrics.animCfg || {},
        })
      : null);

  // NEEDS crimson breathe: soft dim⇄bright on the card ink (no hard strobe).
  if (effects?.breathe) {
    const period = Number(theatrics?.breathePeriodSec) || 3;
    const t =
      theatrics?.breatheT != null ? Number(theatrics.breatheT) : tick * 0.5; // ~2 fps → seconds-ish
    const amp = breatheAmp(t, period);
    // brightRed when high, red when low — still always "attention" red family.
    fg = amp >= 0.5 ? "brightRed" : "red";
  }

  // Act II: per-session creature replaces theme art (hammer/anvil), not a
  // second layer on top. classic / denizens-off / tiny cards → normal frames.
  const denCfg = theatrics?.animCfg?.denizens;
  const denizensOn =
    theatrics &&
    (theatrics.themeName || "classic") !== "classic" &&
    (denCfg ? denCfg.enabled !== false : true);
  let denizenArt = null; // cropped cel used AS the main art block
  if (denizensOn && theatrics.entity) {
    const tier = tierFor(rows, cols);
    if (tier !== "none") {
      const frozen = motionDisabled(theatrics.animCfg || {});
      const cel = denizenCel({
        species: theatrics.entity,
        state: state || "idle",
        tier,
        tick: frozen ? 0 : tick,
        seed: Number(theatrics.seed) || 0,
      });
      if (cel.length) {
        // Crop to ink bbox; layout path centers the block like any other frame.
        denizenArt = placeDenizen(cel, cols, rows).cel;
      }
    }
  }

  // Creature frame wins over theme art (forge mallet, etc.).
  const frame = denizenArt || pickFrame(st, tick);
  const info = infoLines(state, {
    elapsed: elapsedSec,
    subagents: Number(bg.subagents) || 0,
    shells: Number(bg.shells) || 0,
    watchers: Number(bg.watchers) || 0,
    worked: Number(bg.worked) || 0,
    modelLine: bg.modelLine || "",
    sageZone: bg.sageZone || "",
    sessionName: bg.sessionName || "",
  });
  // With frames, the label (if any) rides below the art; without frames it is
  // the classic glyph + label pair.
  const text = (frame ? (st.label ? [st.label] : []) : [st.glyph, st.label])
    .concat(info)
    .filter((l) => l !== "" && l != null);

  // Build PLAIN geometry first when theatrics will composite (motes/draw/burst),
  // so we can merge without splicing SGR. Recolor after. Classic/static keeps the
  // historical path that paints SGR per line (byte-identical).
  const wantComposite =
    effects &&
    (effects.burst ||
      effects.motes ||
      (effects.stageDraw &&
        (theatrics?.draw === "shut" || theatrics?.draw === "open")));

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
        if (wantComposite) {
          const p = content[bi].plain;
          const w = visibleWidth(p);
          out.push(w < cols ? p + " ".repeat(cols - w) : p);
        } else {
          out.push(
            blockLine(
              content[bi].plain,
              cols,
              solid,
              bgSpec,
              fg,
              content[bi].bold,
            ),
          );
        }
      } else {
        out.push(
          wantComposite
            ? solid
              ? " ".repeat(cols)
              : ""
            : blankLine(cols, solid, bgSpec),
        );
      }
    }
  } else {
    // Classic path: each short line independently centered (byte-stable).
    // Theatrics never fires on classic (selectEffects), so wantComposite is false.
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

  if (!wantComposite) return out;

  // Composite stage curtain / motes over plain geometry (creature is already
  // the main art block — not layered again). Recolor after.
  const composed = applyTheatrics(out, {
    cols,
    rows,
    effects,
    draw: theatrics?.draw || null,
    drawProgress:
      theatrics?.drawProgress != null ? Number(theatrics.drawProgress) : 0,
    tick,
    sparkFrames: Number(theatrics?.sparkFrames) || 5,
    seed: Number(theatrics?.seed) || 0,
    motesT: theatrics?.motesT != null ? Number(theatrics.motesT) : undefined,
  });

  return composed.map((plainLine) => {
    if (solid) {
      return color(
        plainLine.length >= cols
          ? plainLine
          : plainLine + " ".repeat(cols - plainLine.length),
        { bg: bgSpec, fg },
      );
    }
    // Transparent: color non-empty ink; keep leading spaces outside SGR for
    // layout stability (match blockLine transparent behavior when possible).
    if (!plainLine.trim()) return "";
    return color(plainLine, { fg });
  });
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
  theatrics,
}) =>
  hideCursor() +
  disableWrap() +
  cursorHome() +
  renderCard(state, elapsedSec, cols, rows, bg, theme, tick, theatrics)
    .map((l) => l + eraseLine())
    .join("\r\n") +
  eraseBelow() +
  enableWrap();

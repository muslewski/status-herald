// Corner chrome on curtain cards — low-distraction hit targets for pause / pet /
// future actions. Pure layout + paint + hit-test (no I/O).
//
// Coordinates: 0-based row/col for layout; mouse SGR is 1-based (convert at edge).

import { color } from "../render.mjs";

/** @typedef {{ id: string, label: string }} ChromeButtonDef */

/** Built-in buttons (order = left→right in the strip). Extensible later. */
export const CHROME_BUTTONS = /** @type {ChromeButtonDef[]} */ ([
  { id: "pause", label: "× off" },
  { id: "pet", label: "↻ pet" },
]);

/**
 * Lay out chrome buttons bottom-right, one row, right-aligned with gaps.
 * @param {number} cols
 * @param {number} rows
 * @param {ChromeButtonDef[]} [buttons]
 * @returns {{ id: string, label: string, row: number, c0: number, c1: number }[]}
 */
export const layoutChrome = (cols, rows, buttons = CHROME_BUTTONS) => {
  const c = Math.max(0, Math.floor(Number(cols) || 0));
  const r = Math.max(0, Math.floor(Number(rows) || 0));
  if (c < 12 || r < 4 || !buttons.length) return [];

  const gap = 1;
  const pad = 1; // from right edge
  // "[ label ]" wrapping
  const pieces = buttons.map((b) => ({
    id: b.id,
    label: b.label,
    text: `[${b.label}]`,
  }));
  let width = pieces.reduce((n, p) => n + p.text.length, 0);
  width += gap * Math.max(0, pieces.length - 1);

  // If too wide, drop labels to single-char icons: [×] [↻]
  let use = pieces;
  if (width + pad > c) {
    use = buttons.map((b) => ({
      id: b.id,
      label: b.label,
      text: b.id === "pause" ? "[×]" : b.id === "pet" ? "[↻]" : `[${b.label[0] || "?"}]`,
    }));
    width = use.reduce((n, p) => n + p.text.length, 0);
    width += gap * Math.max(0, use.length - 1);
  }
  if (width + pad > c) return []; // still no room — skip chrome

  let x = c - pad - width;
  const row = r - 1; // bottom row
  /** @type {{ id: string, label: string, row: number, c0: number, c1: number }[]} */
  const out = [];
  for (const p of use) {
    const c0 = x;
    const c1 = x + p.text.length; // exclusive
    out.push({ id: p.id, label: p.text, row, c0, c1 });
    x = c1 + gap;
  }
  return out;
};

/**
 * Paint chrome onto plain (no-SGR) lines. Soft cells only — never clobber card ink.
 * @param {string[]} plainLines
 * @param {number} cols
 * @param {number} rows
 * @param {{ buttons?: ChromeButtonDef[] }} [opts]
 * @returns {string[]}
 */
export const paintChromePlain = (plainLines, cols, rows, opts = {}) => {
  const layout = layoutChrome(cols, rows, opts.buttons);
  if (!layout.length) return plainLines;
  const out = plainLines.map((l) => {
    const s = String(l ?? "");
    return s.length >= cols ? s.slice(0, cols) : s + " ".repeat(cols - s.length);
  });
  while (out.length < rows) out.push(" ".repeat(cols));

  for (const b of layout) {
    if (b.row < 0 || b.row >= out.length) continue;
    const chars = [...out[b.row]];
    const text = b.label;
    for (let i = 0; i < text.length; i++) {
      const col = b.c0 + i;
      if (col < 0 || col >= cols) continue;
      // Soft only: space or empty (do not paint over animal/label ink)
      const cur = chars[col] ?? " ";
      if (cur !== " ") continue;
      chars[col] = text[i];
    }
    out[b.row] = chars.join("");
  }
  return out;
};

/**
 * Apply dim gray styling to chrome hit cells on already-colored (or plain) lines.
 * Safer path: re-paint the bottom strip as dim after full color pass.
 * @param {string[]} coloredLines - full card lines (may include SGR)
 * @param {number} cols
 * @param {number} rows
 */
export const styleChromeDim = (coloredLines, cols, rows) => {
  const layout = layoutChrome(cols, rows);
  if (!layout.length || !coloredLines?.length) return coloredLines;
  // Rebuild bottom row as plain + dim paint (simpler than splicing mid-SGR).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip SGR for geometry
  const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
  const out = coloredLines.slice();
  const row = layout[0].row;
  if (row < 0 || row >= out.length) return out;
  let plain = strip(out[row]);
  if (plain.length < cols) plain += " ".repeat(cols - plain.length);
  plain = plain.slice(0, cols);

  // Reconstruct: everything dim-gray for button glyphs only
  let line = "";
  for (let col = 0; col < cols; col++) {
    const ch = plain[col] ?? " ";
    const onBtn = layout.some((b) => col >= b.c0 && col < b.c1);
    if (onBtn && ch !== " ") {
      line += color(ch, { fg: "gray" });
    } else {
      line += ch === " " ? " " : ch;
    }
  }
  // Prefer full dim strip from plain base so we don't leave half-SGR artifacts
  // from the previous paint of that row.
  const base = " ".repeat(cols);
  const chars = [...base];
  for (const b of layout) {
    for (let i = 0; i < b.label.length; i++) {
      const col = b.c0 + i;
      if (col >= 0 && col < cols) chars[col] = b.label[i];
    }
  }
  // Keep non-chrome ink from plain if any (rare on bottom row)
  for (let col = 0; col < cols; col++) {
    const onBtn = layout.some((b) => col >= b.c0 && col < b.c1);
    if (!onBtn && plain[col] && plain[col] !== " ") chars[col] = plain[col];
  }
  let painted = "";
  for (let col = 0; col < cols; col++) {
    const ch = chars[col];
    const onBtn = layout.some((b) => col >= b.c0 && col < b.c1);
    if (ch === " ") painted += " ";
    else if (onBtn) painted += color(ch, { fg: "gray" });
    else painted += ch;
  }
  out[row] = painted;
  return out;
};

/**
 * Hit-test. Mouse SGR x/y are 1-based; pass them as-is and we convert.
 * @param {number} cols
 * @param {number} rows
 * @param {number} x1 - 1-based column from terminal
 * @param {number} y1 - 1-based row from terminal
 * @returns {string|null} button id or null
 */
export const hitChrome = (cols, rows, x1, y1) => {
  const col = Math.floor(Number(x1) || 0) - 1;
  const row = Math.floor(Number(y1) || 0) - 1;
  if (col < 0 || row < 0) return null;
  const layout = layoutChrome(cols, rows);
  for (const b of layout) {
    if (row === b.row && col >= b.c0 && col < b.c1) return b.id;
  }
  return null;
};

/**
 * Keyboard shortcuts for chrome (when mouse unavailable).
 * @param {string} ch - single character (already lowercased if letter)
 * @returns {string|null}
 */
export const keyChrome = (ch) => {
  const c = String(ch || "");
  if (c === "x" || c === "X" || c === "o" || c === "O") return "pause";
  if (c === "a" || c === "A" || c === "p" || c === "P") return "pet";
  return null;
};

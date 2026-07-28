// Status-bar curtain chrome: click-only pause/resume toggle + paused glyph.
// No work on status-interval paths — only pause/resume/arm and mouse binds.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Styled glyph shown while curtain is paused (re-enable affordance). */
export const PAUSE_HINT = "#[fg=yellow]▶ curtain#[default] ";

/** Marker substring in status-right so we can inject/remove the slot once. */
export const CHROME_HINT_SLOT = "#{@herald_chrome_hint}";

/**
 * Resolve a status-bar click / menu action to a curtain op.
 * @param {{ paused?: boolean, action?: string, range?: string }} opts
 * @returns {"pause"|"resume"|"pet"|null}
 */
export const resolveStatusClick = (opts = {}) => {
  const paused = !!opts.paused;
  const raw = String(opts.action ?? opts.range ?? "toggle")
    .trim()
    .toLowerCase();

  // Explicit verbs (menu / CLI)
  if (raw === "pet" || raw === "cycle" || raw === "denizen") return "pet";
  if (raw === "pause" || raw === "off" || raw === "×" || raw === "x")
    return "pause";
  if (raw === "resume" || raw === "on" || raw === "enable" || raw === "▶")
    return "resume";
  if (raw === "menu") return null; // caller opens display-menu

  // tmux mouse_status_range values → toggle
  // left | right | window | empty | toggle
  if (
    raw === "toggle" ||
    raw === "left" ||
    raw === "right" ||
    raw === "centre" ||
    raw === "center" ||
    raw === "window" ||
    raw === "pane" ||
    raw === ""
  ) {
    return paused ? "resume" : "pause";
  }

  // Unknown token: still toggle (fail-open useful default)
  return paused ? "resume" : "pause";
};

/**
 * Ensure session status-right includes #{@herald_chrome_hint} without
 * clobbering the operator's prior format permanently.
 * @param {string} sess
 * @param {*} t - tmux adapter
 * @param {boolean} wantSlot
 */
export const ensureChromeHintSlot = (sess, t, wantSlot) => {
  if (!sess || !t) return;
  const cur = t.getSessOpt(sess, "status-right") || "";
  const hasSlot = cur.includes(CHROME_HINT_SLOT);

  if (wantSlot) {
    if (!hasSlot) {
      // Save original once. Empty session value means "inherit global" — copy
      // global format so we do not blank the clock/gauges when overriding.
      if (t.getSessOpt(sess, "@herald_user_status_right") === "") {
        let base = cur;
        let fromGlobal = false;
        if (!base && typeof t.getGlobalOpt === "function") {
          base = t.getGlobalOpt("status-right") || "";
          fromGlobal = !!base;
        }
        t.setSessOpt(sess, "@herald_user_status_right", base);
        t.setSessOpt(sess, "@herald_chrome_from_global", fromGlobal ? "1" : "0");
      }
      const user = t.getSessOpt(sess, "@herald_user_status_right") || "";
      t.setSessOpt(
        sess,
        "status-right",
        user ? `${CHROME_HINT_SLOT}${user}` : CHROME_HINT_SLOT,
      );
      const len = Number(t.getSessOpt(sess, "status-right-length")) || 0;
      if (len < 40) t.setSessOpt(sess, "status-right-length", 40);
    }
  } else if (hasSlot) {
    // Prefer re-inherit global if we only copied it for the glyph slot.
    if (t.getSessOpt(sess, "@herald_chrome_from_global") === "1") {
      t.unsetSessOpt(sess, "status-right");
    } else {
      const user = t.getSessOpt(sess, "@herald_user_status_right");
      if (user) t.setSessOpt(sess, "status-right", user);
      else t.unsetSessOpt(sess, "status-right");
    }
    t.setSessOpt(sess, "@herald_chrome_hint", "");
    t.setSessOpt(sess, "@herald_user_status_right", "");
    t.setSessOpt(sess, "@herald_chrome_from_global", "");
  }
};

/**
 * Apply or clear the paused re-enable glyph.
 * @param {string} sess
 * @param {boolean} paused
 * @param {*} t
 */
export const applyPauseChrome = (sess, paused, t) => {
  if (!sess || !t) return;
  if (paused) {
    t.setSessOpt(sess, "@herald_chrome_hint", PAUSE_HINT);
    ensureChromeHintSlot(sess, t, true);
  } else {
    t.setSessOpt(sess, "@herald_chrome_hint", "");
    // Keep slot while armed so next pause is instant; strip only on disarm.
  }
};

/** Clear chrome slot + hint (disarm / full off). */
export const clearPauseChrome = (sess, t) => {
  if (!sess || !t) return;
  t.setSessOpt(sess, "@herald_chrome_hint", "");
  ensureChromeHintSlot(sess, t, false);
};

/** Absolute path to this package's herald bin (for tmux run-shell). */
export const heraldBinPath = () =>
  fileURLToPath(new URL("../../bin/herald", import.meta.url));

/**
 * Install global tmux mouse binds for status chrome (idempotent).
 * Click-only — never on status-interval.
 * @param {{ exec?: typeof execFileSync, heraldBin?: string }} [opts]
 */
export const installStatusChromeBinds = (opts = {}) => {
  const exec = opts.exec || execFileSync;
  const bin = opts.heraldBin || heraldBinPath();
  const node = process.execPath;
  // Quote paths for run-shell; -b = background (no TUI block).
  const click = `run-shell -b '${node} ${bin} curtain status-click "#{mouse_status_range}" "#{session_name}"'`;
  const menu = `run-shell -b '${node} ${bin} curtain status-menu "#{session_name}"'`;
  try {
    exec("tmux", ["bind-key", "-T", "root", "MouseDown1Status", click], {
      stdio: "ignore",
    });
    exec("tmux", ["bind-key", "-T", "root", "MouseDown1StatusRight", menu], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Build tmux display-menu args for status-menu (testable pure list).
 * @param {string} sess
 * @param {string} bin absolute herald bin
 * @param {string} [node] process.execPath
 * @returns {string[]}
 */
export const statusMenuTmuxArgs = (
  sess,
  bin,
  node = process.execPath,
) => {
  const s = String(sess || "").replace(/'/g, "");
  const run = (sub) =>
    `run-shell -b '${node} ${bin} curtain ${sub} ${s}'`;
  return [
    "display-menu",
    "-T",
    "Herald curtain",
    "-x",
    "R",
    "-y",
    "S",
    "× off (pause)",
    "o",
    run("pause"),
    "▶ on (resume)",
    "r",
    run("resume"),
    "↻ pet",
    "p",
    run("pet"),
  ];
};

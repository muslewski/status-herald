import { fileURLToPath } from "node:url";
import { STATES } from "./state.mjs";
import * as realTmux from "./tmux.mjs";

export const CARD_WIN = "_curtain";
const COVERABLE = new Set([STATES.WORKING, STATES.DONE, STATES.NEEDS]);
const LOOP = fileURLToPath(
  new URL("../../scripts/curtain-card-session.sh", import.meta.url),
);

// Add a hidden card window to a session and mark it armed. Idempotent.
export const arm = (sess, t = realTmux) => {
  if (t.getSessOpt(sess, "@herald_armed") === "1") return;
  const liveWin = t.activeWindowId(sess);
  t.newCardWindow(sess, CARD_WIN, LOOP);
  t.setSessOpt(sess, "@herald_live_win", liveWin);
  t.setSessOpt(sess, "@herald_state", STATES.IDLE);
  t.setSessOpt(sess, "@herald_covered", "0");
  t.setSessOpt(sess, "@herald_armed", "1");
};

// Restore the live view, drop the card window and the armed marker.
export const disarm = (sess, t = realTmux) => {
  reveal(sess, t);
  t.killWindow(`${sess}:${CARD_WIN}`);
  t.setSessOpt(sess, "@herald_armed", "0");
};

// Show the card, if this session is armed, coverable, and not already covered.
export const cover = (sess, t = realTmux) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") === "1") return;
  if (!COVERABLE.has(t.getSessOpt(sess, "@herald_state"))) return;
  // Never capture the card window itself as the live window — that would
  // strand the session behind the card. If we're somehow already on the
  // card (state desync), keep the stored live window and just mark covered.
  if (t.windowNameOf(t.activeWindowId(sess)) !== CARD_WIN)
    t.setSessOpt(sess, "@herald_live_win", t.activeWindowId(sess));
  t.selectWindow(`${sess}:${CARD_WIN}`);
  t.setSessOpt(sess, "@herald_covered", "1");
};

// Bring the remembered live window back.
export const reveal = (sess, t = realTmux) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") !== "1") return;
  const live = t.getSessOpt(sess, "@herald_live_win");
  if (live) t.selectWindow(live);
  t.setSessOpt(sess, "@herald_covered", "0");
};

// Panic / fail-open: reveal every covered armed session.
export const revealAll = (t = realTmux) => {
  for (const s of t.listArmed()) reveal(s.name, t);
};

// Mac-agent entry: reveal the tab whose live-window label matches `title`,
// cover every other armed session (cover() self-guards on coverable state).
export const focus = (title, t = realTmux) => {
  for (const s of t.listArmed()) {
    const label = t.windowNameOf(s.liveWin);
    if (title && label === title) reveal(s.name, t);
    else cover(s.name, t);
  }
};

// Claude-hook entry: stamp session-scoped state; set @herald_since on working.
export const stampSession = (pane, state, nowSec, t = realTmux) => {
  const sess = t.sessionOf(pane);
  if (!sess) return;
  t.setSessOpt(sess, "@herald_state", state);
  if (state === STATES.WORKING) t.setSessOpt(sess, "@herald_since", nowSec);
};

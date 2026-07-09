import { STATES } from "./state.mjs";
import * as realTmux from "./tmux.mjs";

export const HOLDING_WIN = "_holding";
const COVERABLE = new Set([STATES.WORKING, STATES.DONE, STATES.NEEDS]);

// Hide the live pane behind its curtain peer, if it is currently visible.
export const cover = (livePane, t = realTmux) => {
  const peer = t.getOpt(livePane, "@herald_peer");
  if (!peer) return;
  if (t.windowNameOf(livePane) === HOLDING_WIN) return; // already hidden
  t.swapPanes(livePane, peer);
};

// Bring the live session (peer of a focused curtain pane) back into the grid.
export const reveal = (curtainPane, t = realTmux) => {
  const live = t.getOpt(curtainPane, "@herald_peer");
  if (!live) return;
  if (t.windowNameOf(live) !== HOLDING_WIN) return; // already visible
  t.swapPanes(curtainPane, live);
  t.selectPane(live);
};

// Claude hook entry: stamp state on the live pane, cover it if unfocused.
export const onEvent = (livePane, state, nowSec, t = realTmux) => {
  t.setOpt(livePane, "@herald_state", state);
  if (state === STATES.WORKING) t.setOpt(livePane, "@herald_since", nowSec);
  if (!t.isFocused(livePane)) cover(livePane, t);
};

// tmux pane-focus-in: reveal when a curtain pane gains focus.
export const onFocusIn = (pane, t = realTmux) => {
  if (t.getOpt(pane, "@herald_role") === "curtain") reveal(pane, t);
};

// tmux pane-focus-out: re-cover a live pane that is still working/done/needs.
export const onFocusOut = (pane, t = realTmux) => {
  if (t.getOpt(pane, "@herald_role") !== "live") return;
  if (COVERABLE.has(t.getOpt(pane, "@herald_state"))) cover(pane, t);
};

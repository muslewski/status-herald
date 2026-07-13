// Animated bar background for tmux status bar (whole bar via status-style bg).
// Provides "gradient"/breathing wash synced to herald state for proper visual
// feedback (e.g. nice effect when DONE).
// Customizable via config.bars.tmux.background.animated and doneFlashSec.
// If not animated, returns null (do not touch bg, user can keep their style).
// Uses session scope so per-tab.

export function computeStatusBg(
  state,
  nowMs = Date.now(),
  enteredAtMs = 0,
  cfg = {},
) {
  const bg = cfg.bars?.tmux?.background || {};
  if (!bg.animated) return null;

  const s = state || "idle";
  if (s === "idle") return "default";

  if (s === "working") {
    // slow hue flow / breathing -- subtle cycle
    const phase = Math.floor(nowMs / 1500) % 5;
    const colors = [
      "colour235",
      "colour236",
      "colour237",
      "colour238",
      "colour239",
    ];
    return colors[phase];
  }

  if (s === "done") {
    const flash = bg.doneFlashSec || 3;
    const elapsed = (nowMs - (enteredAtMs || nowMs)) / 1000;
    if (elapsed >= flash) return "default";
    const p = Math.max(0, 1 - elapsed / flash);
    // pulse bright then fade to default
    if (p > 0.7) return "colour34"; // bright green
    if (p > 0.4) return "colour35";
    return "colour236";
  }

  if (s === "compacting") {
    // own wash
    const phase = Math.floor(nowMs / 1000) % 3;
    return ["colour172", "colour173", "colour174"][phase];
  }

  if (s === "needs") {
    return "colour52"; // dark red-ish
  }

  return "default";
}

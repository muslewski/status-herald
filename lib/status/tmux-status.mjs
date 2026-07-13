// tmux-status surface: consumes 019 compute data + 020 registry + side-effects
// to produce the string for status-right and drive @ctxbar / badges.
// This file is pure-ish for the output part; side effects are in side-effects.mjs.

import {
  buildPerSessionData,
  discoverLiveClaudeSessions,
  getAccountGauges,
} from "./compute.mjs";
import { REGISTRY, orderSegments, renderLine } from "./segments.mjs";

/**
 * Very small surface for demo / early use.
 * In real use (status-interval), tmux will invoke this and we also perform
 * the side effects (ctxbar etc) for the windows.
 */
export async function renderTmuxStatus(opts = {}) {
  try {
    const cfg = opts.config || {}; // will come from loadConfig().bars later
    const segmentsCfg = cfg.segments || {};

    // For early demo we synthesize a tiny ctx using live discovery when possible.
    // In production the caller (cli or tmux #( )) can pass pane info.
    let account = null;
    try {
      account = await getAccountGauges();
    } catch {}

    // Build items from registry for the *stdout* part (mostly accounts + clock etc).
    // The per-session context is side-effected into @ctxbar (done elsewhere in 020).
    const items = [];
    const ordered = orderSegments(REGISTRY, { segments: segmentsCfg });

    for (const seg of ordered) {
      // For stdout we only care about a few (account, perhaps clock).
      // Context/model/state are primarily @-vars.
      if (seg.id === "account5h" || seg.id === "accountWeekly") {
        const it = seg.render
          ? seg.render({ account, caps: account?.caps })
          : null;
        if (it) items.push(it);
      }
      // clock/notify stubs for now (pure)
      if (seg.id === "clock" && seg.enabled !== false) {
        const d = new Date();
        items.push({
          id: "clock",
          text: d.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          role: "dim",
          priority: seg.priority || 10,
        });
      }
    }

    if (items.length === 0) return "";

    // Unlimited width for the #( ) part; tmux will truncate the whole status-right if needed.
    const out = renderLine(items, { mode: "tmux", width: null });

    // Drive whole-bar background (breathing/gradient wash) for state feedback.
    // Gives proper visual info e.g. when DONE (pulse/fade). Fully customizable
    // via bars.tmux.background.animated (and doneFlashSec). Opt-out by setting
    // animated: false (or omit). Session scoped for per-tab.
    if (process.env.TMUX) {
      try {
        const { execFileSync } = await import("node:child_process");
        const { loadConfig } = await import("../config.mjs");
        const { computeStatusBg } = await import("./background.mjs");
        const sess = execFileSync(
          "tmux",
          ["display", "-p", "#{session_name}"],
          { encoding: "utf8" },
        ).trim();
        if (sess) {
          const state =
            execFileSync("tmux", ["show", "-t", sess, "-v", "@herald_state"], {
              encoding: "utf8",
            }).trim() || "idle";
          const cfg = loadConfig();
          const bg = computeStatusBg(state, Date.now(), 0, cfg);
          if (bg) {
            let cur = "";
            try {
              cur = execFileSync(
                "tmux",
                ["show", "-t", sess, "-v", "status-style"],
                { encoding: "utf8" },
              ).trim();
            } catch {}
            const cleaned = (cur || "").replace(/,?\s*bg=[^,\s]*/g, "").trim();
            const newStyle = cleaned ? `${cleaned},bg=${bg}` : `bg=${bg}`;
            execFileSync(
              "tmux",
              ["set", "-t", sess, "status-style", newStyle],
              { stdio: "ignore" },
            );
          }
        }
      } catch {}
    }

    return out;
  } catch {
    return ""; // fail open
  }
}

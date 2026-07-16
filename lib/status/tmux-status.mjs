// tmux-status surface: account gauges for status-right stdout + side-effects
// for per-window @ctxbar/@model/@state. Fail-open → "".
// Plan 022 animated background is NOT implemented here (STOP condition).

import { loadConfig } from "../config.mjs";
import {
  buildPerSessionData,
  discoverLiveClaudeSessions,
  getAccountGauges,
} from "./compute.mjs";
import {
  discoverLiveGrokSessions,
  readProcStatusPpid,
} from "./grok-adapter.mjs";
import {
  REGISTRY,
  formatCtxbarForTmux,
  orderSegments,
  renderLine,
} from "./segments.mjs";
import {
  ctxBucketTmux,
  realTmuxExec,
  stateGlyph,
  syncWindows,
} from "./side-effects.mjs";

/**
 * Render the tmux status-right account gauges string and sync per-window opts.
 * All I/O injectable for hermetic tests; never throws.
 *
 * opts:
 *   config, sessionsDir, projectsDir, metaDir, snapshotPath, now,
 *   panes, ppidOf, exec, skipSideEffects, clockText, notifyIcon, width, mode
 */
export async function renderTmuxStatus(opts = {}) {
  try {
    const fullCfg = opts.config || loadConfig();
    const bars = fullCfg.bars || {};
    if (bars.tmux?.enabled === false) return "";

    const exec = opts.exec || realTmuxExec;
    const sessionsDir = opts.sessionsDir;
    const projectsDir = opts.projectsDir;
    const metaDir = opts.metaDir;
    const snapshotPath = opts.snapshotPath;
    const now = opts.now;
    const panes = opts.panes;
    const ppidOf = opts.ppidOf || readProcStatusPpid;

    let account = { fiveHour: null, weekly: null, caps: {} };
    try {
      account = await getAccountGauges({ snapshotPath, now });
    } catch {
      account = { fiveHour: null, weekly: null, caps: {} };
    }

    if (opts.skipSideEffects !== true) {
      try {
        const sessions = await discoverLiveClaudeSessions({ sessionsDir });
        const modelEnabled = bars.segments?.model?.enabled === true;
        const dataBy = {};
        for (const s of sessions) {
          try {
            const data = await buildPerSessionData(s.sessionId, s.pid, {
              projectsDir,
              metaDir,
            });
            const ctx = data.context || {
              used: 0,
              win: 200000,
              pct: 0,
              messages: 0,
            };
            dataBy[s.sessionId] = {
              context: ctx,
              modelBadge: data.modelBadge || "",
              // Always include 💬 N (message count) — matches Python _ctx_segment.
              ctxbarText: formatCtxbarForTmux(ctx),
              stateGlyph: stateGlyph(s.status),
              color: ctxBucketTmux(ctx.pct),
            };
          } catch {
            /* skip one session */
          }
        }
        syncWindows(sessions, {
          panes,
          ppidOf,
          exec,
          modelEnabled,
          getDataFor: (s) => dataBy[s.sessionId],
        });

        // Grok panes are not in ~/.claude/sessions — discover via
        // ~/.grok/active_sessions.json and write the same @ctxbar shape
        // (500k window + userMessageCount as 💬 N).
        const grokSessions = discoverLiveGrokSessions({
          grokHome: opts.grokHome,
          activePath: opts.grokActivePath,
        });
        const grokDataBy = {};
        for (const s of grokSessions) {
          const ctx = s.context || {
            used: 0,
            win: 500_000,
            pct: 0,
            messages: 0,
          };
          grokDataBy[s.sessionId] = {
            context: ctx,
            modelBadge: s.modelBadge || "Grok",
            ctxbarText: formatCtxbarForTmux(ctx),
            stateGlyph: stateGlyph(s.status),
            color: ctxBucketTmux(ctx.pct),
          };
        }
        syncWindows(grokSessions, {
          panes,
          ppidOf,
          exec,
          modelEnabled,
          getDataFor: (s) => grokDataBy[s.sessionId],
        });
      } catch {
        /* side-effects never break stdout */
      }
    }

    // Stdout: account gauges (+ optional clock/notify) for status-right #( ).
    const segCfg = bars.segments || {};
    const ordered = orderSegments(REGISTRY, { segments: segCfg });
    const ctx = {
      account,
      caps: account.caps,
      clockText: opts.clockText,
      notifyIcon: opts.notifyIcon,
    };
    const items = [];
    for (const seg of ordered) {
      if (
        seg.id !== "account5h" &&
        seg.id !== "accountWeekly" &&
        seg.id !== "clock" &&
        seg.id !== "notify"
      ) {
        continue;
      }
      try {
        const it = seg.render?.(ctx);
        if (it) items.push(it);
      } catch {
        /* skip */
      }
    }
    if (items.length === 0) return "";
    return renderLine(items, {
      mode: opts.mode || "tmux",
      width: opts.width ?? null,
      sep: "  ",
    });
  } catch {
    return "";
  }
}

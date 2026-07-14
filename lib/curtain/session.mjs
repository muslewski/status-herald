import { fileURLToPath } from "node:url";
import { globToRe, loadConfig } from "../config.mjs";
import { nextState, resetsElapsed } from "./hook.mjs";
import { isActiveHookEvent, settleIfStale } from "./settle.mjs";
import { STATES, computeElapsed } from "./state.mjs";
import { isAnimated, resolveThemeByName, themeNameFor } from "./themes.mjs";
import * as realTmux from "./tmux.mjs";
import { composeWashStyle, sampleWash } from "./wash.mjs";

// User's pre-herald status-style base (saved once so wash/cover can recompose).
const userBarBase = (sess, t) => {
  const saved = t.getSessOpt(sess, "@herald_user_status_style");
  if (saved !== "" && saved != null) return saved;
  // First touch: capture current style as user base (may already include wash).
  const cur = t.getSessOpt(sess, "status-style") || "";
  // Strip trailing herald wash tokens so we don't stack bg=
  const base = cur.replace(/(?:,|^)bg=colour\d+/g, "").replace(/^,/, "");
  t.setSessOpt(sess, "@herald_user_status_style", base);
  return base;
};

/**
 * Paint whole-bar breathing wash from @herald_state.
 * Driven by card loop (~0.5–1s) and hooks. Fail-open; no-op when wash off.
 */
export const washEnabled = (cfg) => cfg?.tmuxBar?.wash === true;

export const applyWash = (
  sess,
  nowSec,
  t = realTmux,
  cfg = loadConfig().curtain,
) => {
  if (!sess || !washEnabled(cfg)) return;

  const state = t.getSessOpt(sess, "@herald_state") || STATES.IDLE;
  const since = Number(t.getSessOpt(sess, "@herald_since")) || 0;
  const covered = t.getSessOpt(sess, "@herald_covered") === "1";
  const coverTransparent =
    (cfg?.tmuxBar?.whenCovered || "keep") === "transparent" && covered;

  const { barBg } = sampleWash({
    state,
    sinceSec: since,
    nowSec,
    doneFlashSec: cfg?.tmuxBar?.doneFlashSec ?? 3,
  });

  // Wash colour owns bg even while covered (bottom bar breathes under the card).
  // Transparent cover only applies when wash would leave bg default (idle/done settled).
  const userBase = userBarBase(sess, t);
  const style = composeWashStyle({
    userBase,
    barBg,
    coverTransparent: coverTransparent && barBg === "default",
  });

  const prev = t.getSessOpt(sess, "status-style") || "";
  if (style === prev) return;
  if (style) t.setSessOpt(sess, "status-style", style);
  else t.unsetSessOpt(sess, "status-style");
};

// Drop or restore the tmux status bar's background while a session is covered,
// per curtain.tmuxBar.whenCovered — only when wash is disabled (wash owns bg).
// Save-and-restore the EXACT prior status-style (never `set -u`).
const applyBar = (sess, covered, t, cfg) => {
  // Wash path recomposes every tick / on cover; skip legacy-only applyBar.
  if (washEnabled(cfg)) {
    applyWash(sess, Math.floor(Date.now() / 1000), t, cfg);
    return;
  }
  if ((cfg?.tmuxBar?.whenCovered || "keep") !== "transparent") return;
  if (covered) {
    if (t.getSessOpt(sess, "@herald_bar_saved") === "1") return;
    const prev = t.getSessOpt(sess, "status-style");
    t.setSessOpt(sess, "@herald_prev_status_style", prev);
    t.setSessOpt(sess, "@herald_bar_saved", "1");
    t.setSessOpt(
      sess,
      "status-style",
      prev ? `${prev},bg=default` : "bg=default",
    );
  } else {
    if (t.getSessOpt(sess, "@herald_bar_saved") !== "1") return;
    const prev = t.getSessOpt(sess, "@herald_prev_status_style");
    if (prev) t.setSessOpt(sess, "status-style", prev);
    else t.unsetSessOpt(sess, "status-style");
    t.unsetSessOpt(sess, "@herald_prev_status_style");
    t.unsetSessOpt(sess, "@herald_bar_saved");
  }
};

export const CARD_WIN = "_curtain";
const defaultCoverable = () =>
  new Set([STATES.WORKING, STATES.COMPACTING, STATES.DONE, STATES.NEEDS]);

const coverableFrom = (cfg) => {
  const list = cfg?.coverableStates;
  if (!Array.isArray(list) || list.length === 0) return defaultCoverable();
  return new Set(list.map(String));
};
const LOOP = fileURLToPath(
  new URL("../../scripts/curtain-card-session.sh", import.meta.url),
);

// A terminal's title tracks tmux's *active* window, so a covered session would
// advertise itself as "_curtain". A focus adapter reading that title cannot
// tell which tab it is looking at, so focusing a covered tab would cover every
// session instead of revealing this one. Report the live window's name even
// while the card is up: when the card is active, walk the session's windows
// and emit the name of the one @herald_live_win points at.
export const TITLE_FMT = `#{?#{==:#W,${CARD_WIN}},#{W:#{?#{==:#{window_id},#{@herald_live_win}},#{window_name},}},#W}`;

// Resolve and store which theme a session wears and how fast its card repaints.
// Animated themes tick faster (default 2 fps); static themes keep the 1 s tick
// so a fleet of mosh'd sessions is not repainted 2x for no visual change.
const stampTheme = (sess, t, cfg = loadConfig().curtain) => {
  const name = themeNameFor(sess, cfg);
  t.setSessOpt(sess, "@herald_theme", name);
  const animated = isAnimated(resolveThemeByName(name, cfg));
  const ms = animated ? Math.round(1000 / (cfg.animation?.fps || 2)) : 1000;
  t.setSessOpt(sess, "@herald_frame_ms", ms);
};

// Add a hidden card window to a session and mark it armed. Idempotent. `cfg` is
// injectable so a test can pin a known theme without depending on the real user
// config file (which changes as the user retunes their fleet).
export const arm = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  if (t.getSessOpt(sess, "@herald_armed") === "1") return;
  const liveWin = t.activeWindowId(sess);
  t.newCardWindow(sess, CARD_WIN, LOOP);
  t.setSessOpt(sess, "@herald_live_win", liveWin);
  t.setSessOpt(sess, "set-titles", "on");
  t.setSessOpt(sess, "set-titles-string", TITLE_FMT);
  t.setSessOpt(sess, "@herald_state", STATES.IDLE);
  t.setSessOpt(sess, "@herald_covered", "0");
  // A stale count/set would hold the next idle_prompt at WORKING forever.
  t.setSessOpt(sess, "@herald_bg_subagents", 0);
  t.setSessOpt(sess, "@herald_bg_subagent_ids", "");
  t.setSessOpt(sess, "@herald_bg_shells", 0);
  t.setSessOpt(sess, "@herald_worked", 0);
  // Claude task-list host marker (see stampFromHook). Cleared on arm so a
  // re-armed session can reclassify as synthesis-only (Grok) if needed.
  t.setSessOpt(sess, "@herald_tasks_seen", "0");
  t.setSessOpt(sess, "@herald_last_active", "0");
  stampTheme(sess, t, cfg);
  t.setSessOpt(sess, "@herald_armed", "1");
};

// Restore the live view, drop the card window and the armed marker.
export const disarm = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  reveal(sess, t, cfg);
  t.killWindow(`${sess}:${CARD_WIN}`);
  // Drop the session-local overrides so the title falls back to the global one.
  t.unsetSessOpt(sess, "set-titles-string");
  t.unsetSessOpt(sess, "set-titles");
  t.setSessOpt(sess, "@herald_armed", "0");
};

// Show the card, if this session is armed, coverable, and not already covered.
export const cover = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") === "1") return;
  if (!coverableFrom(cfg).has(t.getSessOpt(sess, "@herald_state"))) return;
  // Never capture the card window itself as the live window — that would
  // strand the session behind the card. If we're somehow already on the
  // card (state desync), keep the stored live window and just mark covered.
  if (t.windowNameOf(t.activeWindowId(sess)) !== CARD_WIN)
    t.setSessOpt(sess, "@herald_live_win", t.activeWindowId(sess));
  t.selectWindow(`${sess}:${CARD_WIN}`);
  t.setSessOpt(sess, "@herald_covered", "1");
  applyBar(sess, true, t, cfg);
};

// Bring the remembered live window back.
export const reveal = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") !== "1") return;
  const live = t.getSessOpt(sess, "@herald_live_win");
  if (live) t.selectWindow(live);
  t.setSessOpt(sess, "@herald_covered", "0");
  applyBar(sess, false, t, cfg);
};

// Panic / fail-open: reveal every covered armed session.
export const revealAll = (t = realTmux, cfg = loadConfig().curtain) => {
  for (const s of t.listArmed()) reveal(s.name, t, cfg);
};

// Reveal from a pre-read snapshot row: writes only, no per-session reads.
const revealFrom = (s, t, cfg) => {
  if (!s.covered) return;
  if (s.liveWin) t.selectWindow(s.liveWin);
  t.setSessOpt(s.name, "@herald_covered", "0");
  applyBar(s.name, false, t, cfg);
};

// Cover from a snapshot row + the window-name map. Mirrors cover()'s guards: a
// non-coverable state is left live, and the card window is never captured as the
// live window (desync self-heal). No reads -- the snapshot already carries them.
const coverFrom = (s, t, names, cfg) => {
  if (s.covered) return;
  if (!coverableFrom(cfg).has(s.state)) return;
  if (names[s.activeWin] !== CARD_WIN)
    t.setSessOpt(s.name, "@herald_live_win", s.activeWin);
  t.selectWindow(`${s.name}:${CARD_WIN}`);
  t.setSessOpt(s.name, "@herald_covered", "1");
  applyBar(s.name, true, t, cfg);
};

// Mac-agent entry: reveal the tab whose live-window label matches `title`, cover
// every other armed session. This is the interactive tab-switch hot path, so it
// takes TWO batched tmux reads (a session snapshot + a window id->name map) then
// writes only the sessions that actually flip -- instead of ~4 reads per session
// (~45 subprocesses across a 14-session fleet). Falls back to the per-session
// path for tmux doubles that do not implement the batch readers.
export const focus = (title, t = realTmux, cfg = loadConfig().curtain) => {
  if (
    typeof t.snapshotArmed === "function" &&
    typeof t.windowNames === "function"
  ) {
    const names = t.windowNames();
    for (const s of t.snapshotArmed()) {
      const liveName = names[s.liveWin] ?? "";
      if (title && liveName === title) revealFrom(s, t, cfg);
      else coverFrom(s, t, names, cfg);
    }
    return;
  }
  for (const s of t.listArmed()) {
    const label = t.windowNameOf(s.liveWin);
    if (title && label === title) reveal(s.name, t, cfg);
    else cover(s.name, t, cfg);
  }
};

// Agent hook entry: stamp session-scoped state; set @herald_since on working.
export const stampSession = (pane, state, nowSec, t = realTmux) => {
  const sess = t.sessionOf(pane);
  if (!sess) return;
  t.setSessOpt(sess, "@herald_state", state);
  if (state === STATES.WORKING) t.setSessOpt(sess, "@herald_since", nowSec);
};

// Agent hook entry (payload-aware): fold one hook event into the session's
// state and record what is still in flight, so the card can say "DONE, 1 shell
// in bg" instead of lying about a session whose subagents are still running.
//
// For Grok (and any agent that omits background_tasks on Subagent*/Stop),
// we synthesize subagent counts from Start/Stop pairs so Stop can decide
// WORKING vs DONE using the same logic.
const readIds = (v) => (v ? String(v).split(" ").filter(Boolean) : []);

// Given the stored set of in-flight subagent ids and one event, return the new
// set. A task-bearing event (Claude Stop/SubagentStop) is authoritative and
// REPLACES the set -- that is the reconciliation point that repairs a dropped
// Start or Stop. A host without task lists (Grok) increments/decrements by id,
// or by a synthetic id when the payload names none. A new prompt clears it.
const nextSubagentIds = (stored, ev, synthId) => {
  if (ev.hasTasks) return new Set(ev.subagentIds);
  // Synthetic task-complete "prompts" must not clear in-flight ids mid-turn.
  if (ev.event === "UserPromptSubmit" && !ev.synthetic) return new Set();
  if (ev.event === "UserPromptSubmit" && ev.synthetic) return new Set(stored);
  const set = new Set(stored);
  if (ev.event === "SubagentStart") set.add(ev.agentId || synthId);
  else if (ev.event === "SubagentStop") {
    // Prefer exact id. Grok often pairs a real stop id with a synth start id —
    // if exact miss, drop one syn-* (or any one) so the set can drain.
    if (ev.agentId && set.has(ev.agentId)) set.delete(ev.agentId);
    else if (ev.agentId) {
      const syn = [...set].find((id) => String(id).startsWith("syn-"));
      if (syn) set.delete(syn);
      else
        for (const id of set) {
          set.delete(id);
          break;
        }
    } else
      for (const id of set) {
        set.delete(id);
        break;
      } // drop one, best-effort
  }
  return set;
};

const applyDoneTransition = (t, sess, cur, next, nowSec) => {
  if (next === STATES.DONE && cur !== STATES.DONE) {
    const since = Number(t.getSessOpt(sess, "@herald_since")) || 0;
    t.setSessOpt(
      sess,
      "@herald_worked",
      since ? computeElapsed(nowSec, since) : 0,
    );
  }
};

/** Apply settleIfStale to a live session (hooks or card-loop settle). */
export const applySettle = (
  sess,
  nowSec,
  t = realTmux,
  cfg = loadConfig().curtain,
) => {
  if (!sess) return false;
  const cur = t.getSessOpt(sess, "@herald_state") || STATES.IDLE;
  const subs = Number(t.getSessOpt(sess, "@herald_bg_subagents")) || 0;
  const tasksSeen = t.getSessOpt(sess, "@herald_tasks_seen") === "1";
  const lastActive = Number(t.getSessOpt(sess, "@herald_last_active")) || 0;
  const since = Number(t.getSessOpt(sess, "@herald_since")) || 0;
  const decision = settleIfStale(
    { state: cur, subs, tasksSeen, lastActive, since },
    nowSec,
    cfg?.settle,
  );
  if (!decision) return false;
  t.setSessOpt(sess, "@herald_state", decision.state);
  applyDoneTransition(t, sess, cur, decision.state, nowSec);
  if (decision.clearSubs) {
    t.setSessOpt(sess, "@herald_bg_subagents", 0);
    t.setSessOpt(sess, "@herald_bg_subagent_ids", "");
  }
  return true;
};

// Synthesis-only hosts (Grok: no background_tasks ever) never emit idle_prompt.
// After the last subagent drains, settle to DONE — Claude always sets
// @herald_tasks_seen via hasTasks payloads and keeps the idle_prompt hold.
export const shouldSettleSynthSubagentStop = ({
  tasksSeen,
  event,
  subs,
  cur,
}) =>
  !tasksSeen &&
  event === "SubagentStop" &&
  subs === 0 &&
  (cur === STATES.WORKING || cur === STATES.COMPACTING);

export const stampFromHook = (
  pane,
  ev,
  nowSec,
  t = realTmux,
  cfg = loadConfig().curtain,
) => {
  const sess = t.sessionOf(pane);
  if (!sess || !ev) return;
  const cur = t.getSessOpt(sess, "@herald_state") || STATES.IDLE;

  // First Claude-style task list permanently classifies this arm as task-list
  // host until re-arm. Grok never sets this → synthesis-only settle rules apply.
  if (ev.hasTasks) t.setSessOpt(sess, "@herald_tasks_seen", "1");
  const tasksSeen =
    ev.hasTasks || t.getSessOpt(sess, "@herald_tasks_seen") === "1";

  // Subagents are tracked as a SET of ids, not a counter: a counter loses an
  // increment when a main agent dispatches several subagents at once (two hooks
  // both read N, both write N+1), and a leaked +1 never drains. A set is
  // idempotent, and Stop's task list overwrites it, so any desync is corrected
  // at the next turn end.
  const storedIds = readIds(t.getSessOpt(sess, "@herald_bg_subagent_ids"));
  const nextIds = nextSubagentIds(
    storedIds,
    ev,
    `syn-${nowSec}-${storedIds.length}`,
  );
  let subs = nextIds.size;

  // Shells come only from an authoritative task list (no shell-start event to
  // synthesize from); keep the last known count when this event carries none.
  const shells = ev.hasTasks
    ? ev.shells
    : Number(t.getSessOpt(sess, "@herald_bg_shells")) || 0;

  // Decide state from the reconciled count, regardless of whether this event
  // carried tasks: both the ev and the fallback see the same number.
  const evc = { ...ev, subagents: subs, hasTasks: true };
  let next = nextState(cur, evc, { subagents: subs, shells });

  if (
    shouldSettleSynthSubagentStop({
      tasksSeen,
      event: ev.event,
      subs,
      cur,
    })
  ) {
    next = STATES.DONE;
  }

  // Active-hook clock (not last_hook): task_complete must not block quiet settle.
  if (isActiveHookEvent(ev)) t.setSessOpt(sess, "@herald_last_active", nowSec);

  // Defense-in-depth: quiet/leak settle for synthesis hosts; optional ceilings.
  const lastActive =
    Number(t.getSessOpt(sess, "@herald_last_active")) ||
    Number(t.getSessOpt(sess, "@herald_since")) ||
    0;
  const since = Number(t.getSessOpt(sess, "@herald_since")) || 0;
  const stale = settleIfStale(
    {
      state: next,
      subs,
      tasksSeen,
      lastActive,
      since: resetsElapsed(ev) ? nowSec : since,
    },
    nowSec,
    cfg?.settle,
  );
  if (stale) {
    next = stale.state;
    if (stale.clearSubs) {
      nextIds.clear();
      subs = 0;
    }
  }

  t.setSessOpt(sess, "@herald_state", next);
  applyDoneTransition(t, sess, cur, next, nowSec);
  if (resetsElapsed(ev)) t.setSessOpt(sess, "@herald_since", nowSec);
  t.setSessOpt(sess, "@herald_bg_subagents", subs);
  t.setSessOpt(sess, "@herald_bg_subagent_ids", [...nextIds].join(" "));
  t.setSessOpt(sess, "@herald_bg_shells", shells);
  // Heartbeat: when the last hook landed (includes informational pings).
  t.setSessOpt(sess, "@herald_last_hook", nowSec);
  // Bottom bar wash follows state (working flow, done settle, needs pulse).
  applyWash(sess, nowSec, t, cfg);
};

// CLI entry: arm every session whose name matches glob ("*" = all).
export const armAll = (glob = "*", t = realTmux) => {
  const re = globToRe(glob);
  for (const name of t.listSessions()) if (re.test(name)) arm(name, t);
};

// Hook entry: arm one session if it matches the autoArm glob. Used on
// SessionStart so a newly opened tab self-arms instead of waiting for the next
// periodic arm-all. arm() is idempotent, so a resume/restart re-firing this is
// a no-op.
export const armIfMatch = (sess, glob = "*", t = realTmux) => {
  if (sess && globToRe(glob).test(sess)) arm(sess, t);
};

// Respawn each armed session's card-loop window WITHOUT resetting its state, so
// a change to the card script (new render flags, new layout) reaches sessions
// that are already armed -- the loop reads the script once at window creation,
// so a live edit only takes effect on a fresh window. Every @herald_* option
// and the live windows are preserved; a covered session is re-covered after its
// card is recreated. Non-destructive: only the hidden _curtain window is
// replaced, never a live window or the session itself.
//
// The card's EXIT trap calls reveal on kill. Gate it with @herald_refreshing so
// kill does not uncover; then re-assert covered + bar if we were covered (belt
// for races / older traps), and always clear the flag.
export const refreshCards = (t = realTmux, cfg = loadConfig().curtain) => {
  for (const { name } of t.listArmed()) {
    stampTheme(name, t, cfg);
    const covered = t.getSessOpt(name, "@herald_covered") === "1";
    t.setSessOpt(name, "@herald_refreshing", "1");
    try {
      t.killWindow(`${name}:${CARD_WIN}`);
      t.newCardWindow(name, CARD_WIN, LOOP);
      if (covered) {
        t.setSessOpt(name, "@herald_covered", "1");
        applyBar(name, true, t, cfg);
        t.selectWindow(`${name}:${CARD_WIN}`);
      }
    } finally {
      t.unsetSessOpt(name, "@herald_refreshing");
    }
  }
};

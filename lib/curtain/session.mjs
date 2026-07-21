import { fileURLToPath } from "node:url";
import { globToRe, loadConfig } from "../config.mjs";
import { seedFor, speciesFor } from "./denizens.mjs";
import {
  isBgTaskStart,
  isLoopPrompt,
  isMonitorStart,
  isSchedulerCreate,
  isSubagentSpawnTool,
  isWatchEnd,
  nextState,
  resetsElapsed,
} from "./hook.mjs";
import {
  countLive,
  grant,
  parseLeases,
  reconcile,
  release,
  serializeLeases,
  touch,
} from "./lease.mjs";
import { isActiveHookEvent, settleIfStale } from "./settle.mjs";
import { STATES, computeElapsed } from "./state.mjs";
import { drawFrameMs, motionDisabled, selectEffects } from "./theatrics.mjs";
import { isAnimated, resolveThemeByName, themeNameFor } from "./themes.mjs";
import * as realTmux from "./tmux.mjs";
import { composeWashStyle, sampleWash } from "./wash.mjs";

// User's pre-herald status-style base (saved once so wash/cover can recompose).
const userBarBase = (sess, t) => {
  const saved = t.getSessOpt(sess, "@herald_user_status_style");
  if (saved !== "" && saved != null) return saved;
  // First touch: capture current style as user base (may already include wash).
  const cur = t.getSessOpt(sess, "status-style") || "";
  // Strip solid wash colours so we don't re-apply the old full-bar flood.
  const base = cur
    .replace(/(?:,|^)bg=colour\d+/gi, "")
    .replace(/(?:,|^)bg=#[0-9a-fA-F]+/g, "")
    .replace(/^,|,$/g, "");
  t.setSessOpt(sess, "@herald_user_status_style", base);
  return base;
};

/** Ensure status-left shows #{@herald_bar_line} without clobbering user left. */
const ensureBarLineSlot = (sess, t, active) => {
  const cur = t.getSessOpt(sess, "status-left") || "";
  const hasSlot = cur.includes("@herald_bar_line");
  if (active) {
    if (!hasSlot) {
      // Save original once (may be empty → inherit global).
      if (t.getSessOpt(sess, "@herald_user_status_left") === "")
        t.setSessOpt(sess, "@herald_user_status_left", cur);
      const user = t.getSessOpt(sess, "@herald_user_status_left") || "";
      // Line first (slides); then user's prior status-left content as literal.
      t.setSessOpt(
        sess,
        "status-left",
        user ? `#{@herald_bar_line} ${user}` : "#{@herald_bar_line} ",
      );
      // Room for a 14-cell track + separator.
      const len = Number(t.getSessOpt(sess, "status-left-length")) || 0;
      if (len < 28) t.setSessOpt(sess, "status-left-length", 28);
    }
  } else if (hasSlot) {
    const user = t.getSessOpt(sess, "@herald_user_status_left");
    if (user) t.setSessOpt(sess, "status-left", user);
    else t.unsetSessOpt(sess, "status-left");
  }
};

/**
 * Transparent bar + sliding horizontal line from @herald_state.
 * Driven by card loop (~0.5–1s) and hooks. Fail-open; no-op when wash off.
 */
export const washEnabled = (cfg) => cfg?.tmuxBar?.wash === true;

export const applyWash = (
  sess,
  nowSec,
  t = realTmux,
  cfg = loadConfig().curtain,
) => {
  if (!sess) return;
  // Wash off (default): tear down any leftover line + restore status-left so
  // #{@ctxbar} / session context stays the visible signal on the bar.
  if (!washEnabled(cfg)) {
    const left = t.getSessOpt(sess, "status-left") || "";
    if (left.includes("@herald_bar_line")) {
      const user = t.getSessOpt(sess, "@herald_user_status_left");
      if (user) t.setSessOpt(sess, "status-left", user);
      else t.unsetSessOpt(sess, "status-left");
    }
    if (t.getSessOpt(sess, "@herald_bar_line"))
      t.setSessOpt(sess, "@herald_bar_line", "");
    return;
  }

  const state = t.getSessOpt(sess, "@herald_state") || STATES.IDLE;
  const since = Number(t.getSessOpt(sess, "@herald_since")) || 0;

  const { line, settled } = sampleWash({
    state,
    sinceSec: since,
    nowSec,
    doneFlashSec: cfg?.tmuxBar?.doneFlashSec ?? 3,
  });

  // Always transparent bar background — never solid colour flood.
  const userBase = userBarBase(sess, t);
  const style = composeWashStyle({ userBase, coverTransparent: true });
  const prevStyle = t.getSessOpt(sess, "status-style") || "";
  if (style !== prevStyle) {
    if (style) t.setSessOpt(sess, "status-style", style);
    else t.unsetSessOpt(sess, "status-style");
  }

  const prevLine = t.getSessOpt(sess, "@herald_bar_line") || "";
  if (line !== prevLine) t.setSessOpt(sess, "@herald_bar_line", line);

  // Active animation → keep slot; settled/idle → drop line + restore status-left.
  ensureBarLineSlot(sess, t, !!line && !settled);
  if (settled || !line) {
    if (prevLine) t.setSessOpt(sess, "@herald_bar_line", "");
    ensureBarLineSlot(sess, t, false);
  }
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
// Stage-curtain draw burst uses a faster @herald_draw_ms (≤ ~600ms full draw).
const stampTheme = (sess, t, cfg = loadConfig().curtain) => {
  const name = themeNameFor(sess, cfg);
  t.setSessOpt(sess, "@herald_theme", name);
  const anim = cfg.animation || {};
  const animated =
    isAnimated(resolveThemeByName(name, cfg)) && !motionDisabled(anim);
  const ms = animated ? Math.round(1000 / (anim.fps || 2)) : 1000;
  t.setSessOpt(sess, "@herald_frame_ms", ms);
  t.setSessOpt(sess, "@herald_draw_ms", drawFrameMs(anim));
  t.setSessOpt(
    sess,
    "@herald_draw_frames",
    String(Number(anim.drawFrames) > 0 ? Math.floor(anim.drawFrames) : 8),
  );
};

/** True when this session should play stage-curtain shut/open theatrics. */
export const stageDrawEnabled = (
  sess,
  cfg = loadConfig().curtain,
  t = realTmux,
) => {
  if (motionDisabled(cfg?.animation || {})) return false;
  const themeName =
    t?.getSessOpt?.(sess, "@herald_theme") || themeNameFor(sess, cfg);
  return selectEffects({
    state: "working",
    themeName,
    animCfg: cfg?.animation || {},
  }).stageDraw;
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
  // Truth-lease store: empty on arm so a re-armed session starts clean.
  t.setSessOpt(sess, "@herald_leases", "");
  // Default synthesis host (Grok); first hasTasks payload promotes to task_list.
  t.setSessOpt(sess, "@herald_host_kind", "synthesis");
  t.setSessOpt(sess, "@herald_agent_pid", "0");
  t.setSessOpt(sess, "@herald_model_hint", "");
  t.setSessOpt(sess, "@herald_worked", 0);
  t.setSessOpt(sess, "@herald_last_active", "0");
  t.setSessOpt(sess, "@herald_paused", "0");
  stampTheme(sess, t, cfg);
  // Act II: stamp the per-tab creature ONCE. Deterministic by session name so
  // it survives rename; injected here so the render path stays pure.
  t.setSessOpt(sess, "@herald_entity", speciesFor(sess, cfg));
  t.setSessOpt(sess, "@herald_seed", String(seedFor(sess)));
  t.setSessOpt(sess, "@herald_armed", "1");
};

/** Backfill entity/seed on already-armed sessions (refresh / upgrade path). */
export const ensureDenizenStamp = (
  sess,
  t = realTmux,
  cfg = loadConfig().curtain,
) => {
  if (!sess) return;
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (!t.getSessOpt(sess, "@herald_entity")) {
    t.setSessOpt(sess, "@herald_entity", speciesFor(sess, cfg));
  }
  if (!t.getSessOpt(sess, "@herald_seed")) {
    t.setSessOpt(sess, "@herald_seed", String(seedFor(sess)));
  }
};

// Restore the live view, drop the card window and the armed marker.
export const disarm = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  reveal(sess, t, cfg);
  t.killWindow(`${sess}:${CARD_WIN}`);
  // Drop the session-local overrides so the title falls back to the global one.
  t.unsetSessOpt(sess, "set-titles-string");
  t.unsetSessOpt(sess, "set-titles");
  t.setSessOpt(sess, "@herald_armed", "0");
  t.setSessOpt(sess, "@herald_paused", "0");
};

/**
 * Hold this session's curtain open: force-reveal and refuse auto-cover
 * (focus adapter, cover CLI, etc.) until resume. Stays armed — hooks still
 * stamp state so the card is correct when you resume. Use when you need to
 * copy text from the live agent pane into a browser (or keep the TUI visible
 * while the tab is unfocused).
 */
export const pause = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  if (!sess) return;
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  t.setSessOpt(sess, "@herald_paused", "1");
  reveal(sess, t, cfg);
};

/** Clear pause so focus/cover may show the card again. Does not force-cover. */
export const resume = (sess, t = realTmux, _cfg = loadConfig().curtain) => {
  if (!sess) return;
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  t.setSessOpt(sess, "@herald_paused", "0");
};

/** Pause every armed session (fleet-wide hold-open). */
export const pauseAll = (t = realTmux, cfg = loadConfig().curtain) => {
  for (const s of t.listArmed()) pause(s.name, t, cfg);
};

/** Resume every armed session. */
export const resumeAll = (t = realTmux, cfg = loadConfig().curtain) => {
  for (const s of t.listArmed()) resume(s.name, t, cfg);
};

// Show the card, if this session is armed, coverable, and not already covered.
export const cover = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_paused") === "1") return;
  if (t.getSessOpt(sess, "@herald_covered") === "1") return;
  if (!coverableFrom(cfg).has(t.getSessOpt(sess, "@herald_state"))) return;
  // Never capture the card window itself as the live window — that would
  // strand the session behind the card. If we're somehow already on the
  // card (state desync), keep the stored live window and just mark covered.
  if (t.windowNameOf(t.activeWindowId(sess)) !== CARD_WIN)
    t.setSessOpt(sess, "@herald_live_win", t.activeWindowId(sess));
  t.selectWindow(`${sess}:${CARD_WIN}`);
  t.setSessOpt(sess, "@herald_covered", "1");
  // Act I: stage-curtain shut over the next drawFrames ticks (card loop).
  if (stageDrawEnabled(sess, cfg, t))
    t.setSessOpt(sess, "@herald_draw", "shut");
  else t.setSessOpt(sess, "@herald_draw", "");
  applyBar(sess, true, t, cfg);
};

// Bring the remembered live window back. Always immediate (fail-open): open
// theatrics are painted by the card loop *before* it calls reveal (keypress
// sets @herald_draw=open, then commits reveal when the draw finishes).
export const reveal = (sess, t = realTmux, cfg = loadConfig().curtain) => {
  if (t.getSessOpt(sess, "@herald_armed") !== "1") return;
  if (t.getSessOpt(sess, "@herald_covered") !== "1") return;
  const live = t.getSessOpt(sess, "@herald_live_win");
  if (live) t.selectWindow(live);
  t.setSessOpt(sess, "@herald_covered", "0");
  t.setSessOpt(sess, "@herald_draw", "");
  applyBar(sess, false, t, cfg);
};

// Panic / fail-open: reveal every covered armed session.
export const revealAll = (t = realTmux, cfg = loadConfig().curtain) => {
  for (const s of t.listArmed()) reveal(s.name, t, cfg);
};

// Reveal from a pre-read snapshot row: writes only, no per-session reads.
// Focus hot path uses immediate reveal (no 600ms open delay on tab switch).
const revealFrom = (s, t, cfg) => {
  if (!s.covered) return;
  if (s.liveWin) t.selectWindow(s.liveWin);
  t.setSessOpt(s.name, "@herald_covered", "0");
  t.setSessOpt(s.name, "@herald_draw", "");
  applyBar(s.name, false, t, cfg);
};

// Cover from a snapshot row + the window-name map. Mirrors cover()'s guards: a
// non-coverable state is left live, and the card window is never captured as the
// live window (desync self-heal). No reads -- the snapshot already carries them.
const coverFrom = (s, t, names, cfg) => {
  if (s.covered) return;
  if (s.paused) return; // operator hold-open (pause) — never auto-cover
  if (!coverableFrom(cfg).has(s.state)) return;
  if (names[s.activeWin] !== CARD_WIN)
    t.setSessOpt(s.name, "@herald_live_win", s.activeWin);
  t.selectWindow(`${s.name}:${CARD_WIN}`);
  t.setSessOpt(s.name, "@herald_covered", "1");
  if (stageDrawEnabled(s.name, cfg, t))
    t.setSessOpt(s.name, "@herald_draw", "shut");
  else t.setSessOpt(s.name, "@herald_draw", "");
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
// truth-lease store and card state. Every WORKING hold is a lease {kind,id,exp};
// expired leases stop counting without any further event.

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

/** Release one subagent lease: exact id, else oldest syn-*, else any. */
const releaseSubagentLease = (leases, agentId) => {
  if (agentId) {
    const exact = leases.find(
      (l) =>
        l.kind === "subagent" && l.id === String(agentId).replace(/[,:]/g, "_"),
    );
    if (exact) return release(leases, "subagent", exact.id);
    const syn = leases.find(
      (l) => l.kind === "subagent" && String(l.id).startsWith("syn-"),
    );
    if (syn) return release(leases, "subagent", syn.id);
  }
  const any = leases.find((l) => l.kind === "subagent");
  return any ? release(leases, "subagent", any.id) : leases;
};

/** Shell ids from a task-list event (authoritative). */
const shellIdsFromEv = (ev) => {
  if (Array.isArray(ev.shellIds) && ev.shellIds.length) return ev.shellIds;
  const n = Number(ev.shells) || 0;
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => `shell-${i}`);
};

/** Explicit monitor ids from a task-list event (type:monitor / type:workflow). */
const monitorIdsFromEv = (ev) => {
  if (Array.isArray(ev.monitorIds) && ev.monitorIds.length)
    return ev.monitorIds;
  const n = Number(ev.monitors) || 0;
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => `mon-${i}`);
};

/** Subagent ids from a task-list event. */
const subagentIdsFromEv = (ev) => {
  if (Array.isArray(ev.subagentIds) && ev.subagentIds.length)
    return ev.subagentIds;
  if (Array.isArray(ev.inflightIds) && ev.inflightIds.length) {
    // When types are unknown, treat all inflight as subagents only if no shells
    // count is given separately — otherwise prefer explicit subagentIds.
    if (!ev.shells) return ev.inflightIds;
  }
  const n = Number(ev.subagents) || 0;
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => `sub-${i}`);
};

/** Synthetic / non-task watcher ids that must survive task-list reconcile. */
const SYSTEM_WATCHER_IDS = new Set(["loop", "loop-pending", "mon"]);

/**
 * Best-effort PID liveness check. EPERM counts as alive (process exists but
 * we cannot signal it). Missing/invalid pid → false.
 * @param {number|string} pid
 * @returns {boolean}
 */
export const isPidAlive = (pid) => {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    // EPERM: process exists but we lack permission — treat as alive.
    if (e && (e.code === "EPERM" || e.errno === -1)) return true;
    return false;
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
  const leases = parseLeases(t.getSessOpt(sess, "@herald_leases"));
  const counts = countLive(leases, nowSec);
  const hostKind = t.getSessOpt(sess, "@herald_host_kind") || "synthesis";
  const lastActive = Number(t.getSessOpt(sess, "@herald_last_active")) || 0;
  const since = Number(t.getSessOpt(sess, "@herald_since")) || 0;
  const pid = Number(t.getSessOpt(sess, "@herald_agent_pid")) || 0;
  const agentAlive = pid > 0 ? isPidAlive(pid) : null;
  const decision = settleIfStale(
    {
      state: cur,
      counts,
      hostKind,
      lastActive,
      since,
      agentAlive,
    },
    nowSec,
    cfg?.settle,
  );
  // Health stamp for doctor RC3 detection (even when settle is a no-op).
  t.setSessOpt(sess, "@herald_settle_ts", nowSec);
  if (!decision) return false;
  t.setSessOpt(sess, "@herald_state", decision.state);
  applyDoneTransition(t, sess, cur, decision.state, nowSec);
  if (decision.clearLeases) {
    t.setSessOpt(sess, "@herald_leases", "");
  }
  return true;
};

// Synthesis-only hosts (Grok: never saw task list) never emit idle_prompt.
// After the last subagent drains, settle to DONE — task_list hosts keep the
// idle_prompt hold.
export const shouldSettleSynthSubagentStop = ({
  hostKind,
  // legacy alias
  tasksSeen,
  event,
  subs,
  // watchers kept for call-site backcompat; never block settle (informational)
  watchers: _watchers = 0,
  cur,
}) => {
  const isTaskList =
    hostKind === "task_list" || tasksSeen === true || tasksSeen === "1";
  return (
    !isTaskList &&
    event === "SubagentStop" &&
    subs === 0 &&
    (cur === STATES.WORKING || cur === STATES.COMPACTING)
  );
};

/**
 * Apply watcher classifiers to leases (id-set semantics preserved).
 * - /loop prompt → grant "loop-pending"
 * - scheduler_create → release pending, grant "loop"
 * - Monitor with toolTaskId → grant that id (one lease per monitor task)
 * - Monitor without id (PreToolUse) → provisional "mon"
 * - watch end → clear all watchers
 *
 * Claude's Monitor tool returns { taskId } on PostToolUse; without that id
 * every monitor collapsed to a single watcher:mon while background_tasks
 * still listed them as type:"shell" → "1 watcher N tasks" (live 2026-07-17).
 */
export const applyWatcherLeases = (leases, ev, nowSec, leaseCfg) => {
  let next = leases;
  if (isLoopPrompt(ev))
    next = grant(next, "watcher", "loop-pending", nowSec, leaseCfg);
  if (isSchedulerCreate(ev)) {
    next = release(next, "watcher", "loop-pending");
    next = grant(next, "watcher", "loop", nowSec, leaseCfg);
  }
  if (isMonitorStart(ev)) {
    const tid = String(ev.toolTaskId || "").trim();
    if (tid) {
      // Concrete task id: drop the provisional placeholder and grant per-monitor.
      next = release(next, "watcher", "mon");
      next = grant(next, "watcher", tid, nowSec, leaseCfg);
    } else {
      // PreToolUse (no task id yet) — provisional single mon until PostToolUse.
      next = grant(next, "watcher", "mon", nowSec, leaseCfg);
    }
  }
  if (isWatchEnd(ev)) next = reconcile(next, "watcher", [], nowSec, leaseCfg);
  return next;
};

/** Pre-lease display opts still read by old card loops; merged code never writes them. */
const LEGACY_BG_OPTS = [
  "@herald_bg_watchers",
  "@herald_bg_watcher_ids",
  "@herald_bg_subagents",
  "@herald_bg_subagent_ids",
  "@herald_bg_shells",
  "@herald_tasks_seen",
];

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
  const leaseCfg = cfg?.lease || {};
  let leases = parseLeases(t.getSessOpt(sess, "@herald_leases"));
  let hostKind = t.getSessOpt(sess, "@herald_host_kind") || "synthesis";

  // 1. PID + model hint on active events.
  if (isActiveHookEvent(ev)) {
    const pid = Number(ev.pid) || Number(process.ppid) || 0;
    if (pid > 0) t.setSessOpt(sess, "@herald_agent_pid", pid);
    if (ev.sourceCli && ev.sourceCli !== "unknown") {
      const prevSrc = t.getSessOpt(sess, "@herald_model_hint_src");
      let sourceSwitched = false;
      if (prevSrc && prevSrc !== ev.sourceCli) {
        // CLI changed (e.g. grok child finished, Fable session resumed):
        // the old hint is a lie for this source — drop it. Do not re-stamp
        // from env on the same event (env may still name the previous CLI).
        t.setSessOpt(sess, "@herald_model_hint", "");
        t.setSessOpt(sess, "@herald_model_hint_src", "");
        sourceSwitched = true;
      }
      if (!sourceSwitched && !t.getSessOpt(sess, "@herald_model_hint")) {
        const model = process.env.GROK_MODEL || process.env.LLM_PRESET || "";
        if (model) {
          const effort = process.env.GROK_EFFORT || "";
          t.setSessOpt(
            sess,
            "@herald_model_hint",
            effort ? `${model}@${effort}` : model,
          );
          t.setSessOpt(sess, "@herald_model_hint_src", ev.sourceCli);
        }
      }
    }
  }

  // Clear fossil pre-lease bg opts on fresh turn / session start.
  if (
    ev.event === "SessionStart" ||
    (ev.event === "UserPromptSubmit" && !ev.synthetic)
  ) {
    for (const opt of LEGACY_BG_OPTS) {
      if (t.getSessOpt(sess, opt)) t.setSessOpt(sess, opt, "");
    }
  }

  // 2. Host kind classification. A Claude-sourced task list is proof the
  // reliable-Stop CLI is speaking: it claims (or reclaims) task_list even
  // from hybrid, so a wrongly demoted session self-heals on its next Stop.
  if (
    ev.hasTasks &&
    (hostKind === "synthesis" ||
      (hostKind === "hybrid" && ev.sourceCli === "claude"))
  ) {
    hostKind = "task_list";
    t.setSessOpt(sess, "@herald_host_kind", "task_list");
  }

  // 3. Lease mutations (order matters).
  if (ev.event === "SessionEnd") {
    // Agent process ending: clear every lease kind (work dies with the process).
    leases = reconcile(leases, "subagent", [], nowSec, leaseCfg);
    leases = reconcile(leases, "watcher", [], nowSec, leaseCfg);
    leases = reconcile(leases, "bg_shell", [], nowSec, leaseCfg);
    leases = release(leases, "turn", "turn");
  } else if (ev.hasTasks) {
    const subIds = subagentIdsFromEv(ev);
    const shAll = shellIdsFromEv(ev);
    const monFromEv = monitorIdsFromEv(ev);
    // Claude types Monitor-spawned tasks as type:"shell" in background_tasks
    // (hook-debug: only shell|subagent). IDs already granted as watcher leases
    // (via Monitor PostToolUse taskId) must not be re-reconciled into bg_shell.
    const knownMon = new Set([
      ...monFromEv,
      ...leases
        .filter(
          (l) => l.kind === "watcher" && !SYSTEM_WATCHER_IDS.has(String(l.id)),
        )
        .map((l) => l.id),
    ]);
    const pureShellIds = shAll.filter((id) => !knownMon.has(id));
    const monKeep = [
      ...new Set([...shAll.filter((id) => knownMon.has(id)), ...monFromEv]),
    ];
    // Claude Stop sometimes reports background_tasks: [] while monitors and
    // shells are demonstrably alive (captured live 2026-07-16). An empty list
    // on Stop must not wipe inventory -- TTL decay retires the leases within
    // one TTL if the emptiness was real. Non-empty lists, and every
    // SubagentStop, stay authoritative.
    const distrust =
      ev.event === "Stop" &&
      subIds.length === 0 &&
      shAll.length === 0 &&
      monFromEv.length === 0;
    if (!distrust) {
      leases = reconcile(leases, "subagent", subIds, nowSec, leaseCfg);
      leases = reconcile(leases, "bg_shell", pureShellIds, nowSec, leaseCfg);
      // Refresh monitor leases still inflight; drop task-id watchers that left.
      // Preserve system watchers (loop / loop-pending / provisional mon).
      const systemWatchers = leases.filter(
        (l) => l.kind === "watcher" && SYSTEM_WATCHER_IDS.has(String(l.id)),
      );
      const others = leases.filter((l) => l.kind !== "watcher");
      let nextWatch = [...systemWatchers];
      for (const id of monKeep) {
        nextWatch = grant(nextWatch, "watcher", id, nowSec, leaseCfg);
      }
      // Provisional mon is redundant once real monitor taskIds exist.
      if (monKeep.length > 0) {
        nextWatch = release(nextWatch, "watcher", "mon");
      }
      leases = [...others, ...nextWatch];
    }
  } else if (ev.event === "Stop" && !ev.hasTasks) {
    // Grok (and other non-task-list hosts) fire Stop when the *main* turn ends,
    // often while SubagentStart children are still live (live 2026-07: syndcast
    // showed DONE with 17 kids still running). Do NOT wipe subagent leases here.
    //
    // Cleanup paths that remain correct:
    // - SubagentStop / agentId tool heartbeats
    // - subagent TTL + settleSynthLeakSec
    // - SessionEnd / human UserPromptSubmit
    // Claude empty Stop is already guarded by `distrust` above (hasTasks true).
  }

  if (ev.event === "SubagentStart") {
    // Claude SubagentStart never carries background_tasks (captured live
    // 2026-07-16) -- a bt-less start proves host mixing only when it comes
    // from a NON-Claude CLI. Demoting on Claude's own starts put every
    // multi-subagent Claude session on Grok's silence heuristics.
    if (hostKind === "task_list" && !ev.hasTasks && ev.sourceCli !== "claude") {
      hostKind = "hybrid";
      t.setSessOpt(sess, "@herald_host_kind", "hybrid");
    }
    const liveSubs = countLive(leases, nowSec).subagent;
    const id = ev.agentId || `syn-${nowSec}-${liveSubs}`;
    leases = grant(leases, "subagent", id, nowSec, leaseCfg);
  } else if (ev.event === "SubagentStop") {
    leases = releaseSubagentLease(leases, ev.agentId);
  }

  // Self-healing counts: any tool event fired BY a subagent carries agentId
  // (captured live 2026-07-16). A parked monitor whose lease TTL-expired
  // re-earns it on its next heartbeat; background_tasks only exists on
  // Stop/SubagentStop, so this is the only between-reconcile evidence.
  if (ev.agentId && (ev.event === "PreToolUse" || ev.event === "PostToolUse")) {
    leases = grant(leases, "subagent", ev.agentId, nowSec, leaseCfg);
  }

  // Grok often omits SubagentStart for spawn_subagent fleets; still grant a
  // lease from the spawn tool itself so Stop cannot false-finish the card.
  if (
    !ev.hasTasks &&
    isSubagentSpawnTool(ev) &&
    (ev.event === "PreToolUse" || ev.event === "PostToolUse")
  ) {
    const tid = String(ev.toolTaskId || ev.agentId || "").trim();
    const id = tid || `syn-spawn-${nowSec}`;
    leases = grant(leases, "subagent", id, nowSec, leaseCfg);
  }

  // Non-synthetic human prompt clears synth subagents (fresh turn).
  if (ev.event === "UserPromptSubmit" && !ev.synthetic) {
    leases = reconcile(leases, "subagent", [], nowSec, leaseCfg);
  }

  leases = applyWatcherLeases(leases, ev, nowSec, leaseCfg);

  // Synthesis bg shells (Claude uses hasTasks reconcile above).
  // Prefer the concrete backgroundTaskId when the tool response carries one.
  if (!ev.hasTasks && isBgTaskStart(ev)) {
    const tid = String(ev.toolTaskId || "").trim();
    leases = grant(leases, "bg_shell", tid || `bg-${nowSec}`, nowSec, leaseCfg);
  }
  if (!ev.hasTasks && isWatchEnd(ev)) {
    const nTool = String(ev?.toolName || "").toLowerCase();
    if (/kill/.test(nTool)) {
      const any = leases.find((l) => l.kind === "bg_shell");
      if (any) leases = release(leases, "bg_shell", any.id);
    }
  }

  // Turn lease: activity grants/refreshes; Stop releases. Watchers are NOT
  // touched by generic activity — they live only on their own evidence
  // (loop wakeup / scheduler_create / monitor call) plus TTL decay.
  if (
    isActiveHookEvent(ev) ||
    (ev.event === "UserPromptSubmit" && !ev.synthetic)
  ) {
    leases = grant(leases, "turn", "turn", nowSec, leaseCfg);
    leases = touch(leases, nowSec, leaseCfg, ["subagent", "bg_shell", "turn"]);
  }
  if (ev.event === "Stop") {
    leases = release(leases, "turn", "turn");
  }

  const counts = countLive(leases, nowSec);
  const subs = counts.subagent;
  const watchers = counts.watcher;
  const shells = counts.bg_shell;

  // Decide state from live lease counts.
  const evc = { ...ev, subagents: subs, hasTasks: true };
  let next = nextState(cur, evc, { subagents: subs, shells, watchers });

  if (
    shouldSettleSynthSubagentStop({
      hostKind,
      event: ev.event,
      subs,
      watchers,
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
      counts,
      hostKind,
      lastActive,
      since: resetsElapsed(ev) ? nowSec : since,
      agentAlive: null,
    },
    nowSec,
    cfg?.settle,
  );
  if (stale) {
    next = stale.state;
    if (stale.clearLeases) {
      leases = [];
    }
  }

  t.setSessOpt(sess, "@herald_state", next);
  applyDoneTransition(t, sess, cur, next, nowSec);
  if (resetsElapsed(ev)) t.setSessOpt(sess, "@herald_since", nowSec);
  t.setSessOpt(sess, "@herald_leases", serializeLeases(leases));
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
    ensureDenizenStamp(name, t, cfg);
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

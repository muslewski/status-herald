// Pure settle policy for stuck curtain states. No I/O.
// Lease-aware: counts already exclude expired leases (caller uses countLive).
// Watchers are informational — they never hold WORKING and never block settle.

import { STATES } from "./state.mjs";

/** Defaults merged under curtain.settle — safe for fleets. */
export const SETTLE_DEFAULTS = Object.freeze({
  // WORKING/COMPACTING, all counts 0, synthesis/hybrid, quiet N → DONE.
  // 300s headroom for silent thinking (turn TTL 120 + quiet ≈ 7 min total).
  settleSynthQuietSec: 300,
  // WORKING, subagent>0, !task_list, quiet N → DONE and clear leases
  settleSynthLeakSec: 360,
  // Absolute ceiling for WORKING/COMPACTING (any host). 0 = off.
  maxWorkingSec: 0,
  // Abandoned NEEDS after N seconds. 0 = off (permission may wait for hours).
  maxNeedsSec: 0,
});

/**
 * Events that prove the agent is still doing real work (or blocking the user).
 * Informational pings (task_complete) and synthetic prompts are NOT active —
 * otherwise quiet settle can never fire while last_hook stays hot.
 */
export const isActiveHookEvent = (ev) => {
  if (!ev?.event) return false;
  if (ev.event === "UserPromptSubmit") return !ev.synthetic;
  if (
    ev.event === "SubagentStart" ||
    ev.event === "SubagentStop" ||
    ev.event === "PostToolUse" ||
    ev.event === "PreToolUse" ||
    ev.event === "PreCompact" ||
    ev.event === "Stop"
  ) {
    return true;
  }
  if (ev.event === "Notification") {
    const t = ev.notificationType;
    return (
      t === "permission_prompt" || t === "agent_error" || t === "idle_prompt"
    );
  }
  return false;
};

const totalLive = (counts) => {
  const c = counts || {};
  // watcher deliberately excluded: informational, never holds state.
  return (
    (Number(c.subagent) || 0) +
    (Number(c.bg_shell) || 0) +
    (Number(c.turn) || 0)
  );
};

/**
 * @param {object} snap
 * @param {string} snap.state
 * @param {{ subagent?: number, watcher?: number, bg_shell?: number, turn?: number }} snap.counts
 * @param {"task_list"|"synthesis"|"hybrid"|string} snap.hostKind
 * @param {number} snap.lastActive  unix sec; 0 = unknown (use since)
 * @param {number} snap.since      turn start unix sec
 * @param {boolean|null} [snap.agentAlive]  false → PID backstop; null/true skip
 * @param {number} nowSec
 * @param {object} [cfg] settle knobs
 * @returns {{ state: string, clearLeases: boolean } | null}
 */
export const settleIfStale = (snap, nowSec, cfg = {}) => {
  const c = { ...SETTLE_DEFAULTS, ...cfg };
  const state = snap?.state || STATES.IDLE;
  const counts = snap?.counts || {};
  // Legacy bridge: callers may still pass flat subs/watchers/tasksSeen.
  const subagent = Number(counts.subagent) || Number(snap?.subs) || 0;
  const watcher = Number(counts.watcher) || Number(snap?.watchers) || 0;
  const bg_shell = Number(counts.bg_shell) || 0;
  const turn = Number(counts.turn) || 0;
  const liveCounts = { subagent, watcher, bg_shell, turn };
  let hostKind = snap?.hostKind || "";
  if (!hostKind && snap?.tasksSeen) hostKind = "task_list";
  if (!hostKind) hostKind = "synthesis";
  const isTaskList = hostKind === "task_list";
  const now = Number(nowSec) || 0;
  const lastActive =
    Number(snap?.lastActive) > 0
      ? Number(snap.lastActive)
      : Number(snap?.since) || 0;
  const since = Number(snap?.since) || 0;
  const quiet = lastActive > 0 ? Math.max(0, now - lastActive) : 0;
  const age = since > 0 ? Math.max(0, now - since) : 0;
  const agentAlive = snap?.agentAlive;

  // 1. PID backstop: dead agent process forces DONE (Task 5 wires input).
  if (
    agentAlive === false &&
    (state === STATES.WORKING ||
      state === STATES.COMPACTING ||
      state === STATES.NEEDS)
  ) {
    return { state: STATES.DONE, clearLeases: true };
  }

  // 2. Abandoned NEEDS (opt-in only)
  if (state === STATES.NEEDS) {
    const maxN = Number(c.maxNeedsSec) || 0;
    if (maxN > 0 && lastActive > 0 && quiet >= maxN) {
      return { state: STATES.DONE, clearLeases: true };
    }
    return null;
  }

  // 3. Only WORKING/COMPACTING beyond this point.
  if (state !== STATES.WORKING && state !== STATES.COMPACTING) return null;

  // 4. All live counts zero.
  if (totalLive(liveCounts) === 0) {
    if (!isTaskList) {
      const q = Number(c.settleSynthQuietSec) || 0;
      if (q > 0 && lastActive > 0 && quiet >= q) {
        return { state: STATES.DONE, clearLeases: true };
      }
    }
    // task_list waits for idle_prompt unless maxWorkingSec fires below.
  } else if (subagent > 0 && !isTaskList) {
    // 5. Leak settle for synthesis/hybrid with leftover subagent leases.
    const leak = Number(c.settleSynthLeakSec) || 0;
    if (leak > 0 && lastActive > 0 && quiet >= leak) {
      return { state: STATES.DONE, clearLeases: true };
    }
  }
  // 6. Watchers excluded from totalLive — never block quiet settle.

  // 7. maxWorkingSec ceiling (any host).
  const maxW = Number(c.maxWorkingSec) || 0;
  if (maxW > 0 && since > 0 && age >= maxW) {
    return { state: STATES.DONE, clearLeases: true };
  }

  return null;
};

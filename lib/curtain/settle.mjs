// Pure settle policy for stuck curtain states. No I/O.
// Synthesis-only hosts (Grok: never saw background_tasks) can quiet-settle;
// Claude task-list hosts wait for idle_prompt unless maxWorkingSec is set.

import { STATES } from "./state.mjs";

/** Defaults merged under curtain.settle — safe for fleets. */
export const SETTLE_DEFAULTS = Object.freeze({
  // WORKING/COMPACTING, subs=0, !tasksSeen, no active hook for N seconds → DONE
  settleSynthQuietSec: 90,
  // WORKING, subs>0, !tasksSeen, quiet for N → DONE and clear leaked synth ids
  settleSynthLeakSec: 180,
  // Absolute ceiling for WORKING/COMPACTING with subs=0 (any host). 0 = off.
  // Prefer late over early; only enable as a fleet kill-switch.
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

/**
 * @param {object} snap
 * @param {string} snap.state
 * @param {number} snap.subs
 * @param {boolean} snap.tasksSeen
 * @param {number} snap.lastActive  unix sec; 0 = unknown (use since)
 * @param {number} snap.since      turn start unix sec
 * @param {number} nowSec
 * @param {object} [cfg] settle knobs
 * @returns {{ state: string, clearSubs: boolean } | null}
 */
export const settleIfStale = (snap, nowSec, cfg = {}) => {
  const c = { ...SETTLE_DEFAULTS, ...cfg };
  const state = snap?.state || STATES.IDLE;
  const subs = Number(snap?.subs) || 0;
  const tasksSeen = !!snap?.tasksSeen;
  const now = Number(nowSec) || 0;
  const lastActive =
    Number(snap?.lastActive) > 0
      ? Number(snap.lastActive)
      : Number(snap?.since) || 0;
  const since = Number(snap?.since) || 0;
  const quiet = lastActive > 0 ? Math.max(0, now - lastActive) : 0;
  const age = since > 0 ? Math.max(0, now - since) : 0;

  // Abandoned NEEDS (opt-in only)
  if (state === STATES.NEEDS) {
    const maxN = Number(c.maxNeedsSec) || 0;
    if (maxN > 0 && lastActive > 0 && quiet >= maxN) {
      return { state: STATES.DONE, clearSubs: true };
    }
    return null;
  }

  if (state !== STATES.WORKING && state !== STATES.COMPACTING) return null;

  // Never timeout away real in-flight subs on Claude (tasksSeen).
  // Synthesis hosts may leak syn-* ids forever — leak settle clears them.
  if (subs > 0) {
    if (tasksSeen) return null;
    const leak = Number(c.settleSynthLeakSec) || 0;
    if (leak > 0 && lastActive > 0 && quiet >= leak) {
      return { state: STATES.DONE, clearSubs: true };
    }
    return null;
  }

  // subs === 0
  if (!tasksSeen) {
    const q = Number(c.settleSynthQuietSec) || 0;
    if (q > 0 && lastActive > 0 && quiet >= q) {
      return { state: STATES.DONE, clearSubs: false };
    }
  }

  const maxW = Number(c.maxWorkingSec) || 0;
  if (maxW > 0 && since > 0 && age >= maxW) {
    return { state: STATES.DONE, clearSubs: false };
  }

  return null;
};

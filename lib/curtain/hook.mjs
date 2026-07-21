import { normalizePayload } from "./adapters/index.mjs";
import { isSyntheticUserPrompt } from "./adapters/shared.mjs";
import { STATES } from "./state.mjs";

export { isSyntheticUserPrompt };

// Read a hook payload from stdin JSON (supports Claude Code and Grok Build
// shapes, and aliases). Returns null for anything unparseable, so a hook can
// never break the agent that called it.
export const parseHookPayload = (raw) => {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;

  const ev = normalizePayload(p);
  if (!ev.event) return null;
  // Preserve legacy field surface used by session.mjs / tests.
  return ev;
};

// Normalize tool names for matching (Grok camelCase, Claude Bash, etc.).
export const toolKey = (ev) =>
  String(ev?.toolName || "")
    .toLowerCase()
    .replace(/[^a-z_]/g, "");

// Grok /loop + monitor → watcher leases (rendered as "monitors").
// Background shell tools → bg_shell leases (rendered as "shells").
// Never count both /loop prompt AND scheduler_create as two watchers.
export const isLoopPrompt = (ev) => !!ev?.loopPrompt;

export const isSchedulerCreate = (ev) => toolKey(ev) === "scheduler_create";

export const isMonitorStart = (ev) => toolKey(ev) === "monitor";

export const isBgTaskStart = (ev) => {
  if (!ev?.toolBackground) return false;
  const n = toolKey(ev);
  return (
    n === "run_terminal_command" ||
    n === "bash" ||
    n === "bashoutput" ||
    n === "bashtool"
  );
};

/** Grok spawn_subagent / Claude Task — grant a subagent lease even if SubagentStart is missing. */
export const isSubagentSpawnTool = (ev) => {
  const n = toolKey(ev);
  return (
    n === "spawn_subagent" ||
    n === "spawnsubagent" ||
    n === "task" ||
    n === "agent"
  );
};

export const isWatchEnd = (ev) => {
  const n = toolKey(ev);
  return (
    n === "scheduler_delete" ||
    n === "kill_command_or_subagent" ||
    n === "kill_command" ||
    n === "killcommandorsubagent"
  );
};

// Legacy helper: any long-lived start (tests / callers). Prefer typed helpers.
export const isWatchStart = (ev) =>
  isLoopPrompt(ev) ||
  isSchedulerCreate(ev) ||
  isMonitorStart(ev) ||
  isBgTaskStart(ev);

// How many subagents are in flight, as best we can tell. Stop and SubagentStop
// carry background_tasks (Claude) and are authoritative. Notification carries
// none. For agents without tasks in payload (e.g. Grok), we synthesize counts
// from SubagentStart/Stop pairs in stampFromHook so that Stop can still decide.
const inflightSubagents = (ev, stored) =>
  ev.hasTasks ? ev.subagents : (stored.subagents ?? ev.subagents);

// Fold one hook event into the session state.
//
// `Stop` does NOT mean "the work finished" -- it means "the main agent's turn
// ended". The agent may fire it once per user prompt even while subagents/shells
// run, and may not re-fire when a completing task wakes it. Subagent counts
// (when provided or synthesized) keep it WORKING.
//
// `stored` is the session's last known in-flight counts, for the events whose
// payload cannot say.
export const nextState = (cur, ev, stored = {}) => {
  if (!ev) return cur;
  switch (ev.event) {
    case "UserPromptSubmit":
      // Human prompt → working immediately (before first tool / while thinking).
      if (!ev.synthetic) return STATES.WORKING;
      // Synthetic resumes:
      // - loop wakeup firing is real work starting; an armed watcher alone is not
      // - active subs → still working
      // - task-complete inject → agent typically starts thinking about results
      //   (without this, curtain stays DONE until first PostToolUse)
      // - other system noise → leave state alone
      if (ev.loopPrompt) return STATES.WORKING;
      if ((stored.subagents || 0) > 0) return STATES.WORKING;
      if (ev.taskCompleteInject) return STATES.WORKING;
      return cur;
    case "SubagentStart":
    // PreToolUse: earliest "about to act" signal — marks WORKING while Grok is
    // still in the think→tool transition (before PostToolUse).
    case "PreToolUse":
    // A tool the agent ran is proof it is actively working again. Claude Code
    // fires NO event when a block clears -- no signal for "you approved the
    // tool", "compaction finished", or a background task resumed the turn --
    // so a transient NEEDS/COMPACTING (or a DONE the turn has since moved past)
    // would otherwise stick until the next Stop.
    case "PostToolUse":
      return STATES.WORKING;

    // Compaction is under way. It has no live output and can take a minute, so
    // it needs its own face -- otherwise the card sits on the previous DONE and
    // looks finished. The next event (idle_prompt when compaction ends, or the
    // resumed turn's Stop) moves it on, so it never sticks here.
    case "PreCompact":
      return STATES.COMPACTING;

    // A subagent finishing never *changes* what the session is doing -- it only
    // refreshes what is still in flight. It must not resurrect WORKING from a
    // clean DONE.
    case "SubagentStop":
      return cur;

    // Session ending: agent process is going away; force DONE (leases cleared
    // in stampFromHook). PID backstop covers lost SessionEnd events.
    case "SessionEnd":
      return STATES.DONE;

    // Subagents keep the main agent busy, so the turn is not over. Background
    // shells and watchers are informational: the agent has really finished and
    // you are free to move on -- the card may still show how many are left.
    case "Stop":
      if (inflightSubagents(ev, stored) > 0) return STATES.WORKING;
      return STATES.DONE;

    // NEEDS means exactly one thing: the agent is blocked waiting on you. Only a
    // permission/approval prompt says that (Grok's approval_required normalizes
    // to permission_prompt); a surfaced error wants a look too. EVERYTHING else a
    // Notification can carry is informational and must not hijack a working card
    // -- above all Grok's `task_complete`, fired every time a background task
    // finishes, which used to flip a working session to a false NEEDS YOU.
    case "Notification": {
      const type = ev.notificationType;
      if (type === "permission_prompt" || type === "agent_error")
        return STATES.NEEDS;
      // A turn resumed by a completing background task emits no second Stop, so
      // idle_prompt is the only end-marker it will ever send. But "the main agent
      // is idle" is also what a main agent looks like while it waits on its
      // subagents (do not call that done), and it fires behind an unanswered
      // permission prompt, which still wins.
      if (type === "idle_prompt") {
        if (cur === STATES.NEEDS) return STATES.NEEDS;
        if (inflightSubagents(ev, stored) > 0) return STATES.WORKING;
        // Watchers are informational — idle_prompt means the turn is done.
        return STATES.DONE;
      }
      // Informational (task_complete, push_notification, or anything new): leave
      // the card as it is. The real WORKING/DONE call comes from Stop and the
      // subagent counts, never from a status ping.
      return cur;
    }

    default:
      return cur;
  }
};

// The elapsed clock measures the user's wait, so only a new *human* prompt
// restarts it. Synthetic task-complete injects must not reset the clock.
export const resetsElapsed = (ev) =>
  ev?.event === "UserPromptSubmit" && !ev.synthetic;

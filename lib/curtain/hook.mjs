import { STATES } from "./state.mjs";

// Claude Code marks in-flight work "running" (its schema also allows "pending").
// Anything else has finished and must not hold a session in WORKING.
const INFLIGHT = new Set(["running", "pending"]);

// Read one Claude Code hook payload from stdin JSON. Returns null for anything
// unparseable, so a hook can never break the agent that called it.
export const parseHookPayload = (raw) => {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || Array.isArray(p) || !p.hook_event_name)
    return null;

  const tasks = Array.isArray(p.background_tasks) ? p.background_tasks : [];
  // A SubagentStop payload often still lists the subagent that is stopping as
  // "running" (68 of 295 observed). Counting it would strand the session in
  // WORKING after the last subagent reports.
  const inflight = tasks.filter(
    (t) => t && INFLIGHT.has(t.status) && t.id !== p.agent_id,
  );

  return {
    event: p.hook_event_name,
    agentId: p.agent_id || "",
    notificationType: p.notification_type || "",
    // Only Stop and SubagentStop carry background_tasks. Without this flag a
    // SubagentStart -- which never carries it -- would zero the counts while
    // the subagent it just launched is still running.
    hasTasks: Array.isArray(p.background_tasks),
    subagents: inflight.filter((t) => t.type === "subagent").length,
    shells: inflight.filter((t) => t.type === "shell").length,
  };
};

// Fold one hook event into the session state.
//
// `Stop` does NOT mean "the work finished" -- it means "the main agent's turn
// ended". Claude Code fires it once per user prompt, even while background_tasks
// still lists running subagents and shells, and never re-fires it when a
// completing task wakes the agent back up. Treating Stop as DONE is why a
// session that dispatched subagents flips to a green card mid-flight.
export const nextState = (cur, ev) => {
  if (!ev) return cur;
  switch (ev.event) {
    case "UserPromptSubmit":
    case "SubagentStart":
      return STATES.WORKING;

    // A subagent finishing never *changes* what the session is doing -- it only
    // refreshes what is still in flight. It must not resurrect WORKING from a
    // clean DONE: Claude Code fires an internal, unattributed SubagentStop
    // ~2s after almost every Stop (90 of 91 observed carry no agent_id).
    case "SubagentStop":
      return cur;

    // Subagents keep the main agent busy, so the turn is not over. Background
    // shells (a CI watch, a long build) do not: the agent has really finished
    // and you are free to move on -- the card just says how many are left.
    case "Stop":
      return ev.subagents > 0 ? STATES.WORKING : STATES.DONE;

    case "Notification":
      if (ev.notificationType === "permission_prompt") return STATES.NEEDS;
      // A turn resumed by a completing background task emits no second Stop, so
      // idle_prompt is the only end-marker it will ever send. It can also fire
      // behind an unanswered permission prompt, which must still win.
      if (ev.notificationType === "idle_prompt")
        return cur === STATES.NEEDS ? STATES.NEEDS : STATES.DONE;
      return STATES.NEEDS;

    default:
      return cur;
  }
};

// The elapsed clock measures the user's wait, so only a new prompt restarts it.
// A turn that resumes after its subagents finish keeps counting from the prompt.
export const resetsElapsed = (ev) => ev?.event === "UserPromptSubmit";

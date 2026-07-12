import { STATES } from "./state.mjs";

// Agent hosts (Claude Code, Grok Build, etc.) mark in-flight work "running"
// (schema may also allow "pending"). Anything else has finished and must not
// hold a session in WORKING.
const INFLIGHT = new Set(["running", "pending"]);

// Normalize event name from Claude (snake), Grok (camelCase or Pascal), etc.
const normalizeEventName = (name) => {
  if (!name) return "";
  const n = String(name)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (n === "userpromptsubmit" || n === "promptsubmit")
    return "UserPromptSubmit";
  if (n === "subagentstart") return "SubagentStart";
  if (n === "subagentstop" || n === "subagentend") return "SubagentStop";
  if (n === "stop" || n === "agentstop" || n === "stopfailure") return "Stop";
  if (n === "notification") return "Notification";
  if (n === "sessionstart") return "SessionStart";
  if (n === "sessionend") return "SessionEnd";
  if (n === "precompact" || n === "compact") return "PreCompact";
  if (n === "posttooluse" || n === "toolresult") return "PostToolUse";
  return String(name);
};

// Normalize notification types across agents. Grok uses "approval_required"
// for attention-needed; Claude uses "permission_prompt".
const normalizeNotificationType = (t) => {
  if (!t) return "";
  const n = String(t)
    .toLowerCase()
    .replace(/[^a-z_]/g, "");
  if (
    n === "approval_required" ||
    n === "approvalrequired" ||
    n === "permissionprompt"
  ) {
    return "permission_prompt";
  }
  if (n === "idle_prompt" || n === "idleprompt" || n === "idle") {
    return "idle_prompt";
  }
  // Grok fires task_complete when a background task finishes (~470/day on
  // executor sessions); push_notification is a push the agent SENT. Both are
  // informational -- normalized so nextState can tell them from a real block.
  if (n === "task_complete" || n === "taskcomplete") return "task_complete";
  if (n === "push_notification" || n === "pushnotification" || n === "push")
    return "push_notification";
  if (n === "agent_error" || n === "agenterror") return "agent_error";
  return t;
};

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

  const rawEvent =
    p.hook_event_name ||
    p.hookEventName ||
    p.event ||
    process.env.GROK_HOOK_EVENT ||
    "";
  const event = normalizeEventName(rawEvent);
  if (!event) return null;

  const tasks = Array.isArray(p.background_tasks)
    ? p.background_tasks
    : Array.isArray(p.backgroundTasks)
      ? p.backgroundTasks
      : [];
  // A SubagentStop payload often still lists the subagent that is stopping as
  // "running". Counting it would strand the session in WORKING after the last
  // subagent reports.
  const agentId = p.agent_id || p.agentId || "";
  const inflight = tasks.filter(
    (t) => t && INFLIGHT.has(t.status) && t.id !== agentId,
  );

  return {
    event,
    agentId,
    notificationType: normalizeNotificationType(
      p.notification_type || p.notificationType || "",
    ),
    // Only Stop and SubagentStop may carry background_tasks (Claude). Grok and
    // some events never do. We synthesize counts for Subagent* when absent.
    hasTasks:
      Array.isArray(p.background_tasks) || Array.isArray(p.backgroundTasks),
    subagents: inflight.filter((t) => t.type === "subagent").length,
    shells: inflight.filter((t) => t.type === "shell").length,
    // The running subagent ids, so the session can keep an authoritative SET of
    // what is in flight rather than an integer counter. A count loses an update
    // when two SubagentStarts race; a set is idempotent, and every task-bearing
    // event replaces it wholesale -- so a dropped Stop/Start self-heals here.
    subagentIds: inflight
      .filter((t) => t.type === "subagent")
      .map((t) => t.id)
      .filter(Boolean),
  };
};

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
    case "SubagentStart":
    // A tool the agent ran is proof it is actively working again. Claude Code
    // fires NO event when a block clears -- no signal for "you approved the
    // tool", "compaction finished", or "a background task resumed the turn" --
    // so a transient NEEDS/COMPACTING (or a DONE the turn has since moved past)
    // would otherwise stick until the next Stop. PostToolUse is the reliable
    // "active again" marker that clears it.
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

    // Subagents keep the main agent busy, so the turn is not over. Background
    // shells (a CI watch, a long build) do not: the agent has really finished
    // and you are free to move on -- the card just says how many are left.
    case "Stop":
      return inflightSubagents(ev, stored) > 0 ? STATES.WORKING : STATES.DONE;

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
        return inflightSubagents(ev, stored) > 0 ? STATES.WORKING : STATES.DONE;
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

// The elapsed clock measures the user's wait, so only a new prompt restarts it.
// A turn that resumes after its subagents finish keeps counting from the prompt.
export const resetsElapsed = (ev) => ev?.event === "UserPromptSubmit";

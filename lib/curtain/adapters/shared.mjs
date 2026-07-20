// Shared normalization helpers for per-CLI adapters.
// Moved from hook.mjs — keep comments and behavioral parity.

/**
 * @typedef {object} CanonicalEvent
 * @property {string} event
 * @property {string} notificationType
 * @property {boolean} synthetic
 * @property {boolean} taskCompleteInject
 * @property {boolean} hasTasks
 * @property {string[]} inflightIds
 * @property {string[]} subagentIds
 * @property {string[]} shellIds
 * @property {string[]} monitorIds
 * @property {string} agentId
 * @property {number} pid
 * @property {"claude"|"grok"|"unknown"} sourceCli
 * @property {string} toolName
 * @property {boolean} toolBackground
 * @property {string} toolTaskId
 * @property {string} prompt
 * @property {boolean} loopPrompt
 * @property {number} subagents
 * @property {number} shells
 * @property {number} monitors
 */

/** Task types Claude (and hybrid hosts) put in background_tasks[]. */
export const TASK_TYPE_SHELL = "shell";
export const TASK_TYPE_SUBAGENT = "subagent";
export const TASK_TYPE_MONITOR = "monitor";
// Named long-running workflows observed in live hook payloads — count as monitors.
export const TASK_TYPE_WORKFLOW = "workflow";

/**
 * Extract the background task id returned by a tool response.
 * Claude Monitor PostToolUse: { taskId }
 * Claude Bash run_in_background: { backgroundTaskId }
 */
export const extractToolTaskId = (toolResponse) => {
  if (!toolResponse || typeof toolResponse !== "object") return "";
  const id =
    toolResponse.taskId ||
    toolResponse.task_id ||
    toolResponse.backgroundTaskId ||
    toolResponse.background_task_id ||
    "";
  return id ? String(id) : "";
};

// Normalize event name from Claude (snake), Grok (camelCase or Pascal), etc.
export const normalizeEventName = (name) => {
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
  // Tool about to run — earliest reliable "working again" for Grok/Claude when
  // thinking has no dedicated hook until the first tool.
  if (n === "pretooluse" || n === "beforetooluse") return "PreToolUse";
  // Cursor aliases Grok also accepts; map thought/response to active work.
  if (n === "afteragentthought" || n === "agentthought") return "PostToolUse";
  if (n === "afteragentresponse" || n === "agentresponse") return "PostToolUse";
  return String(name);
};

// Normalize notification types across agents. Grok uses "approval_required"
// for attention-needed; Claude uses "permission_prompt".
export const normalizeNotificationType = (t) => {
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

// Grok (and some Claude child injectors) fire UserPromptSubmit for automated
// "background task completed" resumes. Those must not re-assert WORKING after a
// clean Stop — live fleets otherwise flip DONE → WORKING forever.
export const isSyntheticUserPrompt = (p) => {
  if (!p || typeof p !== "object") return false;
  const id = String(p.prompt_id || p.promptId || "");
  const prompt = String(p.prompt || "");
  if (/^task-completed[-_]?/i.test(id)) return true;
  const head = prompt.trimStart().slice(0, 80).toLowerCase();
  if (head.startsWith("<system-reminder>")) return true;
  if (head.startsWith("<task-notification>")) return true;
  if (/background task .+ completed/i.test(prompt.slice(0, 200))) return true;
  return false;
};

/** @returns {CanonicalEvent} */
export const emptyCanonical = (sourceCli = "unknown") => ({
  event: "",
  notificationType: "",
  synthetic: false,
  taskCompleteInject: false,
  hasTasks: false,
  inflightIds: [],
  subagentIds: [],
  shellIds: [],
  monitorIds: [],
  agentId: "",
  pid: 0,
  sourceCli,
  toolName: "",
  toolBackground: false,
  toolTaskId: "",
  prompt: "",
  loopPrompt: false,
  subagents: 0,
  shells: 0,
  monitors: 0,
});

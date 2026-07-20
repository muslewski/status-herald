// Claude Code payload → CanonicalEvent.
// Snake_case fields, background_tasks[] authoritative task list.

import {
  TASK_TYPE_MONITOR,
  TASK_TYPE_SHELL,
  TASK_TYPE_SUBAGENT,
  TASK_TYPE_WORKFLOW,
  emptyCanonical,
  extractToolTaskId,
  isSyntheticUserPrompt,
  normalizeEventName,
  normalizeNotificationType,
} from "./shared.mjs";

const INFLIGHT = new Set(["running", "pending"]);

/** Explicit monitor-class types (when Claude tags them). Shell-typed monitors
 * are still the common case — those are split later via Monitor taskId leases. */
const isMonitorType = (type) =>
  type === TASK_TYPE_MONITOR || type === TASK_TYPE_WORKFLOW;

/**
 * @param {object} p
 * @returns {import("./shared.mjs").CanonicalEvent}
 */
export const normalize = (p) => {
  const rawEvent = p.hook_event_name || p.event || "";
  const event = normalizeEventName(rawEvent);
  if (!event) return emptyCanonical("claude");

  const agentId = p.agent_id || p.agentId || "";
  const tasks = Array.isArray(p.background_tasks) ? p.background_tasks : [];
  // A SubagentStop payload often still lists the subagent that is stopping as
  // "running". Counting it would strand the session in WORKING after the last
  // subagent reports.
  const inflight = tasks.filter(
    (t) => t && INFLIGHT.has(t.status) && t.id !== agentId,
  );
  const hasTasks = Array.isArray(p.background_tasks);
  const inflightIds = inflight.map((t) => t.id).filter(Boolean);
  const subagentIds = inflight
    .filter((t) => t.type === TASK_TYPE_SUBAGENT)
    .map((t) => t.id)
    .filter(Boolean);
  // Pure shells only — type:monitor / type:workflow are not shells.
  // Note: Claude often still types Monitor-spawned tasks as type:"shell";
  // those are reclassified via Monitor PostToolUse toolTaskId leases.
  const shellIds = inflight
    .filter((t) => t.type === TASK_TYPE_SHELL && !isMonitorType(t.type))
    .map((t) => t.id)
    .filter(Boolean);
  const monitorIds = inflight
    .filter((t) => isMonitorType(t.type))
    .map((t) => t.id)
    .filter(Boolean);

  const synthetic =
    event === "UserPromptSubmit" ? isSyntheticUserPrompt(p) : false;
  const promptId = String(p.prompt_id || p.promptId || "");
  const prompt = String(p.prompt || "");
  const taskCompleteInject =
    event === "UserPromptSubmit" &&
    (/^task-completed[-_]?/i.test(promptId) ||
      /background task .+ completed/i.test(prompt.slice(0, 240)));

  const toolName = p.tool_name || p.toolName || "";
  const toolInput = p.tool_input || p.toolInput || {};
  const toolResponse = p.tool_response || p.toolResponse || p.tool_result || {};
  const toolBackground =
    toolInput.background === true ||
    toolInput.background === "true" ||
    toolInput.run_in_background === true ||
    toolInput.run_in_background === "true";
  const toolTaskId = extractToolTaskId(toolResponse);

  return {
    event,
    notificationType: normalizeNotificationType(
      p.notification_type || p.notificationType || "",
    ),
    synthetic,
    taskCompleteInject,
    hasTasks,
    inflightIds,
    subagentIds,
    shellIds,
    monitorIds,
    agentId: String(agentId),
    pid: Number(p.pid) || 0,
    sourceCli: "claude",
    toolName: String(toolName),
    toolBackground: !!toolBackground,
    toolTaskId,
    prompt,
    loopPrompt:
      event === "UserPromptSubmit" &&
      !synthetic &&
      /^\/loop\b/i.test(prompt.trim()),
    subagents: subagentIds.length,
    shells: shellIds.length,
    monitors: monitorIds.length,
  };
};
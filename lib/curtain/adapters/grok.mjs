// Grok Build payload → CanonicalEvent.
// camelCase / PascalCase names, Cursor aliases, no authoritative task list.

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

const isMonitorType = (type) =>
  type === TASK_TYPE_MONITOR || type === TASK_TYPE_WORKFLOW;

/**
 * @param {object} p
 * @returns {import("./shared.mjs").CanonicalEvent}
 */
export const normalize = (p) => {
  const rawEvent =
    p.hookEventName ||
    p.hook_event_name ||
    p.event ||
    process.env.GROK_HOOK_EVENT ||
    "";
  const event = normalizeEventName(rawEvent);
  if (!event) return emptyCanonical("grok");

  const agentId = p.agentId || p.agent_id || "";
  // Grok rarely carries backgroundTasks; accept if present for hybrid hosts.
  const tasks = Array.isArray(p.backgroundTasks)
    ? p.backgroundTasks
    : Array.isArray(p.background_tasks)
      ? p.background_tasks
      : [];
  const hasTasks =
    Array.isArray(p.backgroundTasks) || Array.isArray(p.background_tasks);
  const inflight = tasks.filter(
    (t) => t && INFLIGHT.has(t.status) && t.id !== agentId,
  );
  const inflightIds = inflight.map((t) => t.id).filter(Boolean);
  const subagentIds = inflight
    .filter((t) => !t.type || t.type === TASK_TYPE_SUBAGENT)
    .map((t) => t.id)
    .filter(Boolean);
  const shellIds = inflight
    .filter((t) => t.type === TASK_TYPE_SHELL)
    .map((t) => t.id)
    .filter(Boolean);
  const monitorIds = inflight
    .filter((t) => isMonitorType(t.type))
    .map((t) => t.id)
    .filter(Boolean);

  const synthetic =
    event === "UserPromptSubmit" ? isSyntheticUserPrompt(p) : false;
  const promptId = String(p.promptId || p.prompt_id || "");
  const prompt = String(p.prompt || "");
  // Grok injects these when a bg task finishes and the main agent resumes
  // thinking — that IS work; staying DONE until the first tool is the "stale
  // DONE while thinking" bug on sage/fleet sessions.
  const taskCompleteInject =
    event === "UserPromptSubmit" &&
    (/^task-completed[-_]?/i.test(promptId) ||
      /background task .+ completed/i.test(prompt.slice(0, 240)));

  const toolName = p.toolName || p.tool_name || "";
  const toolInput = p.toolInput || p.tool_input || {};
  const toolResponse = p.toolResult || p.tool_response || p.toolResponse || {};
  const toolBackground =
    toolInput.background === true ||
    toolInput.background === "true" ||
    toolInput.run_in_background === true ||
    toolInput.run_in_background === "true";
  const toolTaskId = extractToolTaskId(toolResponse);

  return {
    event,
    notificationType: normalizeNotificationType(
      p.notificationType || p.notification_type || "",
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
    sourceCli: "grok",
    toolName: String(toolName),
    toolBackground: !!toolBackground,
    toolTaskId,
    prompt,
    loopPrompt:
      event === "UserPromptSubmit" &&
      !synthetic &&
      /^\/loop\b/i.test(prompt.trim()),
    subagents: hasTasks ? subagentIds.length : 0,
    shells: hasTasks ? shellIds.length : 0,
    monitors: hasTasks ? monitorIds.length : 0,
  };
};

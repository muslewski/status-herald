// Claude Code payload → CanonicalEvent.
// Snake_case fields, background_tasks[] authoritative task list.

import {
  emptyCanonical,
  isSyntheticUserPrompt,
  normalizeEventName,
  normalizeNotificationType,
} from "./shared.mjs";

const INFLIGHT = new Set(["running", "pending"]);

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
    .filter((t) => t.type === "subagent")
    .map((t) => t.id)
    .filter(Boolean);
  const shells = inflight.filter((t) => t.type === "shell").length;
  const shellIds = inflight
    .filter((t) => t.type === "shell")
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
  const toolBackground =
    toolInput.background === true || toolInput.background === "true";

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
    agentId: String(agentId),
    pid: Number(p.pid) || 0,
    sourceCli: "claude",
    toolName: String(toolName),
    toolBackground: !!toolBackground,
    prompt,
    loopPrompt:
      event === "UserPromptSubmit" &&
      !synthetic &&
      /^\/loop\b/i.test(prompt.trim()),
    subagents: subagentIds.length,
    shells,
  };
};

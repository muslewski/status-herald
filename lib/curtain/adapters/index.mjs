// Per-CLI payload adapters → CanonicalEvent.
// Adding a new CLI later = one new adapter file + one line in this dispatch.

import { normalize as normalizeClaude } from "./claude.mjs";
import { normalize as normalizeGrok } from "./grok.mjs";
import {
  emptyCanonical,
  isSyntheticUserPrompt,
  normalizeEventName,
  normalizeNotificationType,
} from "./shared.mjs";

export {
  isSyntheticUserPrompt,
  normalizeEventName,
  normalizeNotificationType,
} from "./shared.mjs";

/**
 * @param {object} raw
 * @returns {"claude"|"grok"|"unknown"}
 */
export const detectSourceCli = (raw) => {
  if (!raw || typeof raw !== "object") return "unknown";
  // Grok markers: camel/Pascal event names, GROK_* env hint, camelCase fields.
  if (
    raw.hookEventName != null ||
    raw.notificationType != null ||
    raw.backgroundTasks != null ||
    raw.promptId != null ||
    raw.toolName != null ||
    raw.agentId != null ||
    process.env.GROK_HOOK_EVENT
  ) {
    // Prefer claude if both snake task list and snake event are clearly Claude.
    if (
      Array.isArray(raw.background_tasks) &&
      raw.hook_event_name != null &&
      raw.hookEventName == null
    ) {
      return "claude";
    }
    // Pure snake_case Claude without grok fields:
    if (
      raw.hookEventName == null &&
      raw.notificationType == null &&
      raw.backgroundTasks == null &&
      raw.promptId == null &&
      (Array.isArray(raw.background_tasks) || raw.hook_event_name != null)
    ) {
      return "claude";
    }
    return "grok";
  }
  // Claude: background_tasks array or snake_case fields.
  if (
    Array.isArray(raw.background_tasks) ||
    raw.hook_event_name != null ||
    raw.notification_type != null ||
    raw.agent_id != null ||
    raw.tool_name != null
  ) {
    return "claude";
  }
  return "unknown";
};

/**
 * @param {object} raw
 * @returns {import("./shared.mjs").CanonicalEvent}
 */
export const normalizePayload = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyCanonical("unknown");
  }
  const source = detectSourceCli(raw);
  if (source === "claude") return normalizeClaude(raw);
  if (source === "grok") return normalizeGrok(raw);

  // unknown: synthesis-safe defaults; still normalize event name best-effort.
  const rawEvent = raw.event || raw.hook_event_name || raw.hookEventName || "";
  const event = normalizeEventName(rawEvent);
  if (!event) return emptyCanonical("unknown");
  const synthetic =
    event === "UserPromptSubmit" ? isSyntheticUserPrompt(raw) : false;
  return {
    ...emptyCanonical("unknown"),
    event,
    notificationType: normalizeNotificationType(
      raw.notification_type || raw.notificationType || "",
    ),
    synthetic,
    hasTasks: false,
    agentId: String(raw.agent_id || raw.agentId || ""),
    pid: Number(raw.pid) || 0,
    toolName: String(raw.tool_name || raw.toolName || ""),
    prompt: String(raw.prompt || ""),
  };
};

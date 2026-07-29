import type {
  AgentSessionInfo,
  SubagentActivity,
  SubagentStatus,
} from "../../../../shared/contracts";
import { isMcpToolName, MCP_TOOL_PREFIX } from "../../../../shared/tools";

/** ModusBot / board: actively executing (not waiting on the user). */
export function isSubagentSessionLive(status: AgentSessionInfo["status"]): boolean {
  return status === "starting" || status === "running";
}

/** Composer "N working" rail: in-flight including blocked (needs input). */
export function isSubagentSessionWorking(status: AgentSessionInfo["status"]): boolean {
  return isSubagentSessionLive(status) || status === "blocked";
}

export function subagentColor(id: string): string {
  const colors = ["#e05252", "#d97b2b", "#18a058", "#168acd", "#8b5cf6", "#c026d3"];
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return colors[hash % colors.length] ?? "#863ff5";
}

/** Lower-row copy from authoritative `status` + optional live `activity`. */
export function subagentActivityLabel(
  status: SubagentStatus,
  activity: SubagentActivity | undefined,
): string {
  if (status === "running") {
    if (!activity || activity.kind === "thinking") return "Thinking";
    if (activity.kind === "writing") return "Writing the response";
    return toolPhrase(activity.name);
  }
  if (status === "blocked") return "Waiting for approval";
  if (status === "failed") return "Subagent stopped";
  if (status === "cancelled") return "Stopped";
  return "Completed";
}

/** Present-tense phrase from the tool's own name (authoritative event field). */
function toolPhrase(name: string): string {
  switch (name) {
    case "read":
      return "Reading files";
    case "grep":
    case "find":
      return "Searching the codebase";
    case "ls":
      return "Listing files";
    case "edit":
    case "write":
      return "Editing files";
    case "bash":
      return "Running commands";
    default:
      break;
  }
  let rest = name;
  if (isMcpToolName(name)) {
    const after = name.slice(MCP_TOOL_PREFIX.length);
    const sep = after.indexOf("_");
    rest = sep > 0 ? after.slice(sep + 1) : after;
  }
  const words = rest.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return "Working";
  const [verb, ...others] = words;
  const lower = (verb ?? "").toLowerCase();
  const head =
    lower.endsWith("e") && lower.length > 2
      ? `${lower.charAt(0).toUpperCase()}${lower.slice(1, -1)}ing`
      : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}ing`;
  return [head, ...others].join(" ");
}

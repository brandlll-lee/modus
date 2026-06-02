import { randomUUID } from "node:crypto";
import type { ExtensionFactory, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { AgentEvent, PermissionAction } from "../../shared/contracts";
import { recordPermissionDecision } from "../permissions/permission-store";

type PermissionEmitter = (event: AgentEvent) => void;

function getTarget(event: ToolCallEvent): string {
  if ("command" in event.input && typeof event.input.command === "string") {
    return event.input.command;
  }
  if ("path" in event.input && typeof event.input.path === "string") {
    return event.input.path;
  }
  return JSON.stringify(event.input);
}

function actionForTool(toolName: string): PermissionAction {
  if (toolName === "bash") {
    return "shell.execute";
  }
  if (toolName === "write" || toolName === "edit") {
    return "file.write";
  }
  return "mcp.call";
}

function isDangerous(event: ToolCallEvent): boolean {
  const target = getTarget(event).toLowerCase();
  if (event.toolName === "bash") {
    return /\brm\s+-rf\b|\bgit\s+push\b|\bgit\s+commit\b|\bnpm\s+(i|install)\b|\bpnpm\s+(i|install)\b/.test(
      target,
    );
  }
  if (event.toolName === "write" || event.toolName === "edit") {
    return /\.env\b|id_rsa|\.pem\b|credentials/i.test(target);
  }
  return false;
}

export function createModusPermissionExtension(
  sessionId: string,
  emit: PermissionEmitter,
): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      if (!isDangerous(event)) {
        return undefined;
      }

      const action = actionForTool(event.toolName);
      const target = getTarget(event);
      const request = {
        id: randomUUID(),
        action,
        target,
        reason: `Blocked dangerous ${event.toolName} tool call before execution.`,
      };

      recordPermissionDecision(action, target, "deny");
      emit({ type: "permission.requested", sessionId, request });
      return { block: true, reason: request.reason };
    });
  };
}

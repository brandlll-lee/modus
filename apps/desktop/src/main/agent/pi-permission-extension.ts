import type { ExtensionFactory, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { AgentEvent, PermissionAction } from "../../shared/contracts";
import { requestPermission } from "../permissions/permission-broker";
import { findWorkspaceAllowDecision } from "../permissions/permission-store";
import { getActiveAgentRun, updateAgentRunStatus } from "./agent-run-store";

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

function isGitWriteCommand(command: string): boolean {
  return /\bgit\s+(commit|push|reset|clean|checkout\s+--|restore\b|branch\s+-D|worktree\s+remove|stash\s+(drop|clear))\b/i.test(
    command,
  );
}

function isMutatingShellCommand(command: string): boolean {
  return /\b(rm|mv|touch|chmod|chown)\b|(^|\s)(>|>>|<<)\s*|\b(npm|pnpm|yarn)\s+(i|install|add)\b/i.test(
    command,
  );
}

function actionForTool(event: ToolCallEvent): PermissionAction {
  if (event.toolName === "bash") {
    return isGitWriteCommand(getTarget(event)) ? "git.write" : "shell.execute";
  }
  if (event.toolName === "write" || event.toolName === "edit") {
    return "file.write";
  }
  if (/delete|remove/i.test(event.toolName)) {
    return "file.delete";
  }
  return "mcp.call";
}

function isDangerous(event: ToolCallEvent): boolean {
  const target = getTarget(event);
  if (event.toolName === "bash") {
    return isGitWriteCommand(target) || isMutatingShellCommand(target);
  }
  if (
    event.toolName === "write" ||
    event.toolName === "edit" ||
    /delete|remove/i.test(event.toolName)
  ) {
    return true;
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

      const action = actionForTool(event);
      const target = getTarget(event);
      if (findWorkspaceAllowDecision(action, target)) {
        return undefined;
      }

      const run = getActiveAgentRun(sessionId);
      const permissionInput: Parameters<typeof requestPermission>[0] = {
        sessionId,
        action,
        target,
        reason: `Blocked dangerous ${event.toolName} tool call before execution.`,
        emit,
      };
      if (run?.id !== undefined) permissionInput.runId = run.id;
      const decision = await requestPermission(permissionInput);

      if (decision.decision === "deny") {
        const blockedRun = run
          ? updateAgentRunStatus(run.id, "blocked", decision.target)
          : undefined;
        if (blockedRun) {
          emit({
            type: "run.blocked",
            sessionId,
            runId: blockedRun.id,
            requestId: decision.requestId,
            reason: decision.target,
          });
        }
        return { block: true, reason: `Denied by user: ${target}` };
      }

      return undefined;
    });
  };
}

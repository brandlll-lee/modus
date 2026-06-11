import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../../shared/contracts";
import { requestPermission } from "../permissions/permission-broker";
import { findWorkspaceAllowDecision } from "../permissions/permission-store";
import { getActiveAgentRun, updateAgentRunStatus } from "./agent-run-store";
import { getToolTarget, toolRegistry } from "./tools/registry";

type PermissionEmitter = (event: AgentEvent) => void;

export function createModusPermissionExtension(
  sessionId: string,
  emit: PermissionEmitter,
): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      const { action, dangerous } = toolRegistry.classify(event);
      if (!dangerous) {
        return undefined;
      }

      const target = getToolTarget(event);
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

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { shouldPrompt } from "../../shared/approval";
import type { AgentEvent } from "../../shared/contracts";
import { requestPermission } from "../permissions/permission-broker";
import { findWorkspaceAllowDecision, getApprovalMode } from "../permissions/permission-store";
import { getActiveAgentRun } from "./agent-run-store";
import { getToolTarget, toolRegistry } from "./tools/registry";

type PermissionEmitter = (event: AgentEvent) => void;

export function createModusPermissionExtension(
  sessionId: string,
  emit: PermissionEmitter,
  cwd?: string,
): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      const { action, dangerous } = toolRegistry.classify(event);
      // Resolved approval mode (project override → global → default) decides
      // whether a dangerous call pauses for the user.
      if (!shouldPrompt(getApprovalMode(cwd), action, dangerous)) {
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
        // Denying ONE tool call does not stop the run: PI feeds the refusal
        // back to the model, which carries on (acknowledges, tries another
        // way, or wraps up) and the run completes normally. The old code
        // flipped the run to "blocked" here, which the completion path didn't
        // recognise — no run.completed ever fired and the UI spun forever.
        // The denial itself is already visible via permission.resolved and the
        // failed tool card.
        return { block: true, reason: `Denied by user: ${target}` };
      }

      return undefined;
    });
  };
}

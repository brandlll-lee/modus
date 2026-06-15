import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  PermissionAction,
  PermissionDecision,
  PermissionRequest,
} from "../../shared/contracts";
import { PendingRequestRegistry } from "../interaction/pending-requests";
import { recordPermissionDecision } from "./permission-store";

type PermissionResult = PermissionDecision & { requestId: string };
type PermissionContext = { request: PermissionRequest; emit(event: AgentEvent): void };

/** All blocking permission prompts share the generic interactive-request registry. */
const registry = new PendingRequestRegistry<PermissionResult, PermissionContext>();

function resolvedResult(
  context: PermissionContext,
  decision: PermissionDecision["decision"],
  targetSuffix = "",
): PermissionResult {
  const result = {
    ...recordPermissionDecision(
      context.request.action,
      `${context.request.target}${targetSuffix}`,
      decision,
    ),
    requestId: context.request.id,
  };
  if (context.request.sessionId) {
    context.emit({
      type: "permission.resolved",
      sessionId: context.request.sessionId,
      requestId: context.request.id,
      decision,
    });
  }
  return result;
}

export async function requestPermission(input: {
  sessionId: string;
  runId?: string;
  action: PermissionAction;
  target: string;
  reason: string;
  emit(event: AgentEvent): void;
}): Promise<PermissionResult> {
  const request: PermissionRequest = {
    id: randomUUID(),
    sessionId: input.sessionId,
    action: input.action,
    target: input.target,
    reason: input.reason,
    severity: "danger",
  };
  if (input.runId !== undefined) request.runId = input.runId;

  input.emit({ type: "permission.requested", sessionId: input.sessionId, request });

  return await registry.open({
    id: request.id,
    sessionId: input.sessionId,
    context: { request, emit: input.emit },
    timeoutMs: 120_000,
    onTimeout: (context) => resolvedResult(context, "deny"),
  });
}

export function resolvePermissionRequest(
  requestId: string,
  decision: PermissionDecision["decision"],
): PermissionResult | undefined {
  return registry.settle(requestId, (context) => resolvedResult(context, decision));
}

export function denyPendingPermissionRequests(reason = "Window closed"): void {
  registry.cancelAll((context) => resolvedResult(context, "deny", ` (${reason})`));
}

export function denyPendingPermissionRequestsForSession(sessionId: string, reason: string): void {
  registry.cancelForSession(sessionId, (context) =>
    resolvedResult(context, "deny", ` (${reason})`),
  );
}

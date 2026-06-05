import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  PermissionAction,
  PermissionDecision,
  PermissionRequest,
} from "../../shared/contracts";
import { recordPermissionDecision } from "./permission-store";

type PendingPermission = {
  request: PermissionRequest;
  emit(event: AgentEvent): void;
  resolve(decision: PermissionDecision & { requestId: string }): void;
  timeout: NodeJS.Timeout;
};

const pending = new Map<string, PendingPermission>();

export async function requestPermission(input: {
  sessionId: string;
  runId?: string;
  action: PermissionAction;
  target: string;
  reason: string;
  emit(event: AgentEvent): void;
}): Promise<PermissionDecision & { requestId: string }> {
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

  return await new Promise<PermissionDecision & { requestId: string }>((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(request.id);
      const result = {
        ...recordPermissionDecision(request.action, request.target, "deny"),
        requestId: request.id,
      };
      input.emit({
        type: "permission.resolved",
        sessionId: input.sessionId,
        requestId: request.id,
        decision: "deny",
      });
      resolve(result);
    }, 120_000);

    pending.set(request.id, { request, emit: input.emit, resolve, timeout });
  });
}

export function resolvePermissionRequest(
  requestId: string,
  decision: PermissionDecision["decision"],
): (PermissionDecision & { requestId: string }) | undefined {
  const entry = pending.get(requestId);
  if (!entry) {
    return undefined;
  }

  clearTimeout(entry.timeout);
  pending.delete(requestId);
  const result = {
    ...recordPermissionDecision(entry.request.action, entry.request.target, decision),
    requestId,
  };
  if (entry.request.sessionId) {
    entry.emit({
      type: "permission.resolved",
      sessionId: entry.request.sessionId,
      requestId,
      decision,
    });
  }
  entry.resolve(result);
  return result;
}

export function denyPendingPermissionRequests(reason = "Window closed"): void {
  for (const [requestId, entry] of pending) {
    clearTimeout(entry.timeout);
    pending.delete(requestId);
    const result = {
      ...recordPermissionDecision(
        entry.request.action,
        `${entry.request.target} (${reason})`,
        "deny",
      ),
      requestId,
    };
    if (entry.request.sessionId) {
      entry.emit({
        type: "permission.resolved",
        sessionId: entry.request.sessionId,
        requestId,
        decision: "deny",
      });
    }
    entry.resolve(result);
  }
}

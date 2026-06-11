import type { AgentEvent, PermissionRequest } from "../../../../shared/contracts";

export function latestPendingPermissionRequest(
  events: Array<{ event: AgentEvent }>,
): PermissionRequest | undefined {
  const pending = new Map<string, PermissionRequest>();

  for (const { event } of events) {
    if (event.type === "permission.requested") {
      pending.delete(event.request.id);
      pending.set(event.request.id, event.request);
      continue;
    }
    if (event.type === "permission.resolved") {
      pending.delete(event.requestId);
    }
  }

  return Array.from(pending.values()).at(-1);
}

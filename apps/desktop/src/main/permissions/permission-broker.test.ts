import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../shared/contracts";
import {
  denyPendingPermissionRequests,
  requestPermission,
  resolvePermissionRequest,
} from "./permission-broker";

vi.mock("./permission-store", () => ({
  recordPermissionDecision: vi.fn((action, target, decision) => ({
    id: `${action}:${decision}`,
    action,
    target,
    decision,
    createdAt: "2026-06-05T00:00:00.000Z",
  })),
}));

afterEach(() => {
  denyPendingPermissionRequests("test cleanup");
  vi.useRealTimers();
});

describe("permission-broker", () => {
  it("resolves a pending request", async () => {
    const events: AgentEvent[] = [];
    const pending = requestPermission({
      sessionId: "session-1",
      action: "shell.execute",
      target: "rm -rf tmp",
      reason: "dangerous",
      emit: (event) => events.push(event),
    });
    const requested = events.find((event) => event.type === "permission.requested");
    expect(requested?.type).toBe("permission.requested");

    if (requested?.type !== "permission.requested") throw new Error("missing request");
    resolvePermissionRequest(requested.request.id, "allow-once");

    await expect(pending).resolves.toMatchObject({ decision: "allow-once" });
    expect(
      events.some(
        (event) => event.type === "permission.resolved" && event.decision === "allow-once",
      ),
    ).toBe(true);
  });

  it("denies all pending requests on close", async () => {
    const events: AgentEvent[] = [];
    const pending = requestPermission({
      sessionId: "session-1",
      action: "git.write",
      target: "git clean -f",
      reason: "dangerous",
      emit: (event) => events.push(event),
    });

    denyPendingPermissionRequests("Window closed");

    await expect(pending).resolves.toMatchObject({ decision: "deny" });
    expect(
      events.some((event) => event.type === "permission.resolved" && event.decision === "deny"),
    ).toBe(true);
  });

  it("times out as deny", async () => {
    vi.useFakeTimers();
    const events: AgentEvent[] = [];
    const pending = requestPermission({
      sessionId: "session-1",
      action: "shell.execute",
      target: "rm -rf tmp",
      reason: "dangerous",
      emit: (event) => events.push(event),
    });

    await vi.advanceTimersByTimeAsync(120_000);

    await expect(pending).resolves.toMatchObject({ decision: "deny" });
  });
});

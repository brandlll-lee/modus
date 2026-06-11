import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { latestPendingPermissionRequest } from "./permissionRequests";

function item(event: AgentEvent) {
  return { event };
}

describe("latestPendingPermissionRequest", () => {
  it("returns the latest unresolved approval request", () => {
    const latest = latestPendingPermissionRequest([
      item({
        type: "permission.requested",
        sessionId: "s",
        request: {
          id: "first",
          action: "shell.execute",
          target: "npm test",
          reason: "Needs shell access.",
        },
      }),
      item({
        type: "permission.requested",
        sessionId: "s",
        request: {
          id: "second",
          action: "mcp.call",
          target: "tavily-remote/tavily_research",
          reason: "Needs MCP access.",
        },
      }),
    ]);

    expect(latest).toEqual(expect.objectContaining({ id: "second" }));
  });

  it("clears resolved requests", () => {
    const latest = latestPendingPermissionRequest([
      item({
        type: "permission.requested",
        sessionId: "s",
        request: {
          id: "p",
          action: "git.write",
          target: "git commit",
          reason: "Needs git access.",
        },
      }),
      item({
        type: "permission.resolved",
        sessionId: "s",
        requestId: "p",
        decision: "allow-once",
      }),
    ]);

    expect(latest).toBeUndefined();
  });
});

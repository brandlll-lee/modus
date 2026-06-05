import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { buildBlocks } from "./Timeline";

function item(id: string, event: AgentEvent) {
  return { id, event };
}

describe("buildBlocks", () => {
  it("updates run blocks through completion", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({ type: "run", runId: "r", status: "completed" }),
    ]);
  });

  it("aggregates tool output", () => {
    const blocks = buildBlocks([
      item("1", { type: "tool.started", sessionId: "s", toolCallId: "t", toolName: "bash" }),
      item("2", { type: "tool.output", sessionId: "s", toolCallId: "t", output: "hello" }),
      item("3", { type: "tool.ended", sessionId: "s", toolCallId: "t", isError: false }),
    ]);

    expect(blocks[0]).toEqual(
      expect.objectContaining({ type: "tool", output: "hello", isError: false }),
    );
  });

  it("resolves permission blocks", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "permission.requested",
        sessionId: "s",
        request: {
          id: "p",
          sessionId: "s",
          action: "git.write",
          target: "git clean -f",
          reason: "dangerous",
        },
      }),
      item("2", { type: "permission.resolved", sessionId: "s", requestId: "p", decision: "deny" }),
    ]);

    expect(blocks[0]).toEqual(expect.objectContaining({ type: "permission", decision: "deny" }));
  });
});

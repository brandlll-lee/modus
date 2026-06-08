import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { blockRenderKeys, buildBlocks, groupToolBlocks } from "./Timeline";

function item(id: string, event: AgentEvent) {
  return { id, event };
}

function tool(id: string, name: string, complete = true, isError = false) {
  return {
    id,
    type: "tool" as const,
    name,
    output: "",
    ...(complete ? { isComplete: true } : {}),
    ...(isError ? { isError: true } : {}),
  };
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

  it("shows exactly one active thinking row for a running turn", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", {
        type: "message.started",
        sessionId: "s",
        messageId: "assistant-1",
        role: "assistant",
      }),
    ]);

    expect(blocks.filter((block) => block.type === "thinking")).toHaveLength(1);
    expect(blocks.filter((block) => block.type === "message")).toHaveLength(1);
    expect(blocks.find((block) => block.type === "message")).toEqual(
      expect.objectContaining({ streaming: true }),
    );
  });

  it("removes the active thinking row after completion", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", {
        type: "message.started",
        sessionId: "s",
        messageId: "assistant-1",
        role: "assistant",
      }),
      item("3", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);

    expect(blocks.filter((block) => block.type === "thinking")).toHaveLength(0);
    expect(blocks.find((block) => block.type === "message")).not.toEqual(
      expect.objectContaining({ streaming: true }),
    );
  });

  it("folds orphan PI deltas from old logs into the active assistant message", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "message.started",
        sessionId: "s",
        messageId: "assistant-1",
        role: "assistant",
      }),
      item("2", {
        type: "thinking.delta",
        sessionId: "s",
        messageId: "orphan-thinking",
        delta: "plan",
      }),
      item("3", {
        type: "message.delta",
        sessionId: "s",
        messageId: "orphan-text",
        delta: "answer",
      }),
    ]);

    expect(blocks[0]).toEqual(
      expect.objectContaining({
        type: "message",
        thinking: "plan",
        content: "answer",
      }),
    );
  });

  it("keeps long completed assistant output when more than 240 delta events are present", () => {
    const blocks = buildBlocks([
      item("run-start", {
        type: "run.started",
        sessionId: "s",
        runId: "r",
        delivery: "normal",
      }),
      item("assistant-start", {
        type: "message.started",
        sessionId: "s",
        messageId: "assistant-1",
        role: "assistant",
      }),
      ...Array.from({ length: 260 }, (_, index) =>
        item(`delta-${index}`, {
          type: "message.delta",
          sessionId: "s",
          messageId: "assistant-1",
          delta: `${index},`,
        }),
      ),
      item("assistant-end", {
        type: "message.completed",
        sessionId: "s",
        messageId: "assistant-1",
      }),
      item("run-end", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);
    const message = blocks.find((block) => block.type === "message");

    expect(blocks.find((block) => block.type === "run")).toEqual(
      expect.objectContaining({ status: "completed" }),
    );
    expect(message).toEqual(
      expect.objectContaining({
        type: "message",
        role: "assistant",
        content: expect.stringContaining("0,"),
      }),
    );
    expect(message).toEqual(expect.objectContaining({ content: expect.stringContaining("259,") }));
  });

  it("creates a fallback assistant message when text deltas arrive without a message start", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "message.delta",
        sessionId: "s",
        messageId: "assistant-late",
        delta: "late answer",
      }),
      item("2", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        type: "message",
        id: "assistant-late",
        role: "assistant",
        content: "late answer",
      }),
      expect.objectContaining({ type: "run", runId: "r", status: "completed" }),
    ]);
  });
});

const msg = (id: string, content = "x") => ({
  id,
  type: "message" as const,
  role: "assistant" as const,
  content,
  thinking: "",
});
const runningRun = (id: string) => ({
  id,
  type: "run" as const,
  runId: id,
  status: "running" as const,
  startedAt: 0,
});
const thinking = (id: string) => ({ id, type: "thinking" as const, runId: id });

type Blocks = Parameters<typeof groupToolBlocks>[0];

describe("groupToolBlocks", () => {
  it("collapses ≥2 adjacent same-name tools once sealed by a following block", () => {
    const result = groupToolBlocks([
      tool("1", "read"),
      tool("2", "read"),
      tool("3", "read"),
      msg("m"),
    ] as Blocks);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({ type: "tool-group", name: "read", id: "tool-group:1" }),
    );
    expect(result[0]).toHaveProperty("tools");
    expect((result[0] as { tools: unknown[] }).tools).toHaveLength(3);
    expect(result[1]).toEqual(expect.objectContaining({ type: "message" }));
  });

  it("labels bash groups distinctly and keeps a single tool ungrouped", () => {
    const grouped = groupToolBlocks([tool("1", "bash"), tool("2", "bash"), msg("m")] as Blocks);
    expect(grouped[0]).toEqual(expect.objectContaining({ type: "tool-group", name: "bash" }));

    const single = groupToolBlocks([tool("1", "read"), msg("m")] as Blocks);
    expect(single[0]).toEqual(expect.objectContaining({ type: "tool", name: "read" }));
  });

  it("stays expanded (ungrouped) at the live tail of an active run", () => {
    const result = groupToolBlocks([
      runningRun("r"),
      tool("1", "read"),
      tool("2", "read"),
      thinking("r"),
    ] as Blocks);

    expect(result.filter((block) => block.type === "tool")).toHaveLength(2);
    expect(result.some((block) => block.type === "tool-group")).toBe(false);
  });

  it("seals when a real block follows even during an active run", () => {
    const result = groupToolBlocks([
      runningRun("r"),
      tool("1", "read"),
      tool("2", "read"),
      msg("m"),
      thinking("r"),
    ] as Blocks);

    expect(result.some((block) => block.type === "tool-group")).toBe(true);
  });

  it("collapses at run end even without a following block", () => {
    const result = groupToolBlocks([tool("1", "read"), tool("2", "read")] as Blocks);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ type: "tool-group", name: "read" }));
  });

  it("does not collapse an incomplete run", () => {
    const result = groupToolBlocks([
      tool("1", "read"),
      tool("2", "read", false),
      msg("m"),
    ] as Blocks);
    expect(result.some((block) => block.type === "tool-group")).toBe(false);
  });

  it("does not merge across different tool names", () => {
    const result = groupToolBlocks([
      tool("1", "read"),
      tool("2", "bash"),
      tool("3", "read"),
      msg("m"),
    ] as Blocks);
    expect(result.some((block) => block.type === "tool-group")).toBe(false);
  });

  it("produces separate groups when broken by another block", () => {
    const result = groupToolBlocks([
      tool("1", "read"),
      tool("2", "read"),
      msg("m"),
      tool("3", "read"),
      tool("4", "read"),
    ] as Blocks);

    const groups = result.filter((block) => block.type === "tool-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(expect.objectContaining({ id: "tool-group:1" }));
    expect(groups[1]).toEqual(expect.objectContaining({ id: "tool-group:3" }));
  });

  it("flags an error when any member errored", () => {
    const result = groupToolBlocks([
      tool("1", "bash"),
      tool("2", "bash", true, true),
      msg("m"),
    ] as Blocks);
    expect(result[0]).toEqual(expect.objectContaining({ type: "tool-group", isError: true }));
  });
});

describe("blockRenderKeys", () => {
  it("produces unique keys even when block ids collide across runs", () => {
    // A resumed session can repeat message ids (assistant:1) across runs.
    const blocks = [
      {
        id: "message:assistant:1",
        type: "message" as const,
        role: "assistant" as const,
        content: "first turn",
        thinking: "",
      },
      {
        id: "message:assistant:1",
        type: "message" as const,
        role: "assistant" as const,
        content: "second turn",
        thinking: "",
      },
      {
        id: "message:assistant:2",
        type: "message" as const,
        role: "assistant" as const,
        content: "third",
        thinking: "",
      },
    ];
    const keys = blockRenderKeys(blocks);
    expect(keys).toEqual(["message:assistant:1", "message:assistant:1#2", "message:assistant:2"]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

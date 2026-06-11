import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { blockRenderKeys, buildBlocks, buildExploreSummary, groupToolBlocks } from "./Timeline";

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

  it("keeps approval prompts out of the timeline", () => {
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

    expect(blocks).toEqual([]);
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

  it("marks the user message of a normal-delivery run as editable", () => {
    const blocks = buildBlocks([
      item("1", { type: "message.started", sessionId: "s", messageId: "u1", role: "user" }),
      item("2", { type: "message.delta", sessionId: "s", messageId: "u1", delta: "hello" }),
      item("3", { type: "message.completed", sessionId: "s", messageId: "u1" }),
      item("4", {
        type: "run.started",
        sessionId: "s",
        runId: "r",
        userMessageId: "u1",
        delivery: "normal",
      }),
    ]);

    expect(blocks.find((block) => block.type === "message")).toEqual(
      expect.objectContaining({ id: "u1", role: "user", editable: true }),
    );
  });

  it("keeps steered and queued follow-up messages non-editable", () => {
    const blocks = buildBlocks([
      item("1", { type: "message.started", sessionId: "s", messageId: "u1", role: "user" }),
      item("2", { type: "message.delta", sessionId: "s", messageId: "u1", delta: "steer it" }),
      item("3", { type: "message.completed", sessionId: "s", messageId: "u1" }),
      item("4", {
        type: "run.started",
        sessionId: "s",
        runId: "r",
        userMessageId: "u1",
        delivery: "steer",
      }),
    ]);

    expect(blocks.find((block) => block.type === "message")).toEqual(
      expect.objectContaining({ id: "u1", editable: false }),
    );
  });

  it("anchors editability on the most recent user message when run.started has no id", () => {
    const blocks = buildBlocks([
      item("1", { type: "message.started", sessionId: "s", messageId: "u1", role: "user" }),
      item("2", { type: "message.delta", sessionId: "s", messageId: "u1", delta: "legacy" }),
      item("3", { type: "message.completed", sessionId: "s", messageId: "u1" }),
      item("4", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
    ]);

    expect(blocks.find((block) => block.type === "message")).toEqual(
      expect.objectContaining({ id: "u1", editable: true }),
    );
  });

  it("appends a changes card when run.completed carries per-turn stats", () => {
    const stats = {
      files: [{ path: "src/a.ts", added: 3, removed: 1, untracked: false, binary: false }],
      added: 3,
      removed: 1,
      fileCount: 1,
      truncated: false,
    };
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", {
        type: "checkpoint.created",
        sessionId: "s",
        checkpoint: {
          id: "cp-1",
          sessionId: "s",
          runId: "r",
          userMessageId: "u1",
          cwd: "/repo",
          commitHash: "abc",
          kind: "auto",
          createdAt: "2026-06-11T00:00:00.000Z",
        },
      }),
      item("3", { type: "run.completed", sessionId: "s", runId: "r", changes: stats }),
    ]);

    expect(blocks.at(-1)).toEqual(
      expect.objectContaining({
        type: "changes",
        runId: "r",
        checkpointId: "cp-1",
        stats: expect.objectContaining({ fileCount: 1, added: 3, removed: 1 }),
      }),
    );
  });

  it("omits the changes card for turns without file changes", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);
    expect(blocks.some((block) => block.type === "changes")).toBe(false);
  });

  it("renders todo_write through a todos card instead of tool rows", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "todo-1",
        toolName: "todo_write",
      }),
      item("2", {
        type: "todos.updated",
        sessionId: "s",
        todos: [{ id: "todo-1", content: "Plan", status: "in_progress" }],
      }),
      item("3", { type: "tool.ended", sessionId: "s", toolCallId: "todo-1", isError: false }),
    ]);

    expect(blocks.some((block) => block.type === "tool")).toBe(false);
    expect(blocks).toEqual([
      expect.objectContaining({
        type: "todos",
        todos: [{ id: "todo-1", content: "Plan", status: "in_progress" }],
        updating: false,
      }),
    ]);
  });

  it("renders todo snapshots only at creation and all-completed update", () => {
    const initialTodos = [
      { id: "todo-1", content: "Plan", status: "in_progress" as const },
      { id: "todo-2", content: "Build", status: "pending" as const },
      { id: "todo-3", content: "Verify", status: "pending" as const },
    ];
    const intermediateTodos = [
      { id: "todo-1", content: "Plan", status: "completed" as const },
      { id: "todo-2", content: "Build", status: "in_progress" as const },
      { id: "todo-3", content: "Verify", status: "pending" as const },
    ];
    const completedTodos = [
      { id: "todo-1", content: "Plan", status: "completed" as const },
      { id: "todo-2", content: "Build", status: "completed" as const },
      { id: "todo-3", content: "Verify", status: "completed" as const },
    ];

    const blocks = buildBlocks([
      item("1", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "todo-1",
        toolName: "todo_write",
      }),
      item("initial-update", { type: "todos.updated", sessionId: "s", todos: initialTodos }),
      item("3", { type: "tool.ended", sessionId: "s", toolCallId: "todo-1", isError: false }),
      item("4", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "todo-2",
        toolName: "todo_write",
      }),
      item("intermediate-update", {
        type: "todos.updated",
        sessionId: "s",
        todos: intermediateTodos,
      }),
      item("6", { type: "tool.ended", sessionId: "s", toolCallId: "todo-2", isError: false }),
      item("7", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "todo-3",
        toolName: "todo_write",
      }),
      item("completed-update", { type: "todos.updated", sessionId: "s", todos: completedTodos }),
      item("9", { type: "tool.ended", sessionId: "s", toolCallId: "todo-3", isError: false }),
    ]);

    const todoBlocks = blocks.filter(
      (block): block is Extract<ReturnType<typeof buildBlocks>[number], { type: "todos" }> =>
        block.type === "todos",
    );

    expect(todoBlocks).toEqual([
      expect.objectContaining({ id: "todos:initial-update", todos: initialTodos, updating: false }),
      expect.objectContaining({
        id: "todos:completed-update",
        todos: completedTodos,
        updating: false,
      }),
    ]);
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
  it("collapses ≥2 adjacent exploration tools into a digest once sealed", () => {
    const result = groupToolBlocks([
      tool("1", "read"),
      tool("2", "read"),
      tool("3", "read"),
      msg("m"),
    ] as Blocks);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        type: "tool-group",
        summary: "Explored 3 files",
        id: "tool-group:1",
      }),
    );
    expect(result[0]).toHaveProperty("tools");
    expect((result[0] as { tools: unknown[] }).tools).toHaveLength(3);
    expect(result[1]).toEqual(expect.objectContaining({ type: "message" }));
  });

  it("folds mixed exploration runs and summarizes by category", () => {
    const result = groupToolBlocks([
      tool("1", "ls"),
      tool("2", "grep"),
      tool("3", "find"),
      tool("4", "read"),
      tool("5", "web_search"),
      msg("m"),
    ] as Blocks);

    expect(result[0]).toEqual(
      expect.objectContaining({
        type: "tool-group",
        summary: "Explored 1 file, 2 searches, 1 listing, 1 web lookup",
      }),
    );
  });

  it("never folds side-effect tools (bash stays visible)", () => {
    const grouped = groupToolBlocks([tool("1", "bash"), tool("2", "bash"), msg("m")] as Blocks);
    expect(grouped.some((block) => block.type === "tool-group")).toBe(false);

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
    const result = groupToolBlocks([tool("1", "read"), tool("2", "grep")] as Blocks);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ type: "tool-group", summary: "Explored 1 file, 1 search" }),
    );
  });

  it("does not collapse an incomplete run", () => {
    const result = groupToolBlocks([
      tool("1", "read"),
      tool("2", "read", false),
      msg("m"),
    ] as Blocks);
    expect(result.some((block) => block.type === "tool-group")).toBe(false);
  });

  it("breaks groups at side-effect tools", () => {
    const result = groupToolBlocks([
      tool("1", "read"),
      tool("2", "bash"),
      tool("3", "read"),
      msg("m"),
    ] as Blocks);
    expect(result.some((block) => block.type === "tool-group")).toBe(false);
    expect(result.filter((block) => block.type === "tool")).toHaveLength(3);
  });

  it("produces separate groups when broken by another block", () => {
    const result = groupToolBlocks([
      tool("1", "read"),
      tool("2", "read"),
      msg("m"),
      tool("3", "grep"),
      tool("4", "ls"),
    ] as Blocks);

    const groups = result.filter((block) => block.type === "tool-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(expect.objectContaining({ id: "tool-group:1" }));
    expect(groups[1]).toEqual(
      expect.objectContaining({ id: "tool-group:3", summary: "Explored 1 search, 1 listing" }),
    );
  });

  it("flags an error when any member errored", () => {
    const result = groupToolBlocks([
      tool("1", "grep"),
      tool("2", "grep", true, true),
      msg("m"),
    ] as Blocks);
    expect(result[0]).toEqual(expect.objectContaining({ type: "tool-group", isError: true }));
  });

  it("counts distinct read paths when args carry them", () => {
    expect(
      buildExploreSummary([
        { ...tool("1", "read"), args: { path: "a.ts" } },
        { ...tool("2", "read"), args: { path: "a.ts" } },
        { ...tool("3", "read"), args: { path: "b.ts" } },
      ] as Parameters<typeof buildExploreSummary>[0]),
    ).toBe("Explored 2 files");
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

import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import {
  blockRenderKeys,
  buildBlocks,
  buildBrowserSummary,
  buildExploreSummary,
  groupActivity,
} from "./Timeline";

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

  it("marks the active assistant message streaming with no thought when nothing is thought yet", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", {
        type: "message.started",
        sessionId: "s",
        messageId: "assistant-1",
        role: "assistant",
      }),
    ]);

    expect(blocks.filter((block) => block.type === "thought")).toHaveLength(0);
    expect(blocks.filter((block) => block.type === "message")).toHaveLength(1);
    expect(blocks.find((block) => block.type === "message")).toEqual(
      expect.objectContaining({ streaming: true }),
    );
  });

  it("settles the assistant message after completion (no standalone thinking row)", () => {
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

    expect(blocks.filter((block) => block.type === "thought")).toHaveLength(0);
    expect(blocks.find((block) => block.type === "message")).not.toEqual(
      expect.objectContaining({ streaming: true }),
    );
  });

  it("streams thinking as its own thought block before the answer", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", {
        type: "message.started",
        sessionId: "s",
        messageId: "assistant-1",
        role: "assistant",
      }),
      item("3", { type: "thinking.delta", sessionId: "s", messageId: "assistant-1", delta: "plan" }),
      item("4", { type: "message.delta", sessionId: "s", messageId: "assistant-1", delta: "answer" }),
      item("5", { type: "message.completed", sessionId: "s", messageId: "assistant-1" }),
      item("6", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);

    const thought = blocks.find((block) => block.type === "thought");
    const message = blocks.find((block) => block.type === "message");
    expect(thought).toEqual(expect.objectContaining({ type: "thought", text: "plan" }));
    expect(message).toEqual(expect.objectContaining({ type: "message", content: "answer" }));
    // Thought renders above its sibling answer, and stops shimmering once sealed.
    expect(blocks.indexOf(thought!)).toBeLessThan(blocks.indexOf(message!));
    expect(thought).not.toEqual(expect.objectContaining({ streaming: true }));
  });

  it("keeps the live thought shimmering while the turn is still running", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", {
        type: "message.started",
        sessionId: "s",
        messageId: "assistant-1",
        role: "assistant",
      }),
      item("3", {
        type: "thinking.delta",
        sessionId: "s",
        messageId: "assistant-1",
        delta: "thinking hard",
      }),
    ]);

    expect(blocks.find((block) => block.type === "thought")).toEqual(
      expect.objectContaining({ type: "thought", text: "thinking hard", streaming: true }),
    );
  });

  it("routes orphan thinking deltas to the active assistant message's thought", () => {
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

    expect(blocks[0]).toEqual(expect.objectContaining({ type: "thought", text: "plan" }));
    expect(blocks[1]).toEqual(expect.objectContaining({ type: "message", content: "answer" }));
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

const msg = (id: string, content = "x", role: "assistant" | "user" = "assistant") => ({
  id,
  type: "message" as const,
  role,
  content,
});
const runningRun = (id: string) => ({
  id,
  type: "run" as const,
  runId: id,
  status: "running" as const,
  startedAt: 0,
});
const thought = (id: string, text = "thinking…", streaming = false) => ({
  id: `thought:${id}`,
  type: "thought" as const,
  text,
  ...(streaming ? { streaming: true } : {}),
});

type Blocks = Parameters<typeof groupActivity>[0];

describe("groupActivity", () => {
  it("collapses adjacent exploration tools into a sealed explore group", () => {
    const result = groupActivity([
      tool("1", "read"),
      tool("2", "read"),
      tool("3", "read"),
      msg("m"),
    ] as Blocks);

    // [explore-group, final-answer message]
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        type: "activity-group",
        kind: "explore",
        active: false,
        summary: "Explored 3 files",
        id: "activity-group:1",
      }),
    );
    expect((result[0] as { items: unknown[] }).items).toHaveLength(3);
    expect(result[1]).toEqual(expect.objectContaining({ type: "message" }));
  });

  it("folds even a single exploration tool into an Exploring group", () => {
    const result = groupActivity([tool("1", "read"), msg("m")] as Blocks);
    expect(result[0]).toEqual(
      expect.objectContaining({ type: "activity-group", kind: "explore", summary: "Explored 1 file" }),
    );
  });

  it("folds mixed exploration runs and summarizes by category", () => {
    const result = groupActivity([
      tool("1", "ls"),
      tool("2", "grep"),
      tool("3", "find"),
      tool("4", "read"),
      tool("5", "web_search"),
      msg("m"),
    ] as Blocks);

    expect(result[0]).toEqual(
      expect.objectContaining({
        type: "activity-group",
        summary: "Explored 1 file, 2 searches, 1 listing, 1 web lookup",
      }),
    );
  });

  it("never folds side-effect tools (bash stays a standalone row)", () => {
    const grouped = groupActivity([tool("1", "bash"), tool("2", "bash"), msg("m")] as Blocks);
    expect(grouped.some((block) => block.type === "activity-group")).toBe(false);
    expect(grouped.filter((block) => block.type === "tool")).toHaveLength(2);
  });

  it("keeps web_fetch and terminal_read standalone (out of the fold)", () => {
    const result = groupActivity([
      tool("1", "web_fetch"),
      tool("2", "terminal_read"),
      msg("m"),
    ] as Blocks);
    expect(result.some((block) => block.type === "activity-group")).toBe(false);
    expect(result.filter((block) => block.type === "tool")).toHaveLength(2);
  });

  it("folds browser-control tools into a Browser group", () => {
    const result = groupActivity([
      tool("1", "browser_navigate"),
      tool("2", "browser_click"),
      msg("m"),
    ] as Blocks);
    expect(result[0]).toEqual(
      expect.objectContaining({
        type: "activity-group",
        kind: "browser",
        summary: "Browser used 1 page, 1 click",
      }),
    );
  });

  it("keeps the group active (expanded) at the live tail of a running turn", () => {
    const result = groupActivity([
      runningRun("r"),
      tool("1", "read"),
      tool("2", "read"),
    ] as Blocks);

    const group = result.find((block) => block.type === "activity-group");
    expect(group).toEqual(expect.objectContaining({ type: "activity-group", active: true }));
  });

  it("seals the group when a real block follows even during an active run", () => {
    const result = groupActivity([
      runningRun("r"),
      tool("1", "read"),
      tool("2", "read"),
      msg("m"),
    ] as Blocks);

    expect(result.find((block) => block.type === "activity-group")).toEqual(
      expect.objectContaining({ active: false }),
    );
  });

  it("collapses at run end even without a following block", () => {
    const result = groupActivity([tool("1", "read"), tool("2", "grep")] as Blocks);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        type: "activity-group",
        active: false,
        summary: "Explored 1 file, 1 search",
      }),
    );
  });

  it("stays active while a member is still running", () => {
    const result = groupActivity([
      runningRun("r"),
      tool("1", "read"),
      tool("2", "read", false),
    ] as Blocks);
    expect(result.find((block) => block.type === "activity-group")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  it("breaks groups at side-effect tools", () => {
    const result = groupActivity([
      tool("1", "read"),
      tool("2", "bash"),
      tool("3", "read"),
      msg("m"),
    ] as Blocks);
    const groups = result.filter((block) => block.type === "activity-group");
    expect(groups).toHaveLength(2);
    expect(result.filter((block) => block.type === "tool")).toHaveLength(1);
  });

  it("interleaves thoughts and intermediate text in the fold, final answer outside", () => {
    const result = groupActivity([
      thought("t1", "plan"),
      msg("intro", "reading now"),
      tool("1", "read"),
      msg("final", "the answer"),
    ] as Blocks);

    const group = result.find((block) => block.type === "activity-group");
    expect((group as { items: { type: string }[] }).items.map((item) => item.type)).toEqual([
      "thought",
      "message",
      "tool",
    ]);
    // The trailing assistant message is the final answer and renders outside.
    expect(result.at(-1)).toEqual(
      expect.objectContaining({ type: "message", id: "final", content: "the answer" }),
    );
  });

  it("flags an error when any member errored", () => {
    const result = groupActivity([
      tool("1", "grep"),
      tool("2", "grep", true, true),
      msg("m"),
    ] as Blocks);
    expect(result[0]).toEqual(expect.objectContaining({ type: "activity-group", isError: true }));
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

describe("buildBrowserSummary", () => {
  it("summarizes browser actions by category", () => {
    expect(
      buildBrowserSummary([
        tool("1", "browser_navigate"),
        tool("2", "browser_click"),
        tool("3", "browser_click_xy"),
        tool("4", "browser_take_screenshot"),
      ] as Parameters<typeof buildBrowserSummary>[0]),
    ).toBe("Browser used 1 page, 2 clicks, 1 capture");
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
      },
      {
        id: "message:assistant:1",
        type: "message" as const,
        role: "assistant" as const,
        content: "second turn",
      },
      {
        id: "message:assistant:2",
        type: "message" as const,
        role: "assistant" as const,
        content: "third",
      },
    ];
    const keys = blockRenderKeys(blocks);
    expect(keys).toEqual(["message:assistant:1", "message:assistant:1#2", "message:assistant:2"]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

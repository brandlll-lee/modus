import { describe, expect, it } from "vitest";
import type { AgentEvent, PlanRef } from "../../../../shared/contracts";
import { PLAN_TOOL_NAME, VISUAL_TOOL_NAME } from "../../../../shared/tools";
import { optimisticUserPromptEvents } from "./agentEventHub";
import { subagentColor } from "./subagentUi";
import {
  attachTurnActions,
  blockRenderKeys,
  buildBlocks,
  formatElapsedVerbose,
  groupTurnWork,
  segmentTurns,
  type TimelineBlock,
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
  it("renders an optimistic user prompt immediately", () => {
    const blocks = buildBlocks(
      optimisticUserPromptEvents({
        sessionId: "s",
        userMessageId: "m",
        message: "hello now",
      }),
    );

    expect(blocks).toContainEqual(
      expect.objectContaining({ type: "message", role: "user", content: "hello now" }),
    );
  });

  it("updates run blocks through completion", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({ type: "run", runId: "r", status: "completed" }),
    ]);
  });

  it("captures the active run's live phase (tool > thinking > writing, latest wins)", () => {
    const run = (events: Parameters<typeof buildBlocks>[0]) =>
      buildBlocks(events).find((block) => block.type === "run");
    const start = item("1", {
      type: "run.started",
      sessionId: "s",
      runId: "r",
      delivery: "normal",
    });

    expect(
      run([
        start,
        item("2", { type: "thinking.delta", sessionId: "s", messageId: "m", delta: "…" }),
      ]),
    ).toEqual(expect.objectContaining({ activity: { kind: "thinking" } }));

    expect(
      run([
        start,
        item("2", { type: "tool.started", sessionId: "s", toolCallId: "t", toolName: "read" }),
      ]),
    ).toEqual(expect.objectContaining({ activity: { kind: "tool", name: "read" } }));

    expect(
      run([
        start,
        item("2", { type: "message.started", sessionId: "s", messageId: "a", role: "assistant" }),
        item("3", { type: "message.delta", sessionId: "s", messageId: "a", delta: "answer" }),
      ]),
    ).toEqual(expect.objectContaining({ activity: { kind: "writing" } }));
  });

  it("never tags a settled run with a live activity", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", { type: "tool.started", sessionId: "s", toolCallId: "t", toolName: "read" }),
      item("3", { type: "tool.ended", sessionId: "s", toolCallId: "t", isError: false }),
      item("4", { type: "run.completed", sessionId: "s", runId: "r" }),
      // A late stray delta must not re-tag the already-completed run.
      item("5", { type: "message.delta", sessionId: "s", messageId: "a", delta: "x" }),
    ]);
    const run = blocks.find((block) => block.type === "run");
    expect(run).toEqual(expect.objectContaining({ status: "completed" }));
    expect((run as { activity?: unknown }).activity).toEqual({ kind: "tool", name: "read" });
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

  it("binds persisted plans to current and legacy plan tool events", () => {
    const plan: PlanRef = {
      id: "s",
      title: "Feature plan",
      overview: "Build the feature safely.",
      path: "C:/plans/feature/plan.md",
      hash: "hash",
      workspaceId: "workspace",
      sessionId: "s",
      blocks: [{ type: "markdown", content: "# Feature plan" }],
      content: "# Feature plan",
      todos: [{ id: "todo-1", content: "Implement it", status: "pending" }],
      buildStatus: "not_built",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };
    const blocks = buildBlocks([
      item("1", {
        type: "tool.delta",
        sessionId: "s",
        toolCallId: "plan-call",
        toolName: PLAN_TOOL_NAME,
        args: { title: "Feature plan" },
      }),
      item("2", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "plan-call",
        toolName: PLAN_TOOL_NAME,
        args: { title: "Feature plan", content: "# Feature plan" },
      }),
      // Historical plan.updated events did not carry toolCallId; the active
      // plan tool lifecycle remains an unambiguous association.
      item("3", { type: "plan.updated", sessionId: "s", plan }),
      item("4", {
        type: "tool.ended",
        sessionId: "s",
        toolCallId: "plan-call",
        isError: false,
      }),
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        type: "tool",
        name: PLAN_TOOL_NAME,
        isComplete: true,
        isError: false,
        plan,
      }),
    ]);
  });

  it("updates the first visual block when a later visual reuses its visualId", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "v1",
        toolName: VISUAL_TOOL_NAME,
        args: { visualId: "chart", title: "Chart", kind: "svg", content: "<svg>one</svg>" },
      }),
      item("2", { type: "tool.ended", sessionId: "s", toolCallId: "v1", isError: false }),
      item("3", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "v2",
        toolName: VISUAL_TOOL_NAME,
        args: { visualId: " chart ", title: "Chart", kind: "svg", content: "<svg>two</svg>" },
      }),
    ]);

    expect(blocks.filter((block) => block.type === "tool")).toHaveLength(1);
    expect(blocks[0]).toEqual(
      expect.objectContaining({
        type: "tool",
        id: "v1",
        args: expect.objectContaining({ content: "<svg>two</svg>" }),
        isComplete: false,
        isError: false,
      }),
    );
  });

  it("does not merge visuals without the same visualId", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "v1",
        toolName: VISUAL_TOOL_NAME,
        args: { title: "One", kind: "svg", content: "<svg />" },
      }),
      item("2", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "v2",
        toolName: VISUAL_TOOL_NAME,
        args: { visualId: "other", title: "Two", kind: "svg", content: "<svg />" },
      }),
    ]);

    expect(blocks.filter((block) => block.type === "tool")).toHaveLength(2);
  });

  it("attaches resolved ask_user answers to the question tool block", () => {
    const request = {
      id: "question-request",
      sessionId: "s",
      questions: [
        {
          id: "q1",
          header: "Pick a direction",
          multiSelect: false,
          options: [{ label: "Fast" }, { label: "Careful", recommended: true }],
        },
      ],
    };
    const blocks = buildBlocks([
      item("1", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "t",
        toolName: "ask_user",
        args: { questions: [{ header: "Pick a direction" }] },
      }),
      item("2", { type: "question.requested", sessionId: "s", request }),
      item("3", {
        type: "question.resolved",
        sessionId: "s",
        requestId: request.id,
        skipped: false,
        answers: [{ questionId: "q1", selected: ["Careful"], custom: "plus tests" }],
      }),
      item("4", { type: "tool.ended", sessionId: "s", toolCallId: "t", isError: false }),
    ]);

    expect(blocks[0]).toEqual(
      expect.objectContaining({
        type: "tool",
        questionRequest: request,
        questionAnswers: [{ questionId: "q1", selected: ["Careful"], custom: "plus tests" }],
        questionSkipped: false,
      }),
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

  it("aggregates subagent activity by child session id", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "subagent.started",
        sessionId: "parent",
        childSessionId: "child-a",
        task: "Audit files",
        subagentType: "reviewer",
        model: "mock/model",
      }),
      item("2", {
        type: "subagent.updated",
        sessionId: "parent",
        childSessionId: "child-a",
        status: "running",
        activity: { kind: "tool", name: "read" },
      }),
      item("3", {
        type: "subagent.updated",
        sessionId: "parent",
        childSessionId: "child-a",
        status: "completed",
      }),
    ]);

    expect(blocks.filter((block) => block.type === "subagent")).toEqual([
      expect.objectContaining({
        type: "subagent",
        childSessionId: "child-a",
        task: "Audit files",
        status: "completed",
        activity: { kind: "tool", name: "read" },
      }),
    ]);
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
      item("3", {
        type: "thinking.delta",
        sessionId: "s",
        messageId: "assistant-1",
        delta: "plan",
      }),
      item("4", {
        type: "message.delta",
        sessionId: "s",
        messageId: "assistant-1",
        delta: "answer",
      }),
      item("5", { type: "message.completed", sessionId: "s", messageId: "assistant-1" }),
      item("6", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);

    const thought = blocks.find((block) => block.type === "thought");
    const message = blocks.find((block) => block.type === "message");
    expect(thought).toEqual(expect.objectContaining({ type: "thought", text: "plan" }));
    expect(message).toEqual(expect.objectContaining({ type: "message", content: "answer" }));
    if (!thought || !message) {
      throw new Error("Expected thought and message blocks");
    }
    // Thought renders above its sibling answer, and stops shimmering once sealed.
    expect(blocks.indexOf(thought)).toBeLessThan(blocks.indexOf(message));
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

  it("does not append a turn-end changes card (Review lives above the composer)", () => {
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

    expect(blocks.some((block) => (block as { type: string }).type === "changes")).toBe(false);
    expect(blocks.at(-1)).toEqual(
      expect.objectContaining({ type: "run", runId: "r", status: "completed" }),
    );
  });

  it("omits the changes card for turns without file changes", () => {
    const blocks = buildBlocks([
      item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("2", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);
    expect(blocks.some((block) => (block as { type: string }).type === "changes")).toBe(false);
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
const completedRun = (id: string, completedAt = 5000) => ({
  id,
  type: "run" as const,
  runId: id,
  status: "completed" as const,
  startedAt: 0,
  completedAt,
});
const thought = (id: string, text = "thinking…", streaming = false) => ({
  id: `thought:${id}`,
  type: "thought" as const,
  text,
  ...(streaming ? { streaming: true } : {}),
});
const todos = (id: string) => ({
  id,
  type: "todos" as const,
  todos: [{ id: "t1", content: "do thing", status: "pending" as const }],
  updating: false,
});

type Blocks = TimelineBlock[];

describe("groupTurnWork", () => {
  it("folds a run's tools and thoughts into one work-fold; final answer stays outside", () => {
    const result = groupTurnWork([
      msg("u", "hi", "user"),
      completedRun("r"),
      thought("th"),
      tool("1", "read"),
      tool("2", "edit"),
      msg("final", "done"),
    ] as Blocks);

    expect(result.map((block) => block.type)).toEqual(["message", "work-fold", "message"]);
    const fold = result[1];
    expect(fold).toEqual(
      expect.objectContaining({
        type: "work-fold",
        id: "work-fold:r",
      }),
    );
    if (fold?.type === "work-fold") {
      expect(fold.items.map((item) => item.type)).toEqual(["thought", "tool", "tool"]);
      expect(fold.run.runId).toBe("r");
    }
    expect(result[2]).toEqual(
      expect.objectContaining({ type: "message", id: "final", content: "done" }),
    );
  });

  it("puts assistant segments before the last work anchor inside the fold", () => {
    const result = groupTurnWork([
      completedRun("r"),
      msg("mid", "looking…"),
      tool("1", "grep"),
      msg("final", "found it"),
    ] as Blocks);

    const fold = result.find((block) => block.type === "work-fold");
    expect(fold?.type).toBe("work-fold");
    if (fold?.type === "work-fold") {
      expect(fold.items.map((item) => item.id)).toEqual(["mid", "1"]);
    }
    expect(result.at(-1)).toEqual(
      expect.objectContaining({ type: "message", id: "final", content: "found it" }),
    );
  });

  it("keeps todos inside the fold", () => {
    const result = groupTurnWork([
      completedRun("r"),
      tool("1", "write"),
      todos("todo"),
      msg("final", "shipped"),
    ] as Blocks);

    expect(result.map((block) => block.type)).toEqual(["work-fold", "message"]);
    const fold = result[0];
    if (fold?.type === "work-fold") {
      expect(fold.items.map((item) => item.type)).toEqual(["tool", "todos"]);
    }
  });

  it("emits a live work-fold while the run is active even before tools arrive", () => {
    const result = groupTurnWork([msg("u", "go", "user"), runningRun("r")] as Blocks);
    expect(result.map((block) => block.type)).toEqual(["message", "work-fold"]);
    const fold = result[1];
    if (fold?.type === "work-fold") {
      expect(fold.items).toHaveLength(0);
      expect(fold.run.status).toBe("running");
    }
  });

  it("keeps a steered mid-run user message inside the live fold", () => {
    const result = groupTurnWork([
      msg("u1", "go", "user"),
      runningRun("r1"),
      tool("1", "read"),
      msg("steer", "also do this", "user"),
      msg("mid", "ok"),
    ] as Blocks);

    // Steer stays in the fold; assistant after the last work anchor is the
    // (streaming) final answer and sits outside — same rule as settled turns.
    expect(result.map((block) => block.type)).toEqual(["message", "work-fold", "message"]);
    const fold = result[1];
    if (fold?.type === "work-fold") {
      expect(fold.items.map((item) => item.id)).toEqual(["1", "steer"]);
    }
    expect(result[2]).toEqual(expect.objectContaining({ id: "mid", content: "ok" }));
  });

  it("stops a settled turn at the next user message", () => {
    const result = groupTurnWork([
      msg("u1", "first", "user"),
      completedRun("r1"),
      tool("1", "bash"),
      msg("a1", "done"),
      msg("u2", "second", "user"),
      completedRun("r2"),
      thought("th2"),
      msg("a2", "ok"),
    ] as Blocks);

    expect(result.map((block) => block.type)).toEqual([
      "message",
      "work-fold",
      "message",
      "message",
      "work-fold",
      "message",
    ]);
    expect(result.map((block) => block.id)).toEqual([
      "u1",
      "work-fold:r1",
      "a1",
      "u2",
      "work-fold:r2",
      "a2",
    ]);
  });

  it("folds standalone edit/write tools the same as explore tools (run boundary, not kind)", () => {
    const result = groupTurnWork([
      completedRun("r"),
      tool("1", "write"),
      tool("2", "edit"),
      msg("final", "patched"),
    ] as Blocks);

    const fold = result.find((block) => block.type === "work-fold");
    if (fold?.type === "work-fold") {
      expect(fold.items.map((item) => (item.type === "tool" ? item.name : item.type))).toEqual([
        "write",
        "edit",
      ]);
    }
    expect(result.filter((block) => block.type === "work-fold")).toHaveLength(1);
    expect(result.some((block) => block.type === "run")).toBe(false);
  });

  it("drops a settled empty run with no work and no final text", () => {
    const result = groupTurnWork([msg("u", "hi", "user"), completedRun("r")] as Blocks);
    expect(result.map((block) => block.type)).toEqual(["message"]);
  });
});

describe("attachTurnActions", () => {
  const findRun = (blocks: Blocks) => blocks.find((block) => block.type === "run");

  it("aggregates the turn's assistant segments onto its settled run", () => {
    const result = attachTurnActions([
      msg("u", "hi", "user"),
      completedRun("r"),
      msg("a1", "first"),
      tool("t", "read"),
      msg("a2", "second"),
    ] as Blocks);

    expect(findRun(result)).toEqual(expect.objectContaining({ answer: "first\n\nsecond" }));
  });

  it("attaches no answer while the run is still streaming", () => {
    const result = attachTurnActions([
      msg("u", "hi", "user"),
      runningRun("r"),
      msg("a", "partial"),
    ] as Blocks);
    expect(findRun(result)).not.toHaveProperty("answer");
  });

  it("leaves a tool-only turn without an answer to copy", () => {
    const result = attachTurnActions([
      msg("u", "hi", "user"),
      completedRun("r"),
      tool("t", "read"),
    ] as Blocks);
    expect(findRun(result)).not.toHaveProperty("answer");
  });
});

describe("formatElapsedVerbose", () => {
  it("spells seconds and minute mixes", () => {
    expect(formatElapsedVerbose(5000, 0)).toBe("5 seconds");
    expect(formatElapsedVerbose(1000, 0)).toBe("1 second");
    expect(formatElapsedVerbose(125000, 0)).toBe("2m 5s");
  });
});

describe("subagentColor", () => {
  it("derives a stable color from the child session id", () => {
    expect(subagentColor("child-a")).toBe(subagentColor("child-a"));
    expect(subagentColor("child-a")).toMatch(/^#[0-9a-f]{6}$/);
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

describe("segmentTurns", () => {
  function message(
    id: string,
    role: "user" | "assistant",
    content: string,
  ): Extract<TimelineBlock, { type: "message" }> {
    return { id, type: "message", role, content };
  }

  it("opens a new turn on each user message and folds later blocks into it", () => {
    const blocks: TimelineBlock[] = [
      message("u1", "user", "first"),
      tool("t1", "read"),
      message("a1", "assistant", "ok"),
      message("u2", "user", "second"),
      message("a2", "assistant", "done"),
    ];
    const turns = segmentTurns(blocks, blockRenderKeys(blocks));
    expect(turns.map((turn) => turn.key)).toEqual(["u1", "u2"]);
    expect(turns[0]?.blocks.map((item) => item.block.id)).toEqual(["u1", "t1", "a1"]);
    expect(turns[1]?.blocks.map((item) => item.block.id)).toEqual(["u2", "a2"]);
  });

  it("parks leading non-user blocks in their own turn; the next user message opens another", () => {
    const blocks: TimelineBlock[] = [
      { id: "notice", type: "notice", title: "runtime error", body: "x" },
      message("u1", "user", "hello"),
      message("a1", "assistant", "hi"),
    ];
    const turns = segmentTurns(blocks, blockRenderKeys(blocks));
    expect(turns.map((turn) => turn.key)).toEqual(["notice", "u1"]);
    expect(turns[0]?.blocks.map((item) => item.block.id)).toEqual(["notice"]);
    expect(turns[1]?.blocks.map((item) => item.block.id)).toEqual(["u1", "a1"]);
  });

  it("uses disambiguated render keys when user message ids collide", () => {
    const blocks: TimelineBlock[] = [
      message("repeat", "user", "first"),
      message("repeat", "user", "second"),
    ];
    const turns = segmentTurns(blocks, blockRenderKeys(blocks));
    expect(turns.map((turn) => turn.key)).toEqual(["repeat", "repeat#2"]);
  });
});

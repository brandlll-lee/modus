import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { subagentColor } from "./subagentUi";
import {
  attachTurnActions,
  blockRenderKeys,
  buildBlocks,
  buildBrowserSummary,
  buildExploreSummary,
  buildShellSummary,
  groupActivity,
  relocateRunFooters,
  runStatusLabel,
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
        background: true,
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
      expect.objectContaining({
        type: "activity-group",
        kind: "explore",
        summary: "Explored 1 file",
      }),
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

  it("folds consecutive terminal tools into a shell group", () => {
    const grouped = groupActivity([tool("1", "bash"), tool("2", "bash"), msg("m")] as Blocks);
    expect(grouped[0]).toEqual(
      expect.objectContaining({
        type: "activity-group",
        kind: "shell",
        summary: "Ran 2 commands",
      }),
    );
    expect((grouped[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("keeps web_fetch standalone but folds catalog terminal renderers", () => {
    const result = groupActivity([
      tool("1", "web_fetch"),
      tool("2", "terminal_read"),
      msg("m"),
    ] as Blocks);
    expect(result[0]).toEqual(expect.objectContaining({ type: "tool", name: "web_fetch" }));
    expect(result[1]).toEqual(expect.objectContaining({ type: "activity-group", kind: "shell" }));
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
    const result = groupActivity([runningRun("r"), tool("1", "read"), tool("2", "read")] as Blocks);

    const group = result.find((block) => block.type === "activity-group");
    expect(group).toEqual(expect.objectContaining({ type: "activity-group", active: true }));
  });

  it("seals the group when assistant text breaks the chain during a running turn", () => {
    const result = groupActivity([
      runningRun("r"),
      tool("1", "read"),
      tool("2", "read"),
      msg("m", "now I'll check the workers"),
    ] as Blocks);

    expect(result.find((block) => block.type === "activity-group")).toEqual(
      expect.objectContaining({ active: false }),
    );
    expect(result.at(-1)).toEqual(expect.objectContaining({ type: "message", id: "m" }));
  });

  it("settles the trailing answer outside once the run ends", () => {
    // Same tail, but with the run no longer active the fold seals: the final
    // answer moves out to full-width (Cursor-style settle on completion) while
    // the fold collapses to its digest.
    const result = groupActivity([
      tool("1", "read"),
      tool("2", "read"),
      msg("m", "Here is the answer."),
    ] as Blocks);

    expect(result.find((block) => block.type === "activity-group")).toEqual(
      expect.objectContaining({ active: false }),
    );
    expect(result.at(-1)).toEqual(expect.objectContaining({ type: "message", id: "m" }));
  });

  it("seals the group when a first-class block breaks the chain mid-run", () => {
    // Shell and explore are distinct fold kinds, so shell arrival is an
    // authoritative chain break: the preceding exploration seals at once,
    // even though the run is still active.
    const result = groupActivity([
      runningRun("r"),
      tool("1", "read"),
      tool("2", "read"),
      tool("3", "bash"),
      msg("m"),
    ] as Blocks);

    const group = result.find((block) => block.type === "activity-group");
    expect(group).toEqual(expect.objectContaining({ active: false, summary: "Explored 2 files" }));
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
    expect(groups).toEqual([
      expect.objectContaining({ kind: "explore" }),
      expect.objectContaining({ kind: "shell" }),
      expect.objectContaining({ kind: "explore" }),
    ]);
  });

  it("renders assistant narration between activity groups as a full-width break", () => {
    const result = groupActivity([
      thought("t1", "plan"),
      tool("1", "read"),
      msg("checking", "checking"),
      tool("2", "read"),
    ] as Blocks);

    expect(result.map((block) => block.type)).toEqual([
      "activity-group",
      "message",
      "activity-group",
    ]);
    const groups = result.filter((block) => block.type === "activity-group");
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(
        (group as { items: { type: string }[] }).items.every((item) => item.type !== "message"),
      ).toBe(true);
    }
    expect(result[1]).toEqual(expect.objectContaining({ type: "message", id: "checking" }));
  });

  it("keeps each assistant narration segment at its own event position", () => {
    const result = groupActivity(
      buildBlocks([
        item("1", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
        item("2", {
          type: "message.started",
          sessionId: "s",
          messageId: "assistant-1",
          role: "assistant",
        }),
        item("3", {
          type: "message.delta",
          sessionId: "s",
          messageId: "assistant-1",
          delta: "before read",
        }),
        item("4", { type: "tool.started", sessionId: "s", toolCallId: "read-1", toolName: "read" }),
        item("5", { type: "tool.ended", sessionId: "s", toolCallId: "read-1", isError: false }),
        item("6", {
          type: "message.delta",
          sessionId: "s",
          messageId: "assistant-1",
          delta: "before shell",
        }),
        item("7", {
          type: "tool.started",
          sessionId: "s",
          toolCallId: "shell-1",
          toolName: "bash",
          args: { command: "do work" },
        }),
        item("8", { type: "tool.ended", sessionId: "s", toolCallId: "shell-1", isError: false }),
        item("9", {
          type: "message.delta",
          sessionId: "s",
          messageId: "assistant-1",
          delta: "after shell",
        }),
        item("10", { type: "run.completed", sessionId: "s", runId: "r" }),
      ]),
    );

    const rendered = result.filter(
      (block) => block.type === "activity-group" || block.type === "message",
    );
    expect(rendered.map((block) => block.type)).toEqual([
      "message",
      "activity-group",
      "message",
      "activity-group",
      "message",
    ]);
    expect(rendered[0]).toEqual(
      expect.objectContaining({ type: "message", content: "before read" }),
    );
    expect(rendered[1]).toEqual(
      expect.objectContaining({ type: "activity-group", kind: "explore" }),
    );
    expect(rendered[2]).toEqual(
      expect.objectContaining({
        type: "message",
        content: "before shell",
      }),
    );
    expect(rendered[3]).toEqual(expect.objectContaining({ type: "activity-group", kind: "shell" }));
    expect(rendered[4]).toEqual(
      expect.objectContaining({ type: "message", content: "after shell" }),
    );

    const groups = rendered.filter((block) => block.type === "activity-group");
    for (const group of groups) {
      expect(
        (group as { items: { type: string }[] }).items.every((item) => item.type !== "message"),
      ).toBe(true);
    }
  });

  it("does not split a same-kind tool chain on empty assistant message blocks", () => {
    const result = groupActivity([
      tool("1", "read"),
      msg("empty", ""),
      tool("2", "read"),
      msg("final", "done"),
    ] as Blocks);

    expect(result.filter((block) => block.type === "activity-group")).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ type: "activity-group", summary: "Explored 2 files" }),
    );
    expect((result[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("folds thoughts and subagent control rows into the exploration group", () => {
    const result = groupActivity([
      tool("read-1", "read"),
      thought("plan", "checking worker"),
      tool("wait-1", "wait_agent"),
      tool("list-1", "list_agents"),
      thought("done", "worker settled"),
    ] as Blocks);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        type: "activity-group",
        kind: "explore",
        summary: "Explored 1 file",
      }),
    );
    expect((result[0] as { items: { type: string; name?: string }[] }).items).toEqual([
      expect.objectContaining({ type: "tool", name: "read" }),
      expect.objectContaining({ type: "thought" }),
      expect.objectContaining({ type: "tool", name: "wait_agent" }),
      expect.objectContaining({ type: "tool", name: "list_agents" }),
      expect.objectContaining({ type: "thought" }),
    ]);
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

  it("summarizes shell groups from completion state", () => {
    expect(
      buildShellSummary([tool("1", "bash", false)] as Parameters<typeof buildShellSummary>[0]),
    ).toBe("Running command…");
    expect(
      buildShellSummary([tool("1", "terminal_run"), tool("2", "terminal_read")] as Parameters<
        typeof buildShellSummary
      >[0]),
    ).toBe("Ran 2 commands");
  });
});

describe("attachTurnActions", () => {
  const completedRun = (id: string, completedAt = 5000) => ({
    id,
    type: "run" as const,
    runId: id,
    status: "completed" as const,
    startedAt: 0,
    completedAt,
  });
  const findRun = (blocks: Blocks) => blocks.find((block) => block.type === "run");

  it("aggregates the turn's assistant segments onto its settled run footer", () => {
    const result = attachTurnActions([
      msg("u", "hi", "user"),
      completedRun("r"),
      msg("a1", "first"),
      tool("t", "read"),
      msg("a2", "second"),
    ] as Blocks);

    // The whole turn's answer rides on the run block — the footer is the turn's
    // single copy surface, so it is merged into the status line, not the message.
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

describe("relocateRunFooters", () => {
  const settledRun = (id: string, completedAt = 5000) => ({
    id,
    type: "run" as const,
    runId: id,
    status: "completed" as const,
    startedAt: 0,
    completedAt,
  });

  it("moves a turn's run block beneath its content", () => {
    const result = relocateRunFooters([
      msg("u", "hi", "user"),
      settledRun("r"),
      msg("a", "answer"),
    ] as Blocks);

    expect(result.map((block) => block.type)).toEqual(["message", "message", "run"]);
    expect(result.at(-1)).toEqual(expect.objectContaining({ type: "run", runId: "r" }));
  });

  it("keeps every turn's footer at its own turn end across turns", () => {
    const result = relocateRunFooters([
      msg("u1", "hi", "user"),
      settledRun("r1"),
      msg("a1", "first"),
      msg("u2", "again", "user"),
      runningRun("r2"),
      msg("a2", "second"),
    ] as Blocks);

    expect(result.map((block) => block.id)).toEqual(["u1", "a1", "r1", "u2", "a2", "r2"]);
  });

  it("keeps a steered mid-run user message inside the live turn", () => {
    // The run is still running, so a steered user line is NOT a turn boundary:
    // the live footer must stay at the very bottom, after all the turn's content.
    const result = relocateRunFooters([
      msg("u1", "go", "user"),
      runningRun("r1"),
      msg("a1", "working"),
      msg("steer", "also do this", "user"),
      msg("a2", "ok"),
    ] as Blocks);

    expect(result.map((block) => block.id)).toEqual(["u1", "a1", "steer", "a2", "r1"]);
    expect(result.at(-1)).toEqual(expect.objectContaining({ type: "run", runId: "r1" }));
  });
});

describe("runStatusLabel", () => {
  const run = (
    status: "running" | "completed" | "failed" | "blocked" | "cancelled",
    extra: Record<string, unknown> = {},
  ) =>
    ({ id: "r", type: "run", runId: "r", status, startedAt: 0, ...extra }) as Parameters<
      typeof runStatusLabel
    >[0];

  it("tracks the live activity while running (hybrid: curated category + humanized MCP)", () => {
    expect(runStatusLabel(run("running", { activity: { kind: "tool", name: "read" } }))).toBe(
      "Reading files",
    );
    expect(runStatusLabel(run("running", { activity: { kind: "tool", name: "grep" } }))).toBe(
      "Searching the codebase",
    );
    expect(
      runStatusLabel(run("running", { activity: { kind: "tool", name: "browser_click" } })),
    ).toBe("Using the browser");
    expect(
      runStatusLabel(
        run("running", { activity: { kind: "tool", name: "mcp_devin_list_integrations" } }),
      ),
    ).toBe("Listing integrations");
    expect(runStatusLabel(run("running", { activity: { kind: "thinking" } }))).toBe("Thinking");
    expect(runStatusLabel(run("running", { activity: { kind: "writing" } }))).toBe(
      "Writing the response",
    );
    expect(runStatusLabel(run("running"))).toBe("Thinking");
  });

  it("reports the duration once settled", () => {
    expect(runStatusLabel(run("completed", { completedAt: 5000 }))).toBe(
      "Modus has worked for 5 seconds",
    );
    expect(runStatusLabel(run("completed", { completedAt: 1000 }))).toBe(
      "Modus has worked for 1 second",
    );
    expect(runStatusLabel(run("completed", { completedAt: 125000 }))).toBe(
      "Modus has worked for 2m 5s",
    );
  });

  it("surfaces terminal states", () => {
    expect(runStatusLabel(run("blocked"))).toBe("Waiting for approval");
    expect(runStatusLabel(run("failed"))).toBe("Modus stopped");
    expect(runStatusLabel(run("cancelled"))).toBe("Stopped by you");
  });
});

describe("subagentColor", () => {
  it("derives a stable color from the child session id", () => {
    expect(subagentColor("child-a")).toBe(subagentColor("child-a"));
    expect(subagentColor("child-a")).toMatch(/^#[0-9a-f]{6}$/);
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

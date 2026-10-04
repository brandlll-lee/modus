import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { formatElapsed, workActivityPresentation } from "./ActivityGroup";
import { foldAgentEvents, optimisticUserPromptEvents } from "./agentEventHub";
import {
  attachTurnActions,
  blockRenderKeys,
  buildBlocks,
  buildVisibleTimelineBlocks,
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
  it("replaces progress details with the native executed diff after folding", () => {
    const events: AgentEvent[] = [
      {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "e",
        toolName: "edit",
        args: { path: "example.ts" },
      },
      {
        type: "tool.output",
        sessionId: "s",
        toolCallId: "e",
        output: "first",
        details: { diff: "+1 partial" },
      },
      {
        type: "tool.output",
        sessionId: "s",
        toolCallId: "e",
        output: "second",
        details: { diff: "+1 preview" },
      },
    ];
    const entries = events.map((event, i) => item(String(i), event));
    expect(buildBlocks(foldAgentEvents(entries))[0]).toMatchObject({
      output: "second",
      details: { diff: "+1 preview" },
    });
    entries.push(
      item("final", {
        type: "tool.ended",
        sessionId: "s",
        toolCallId: "e",
        output: "done",
        isError: false,
        details: { diff: "-7 old\n+7 new", patch: "native patch" },
      }),
    );
    expect(buildBlocks(foldAgentEvents(entries))[0]).toMatchObject({
      isComplete: true,
      output: "done",
      details: { diff: "-7 old\n+7 new", patch: "native patch" },
    });
  });

  it("keeps an image-only user message visible after events are folded", () => {
    const attachments = [
      { type: "image" as const, data: "pixels", mimeType: "image/png", path: "C:/photo.png" },
    ];
    const events = optimisticUserPromptEvents({
      sessionId: "s",
      userMessageId: "image-user",
      message: "",
      attachments,
    });
    expect(buildVisibleTimelineBlocks(foldAgentEvents(events))).toEqual([
      expect.objectContaining({ type: "message", role: "user", content: "", attachments }),
    ]);
  });

  it("groups consecutive image results separately from commands and intermediate text", () => {
    const image = { type: "image" as const, data: "pixels", mimeType: "image/png" };
    const entries = [
      item("start", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("command", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "cmd",
        toolName: "bash",
      }),
      ...["one", "two"].flatMap((id) => [
        item(`${id}:start`, {
          type: "tool.started",
          sessionId: "s",
          toolCallId: id,
          toolName: "read",
        }),
        item(`${id}:progress`, {
          type: "tool.output",
          sessionId: "s",
          toolCallId: id,
          output: "",
          images: [image],
        }),
        item(`${id}:end`, {
          type: "tool.ended",
          sessionId: "s",
          toolCallId: id,
          output: "",
          images: [image],
          isError: false,
        }),
      ]),
      item("text", { type: "message.delta", sessionId: "s", messageId: "m", delta: "Next action" }),
      item("last:start", {
        type: "tool.started",
        sessionId: "s",
        toolCallId: "last",
        toolName: "extension",
      }),
      item("last:end", {
        type: "tool.ended",
        sessionId: "s",
        toolCallId: "last",
        output: "",
        images: [image],
        isError: false,
      }),
    ];
    const grouped = groupTurnWork(buildBlocks(foldAgentEvents(entries)));
    expect(grouped[0]).toMatchObject({
      type: "work-fold",
      items: [
        { type: "work-activity-group" },
        {
          type: "work-image-group",
          items: [
            { id: "one", images: [image] },
            { id: "two", images: [image] },
          ],
        },
        { type: "message", content: "Next action" },
        { type: "work-image-group", items: [{ id: "last", images: [image] }] },
      ],
    });
  });
  it("updates one retry row through exhaustion and restores it from history", () => {
    const events: AgentEvent[] = [
      { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" },
      {
        type: "session.status",
        sessionId: "s",
        status: { type: "retry", attempt: 1, maxAttempts: 5, message: "temporary", nextAt: 1000 },
      },
      {
        type: "session.status",
        sessionId: "s",
        status: { type: "retry", attempt: 2, maxAttempts: 5, message: "temporary", nextAt: 2000 },
      },
      {
        type: "retry.ended",
        sessionId: "s",
        success: false,
        attempt: 2,
        finalError: "final failure",
      },
      { type: "run.failed", sessionId: "s", runId: "r", message: "final failure" },
      { type: "runtime.error", sessionId: "s", message: "final failure" },
      { type: "session.status", sessionId: "s", status: { type: "idle" } },
    ];
    const entries = foldAgentEvents(events.map((event, i) => item(String(i), event)));
    const rows = buildBlocks(entries).filter((block) => block.type === "request-status");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "failed",
      attempt: 2,
      maxAttempts: 5,
      detail: "final failure",
    });
    const grouped = groupTurnWork(buildBlocks(entries));
    expect(grouped[0]).toMatchObject({ type: "work-fold", items: [rows[0]] });
  });

  it("keeps recovered retries distinct from later retry cycles", () => {
    const blocks = buildBlocks([
      item("start", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      item("retry", {
        type: "session.status",
        sessionId: "s",
        status: { type: "retry", attempt: 1, maxAttempts: 3, message: "first", nextAt: 1000 },
      }),
      item("recovered", { type: "retry.ended", sessionId: "s", success: true, attempt: 1 }),
      item("retry2", {
        type: "session.status",
        sessionId: "s",
        status: { type: "retry", attempt: 1, maxAttempts: 3, message: "second", nextAt: 2000 },
      }),
      item("cancelled", { type: "run.cancelled", sessionId: "s", runId: "r" }),
    ]);
    expect(blocks.filter((block) => block.type === "request-status")).toMatchObject([
      { status: "done", recovered: true },
      { status: "cancelled" },
    ]);
  });

  it("shows a terminal error even when the run produced no content", () => {
    const events: AgentEvent[] = [
      { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" },
      { type: "run.failed", sessionId: "s", runId: "r", message: "403 quota exhausted" },
    ];
    expect(
      groupTurnWork(buildBlocks(events.map((event, i) => item(String(i), event)))),
    ).toMatchObject([
      {
        type: "work-fold",
        items: [{ type: "request-status", status: "failed", detail: "403 quota exhausted" }],
      },
    ]);
  });

  it("starts execution time at the first native turn and keeps it across later turns", () => {
    const events = [
      { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" },
      { type: "agent.started", sessionId: "s" },
      { type: "turn.started", sessionId: "s" },
      { type: "turn.started", sessionId: "s" },
      { type: "agent.ended", sessionId: "s" },
      { type: "run.completed", sessionId: "s", runId: "r" },
    ] as AgentEvent[];
    const entries = events.map((event, index) => ({
      ...item(String(index), event),
      createdAt: new Date(index * 1000).toISOString(),
    }));
    expect(buildBlocks(entries.slice(0, 2))[0]).toEqual(expect.objectContaining({ startedAt: 0 }));
    expect(buildBlocks(entries.slice(0, 2))[0]).not.toHaveProperty("executionStartedAt");
    expect(buildBlocks(entries)[0]).toEqual(
      expect.objectContaining({
        executionStartedAt: 2000,
        executionCompletedAt: 4000,
        completedAt: 5000,
      }),
    );
  });

  it("restores recorded native loop timing when a transcript has no turn events", () => {
    const blocks = buildBlocks([
      item("request", { type: "run.started", sessionId: "s", runId: "r", delivery: "normal" }),
      {
        ...item("native", { type: "agent.started", sessionId: "s" }),
        createdAt: new Date(1000).toISOString(),
      },
      item("end", { type: "run.completed", sessionId: "s", runId: "r" }),
    ]);
    expect(blocks[0]).toEqual(expect.objectContaining({ executionStartedAt: 1000 }));
  });
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

  it("ignores title-tool partial deltas until tool.started", () => {
    const delta = {
      type: "tool.delta" as const,
      sessionId: "s",
      toolCallId: "t",
      toolName: "bash",
      args: { command: "l" },
    };
    expect(buildBlocks([item("1", delta)])).toEqual([]);
    expect(
      buildBlocks([
        item("1", delta),
        item("2", {
          type: "tool.started",
          sessionId: "s",
          toolCallId: "t",
          toolName: "bash",
          args: { command: "ls -la" },
        }),
      ])[0],
    ).toEqual(expect.objectContaining({ args: { command: "ls -la" } }));
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
        type: "thinking.completed",
        sessionId: "s",
        messageId: "assistant-1",
      }),
      item("5", {
        type: "message.delta",
        sessionId: "s",
        messageId: "assistant-1",
        delta: "answer",
      }),
      item("6", { type: "message.completed", sessionId: "s", messageId: "assistant-1" }),
      item("7", { type: "run.completed", sessionId: "s", runId: "r" }),
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

  it("keeps only an unfinished thought streaming", () => {
    const events = [
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
    ];
    const blocks = buildBlocks(events);

    expect(blocks.find((block) => block.type === "thought")).toEqual(
      expect.objectContaining({ type: "thought", text: "thinking hard", streaming: true }),
    );
    expect(
      buildBlocks([
        ...events,
        item("4", {
          type: "thinking.completed",
          sessionId: "s",
          messageId: "assistant-1",
        }),
        item("5", { type: "tool.started", sessionId: "s", toolCallId: "t", toolName: "read" }),
      ]).find((block) => block.type === "thought"),
    ).toEqual(expect.objectContaining({ streaming: false }));
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

  it("does not render queue.updated as a user-facing notice", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "queue.updated",
        sessionId: "s",
        steering: [],
        followUp: ["## Skills\n- browser"],
      }),
    ]);
    expect(blocks.filter((block) => block.type === "notice")).toEqual([]);
  });

  it("upserts compaction started/ended into one tool-like row", () => {
    const blocks = buildBlocks([
      item("1", {
        type: "compaction.started",
        sessionId: "s",
        reason: "threshold",
      }),
      item("2", {
        type: "compaction.ended",
        sessionId: "s",
        reason: "threshold",
        aborted: false,
        willRetry: false,
      }),
    ]);
    const compaction = blocks.filter((block) => block.type === "compaction");
    expect(compaction).toHaveLength(1);
    expect(compaction[0]).toEqual(
      expect.objectContaining({
        type: "compaction",
        reason: "threshold",
        status: "done",
        detail: "Context compacted",
      }),
    );
    expect(blocks.filter((block) => block.type === "notice")).toEqual([]);
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
      expect(fold.items.map((item) => item.type)).toEqual(["work-activity-group"]);
      expect(fold.run.runId).toBe("r");
    }
    expect(result[2]).toEqual(
      expect.objectContaining({ type: "message", id: "final", content: "done" }),
    );
  });

  it("keeps manual compaction after the settled answer", () => {
    const result = groupTurnWork([
      completedRun("r"),
      tool("read", "read"),
      msg("final", "done"),
      {
        id: "compact",
        type: "compaction",
        reason: "manual",
        status: "done",
      },
    ] as Blocks);

    expect(result.map((block) => block.id)).toEqual(["work-fold:r", "final", "compact"]);
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
      expect(fold.items.map((item) => item.id)).toEqual(["mid", "work-activity:1"]);
    }
    expect(result.at(-1)).toEqual(
      expect.objectContaining({ type: "message", id: "final", content: "found it" }),
    );
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

  it("keeps active assistant text and a steered user message inside the live fold", () => {
    const result = groupTurnWork([
      msg("u1", "go", "user"),
      runningRun("r1"),
      tool("1", "read"),
      msg("steer", "also do this", "user"),
      msg("mid", "ok"),
    ] as Blocks);

    expect(result.map((block) => block.type)).toEqual(["message", "work-fold"]);
    const fold = result[1];
    if (fold?.type === "work-fold") {
      expect(fold.items.map((item) => item.id)).toEqual(["work-activity:1", "steer", "mid"]);
    }
  });

  it("does not reparent active assistant text when a later tool arrives", () => {
    const beforeTool = groupTurnWork([
      runningRun("r"),
      tool("1", "read"),
      msg("mid", "checking"),
    ] as Blocks);
    const afterTool = groupTurnWork([
      runningRun("r"),
      tool("1", "read"),
      msg("mid", "checking"),
      tool("2", "edit"),
    ] as Blocks);

    const itemIds = (blocks: TimelineBlock[]) => {
      const fold = blocks.find((block) => block.type === "work-fold");
      return fold?.type === "work-fold" ? fold.items.map((item) => item.id) : [];
    };
    expect(itemIds(beforeTool)).toContain("mid");
    expect(itemIds(afterTool)).toContain("mid");
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
      expect(fold.items).toHaveLength(1);
    }
    expect(result.filter((block) => block.type === "work-fold")).toHaveLength(1);
    expect(result.some((block) => block.type === "run")).toBe(false);
  });

  it("drops a settled empty run with no work and no final text", () => {
    const result = groupTurnWork([msg("u", "hi", "user"), completedRun("r")] as Blocks);
    expect(result.map((block) => block.type)).toEqual(["message"]);
  });
});

describe("local work activity groups", () => {
  it("summarizes declared target and call counting semantics", () => {
    const activities = [
      { ...tool("e1", "edit"), args: { path: "a.ts" } },
      { ...tool("e2", "edit"), args: { path: "b.ts" } },
      { ...tool("e3", "edit"), args: { path: "b.ts" } },
      { ...tool("cmd", "bash"), args: { command: "arbitrary command" } },
      { ...tool("read", "read"), args: { path: "a.ts" } },
      { ...tool("search-1", "extension_search"), args: { query: "first" } },
      { ...tool("search-2", "extension_search"), args: { query: "second" } },
      { ...tool("fetch", "extension_fetch"), args: { url: "https://example.com" } },
    ];
    expect(workActivityPresentation(activities).label).toBe(
      "Edited 2 files, ran 1 command, read 1 file, used 3 tools",
    );
  });

  it("uses the full latest authoritative item and safely summarizes unknown tools", () => {
    const activities = [tool("live", "bash", false), thought("th", "123456789012345678901", true)];
    expect(workActivityPresentation(activities).label).toBe("Running");
    expect(workActivityPresentation([tool("future", "brand_new_tool")]).label).toBe("Used 1 tool");
    expect(workActivityPresentation([thought("d", "plan")]).label).toBe("Thought · plan");
  });

  it("reports parallel tools while each group keeps its authoritative completion", () => {
    const first = { ...tool("a", "brand_new_tool", false), label: "Native extension action" };
    const second = { ...tool("b", "bash", false), args: { command: "arbitrary command" } };
    expect(workActivityPresentation([first, second]).label).toBe(
      "Running arbitrary command · 2 actions running",
    );
    expect(workActivityPresentation([first, { ...second, isComplete: true }]).label).toBe(
      "Running Native extension action",
    );
    expect(
      workActivityPresentation([
        { ...first, isComplete: true },
        { ...second, isComplete: true },
      ]).active,
    ).toBe(false);
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
    const fold = groupTurnWork(result).find((block) => block.type === "work-fold");
    expect(fold).toEqual(
      expect.objectContaining({ run: expect.objectContaining({ answer: "first\n\nsecond" }) }),
    );
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

describe("activity duration labels", () => {
  it("uses compact duration units", () => {
    expect(formatElapsed(5000, 0)).toBe("5s");
    expect(formatElapsed(120000, 0)).toBe("2m");
    expect(formatElapsed(125000, 0)).toBe("2m 5s");
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

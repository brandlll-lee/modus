import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import {
  AgentEventHub,
  type AgentEventItem,
  affectsActivity,
  appendAgentEvents,
  foldAgentEvents,
  IDLE_ACTIVITY,
  optimisticUserPromptEvents,
  reduceActivity,
} from "./agentEventHub";

const runStarted: AgentEvent = {
  type: "run.started",
  sessionId: "s",
  runId: "r",
  delivery: "normal",
};
const runCompleted: AgentEvent = { type: "run.completed", sessionId: "s", runId: "r" };
const runFailed: AgentEvent = { type: "run.failed", sessionId: "s", runId: "r", message: "boom" };
const permissionRequested: AgentEvent = {
  type: "permission.requested",
  sessionId: "s",
  request: { id: "p", action: "shell.execute", target: "rm", reason: "dangerous" },
};

function item(event: AgentEvent, id = crypto.randomUUID()): AgentEventItem {
  return { id, event };
}

describe("reduceActivity", () => {
  it("tracks a watched run through start and completion without unread", () => {
    const running = reduceActivity(undefined, runStarted, true);
    expect(running).toMatchObject({ running: true, needsInput: false, failed: false });

    const done = reduceActivity(running, runCompleted, true);
    expect(done).toMatchObject({ running: false, unread: false, failed: false });
  });

  it("marks background completions unread and failures failed", () => {
    const running = reduceActivity(undefined, runStarted, false);
    expect(reduceActivity(running, runCompleted, false)).toMatchObject({
      running: false,
      unread: true,
      failed: false,
    });
    expect(reduceActivity(running, runFailed, false)).toMatchObject({
      running: false,
      unread: true,
      failed: true,
    });
  });

  it("raises and clears the needs-input flag around permission requests", () => {
    const running = reduceActivity(undefined, runStarted, true);
    const blocked = reduceActivity(running, permissionRequested, true);
    expect(blocked.needsInput).toBe(true);

    const resolved = reduceActivity(
      blocked,
      { type: "permission.resolved", sessionId: "s", requestId: "p", decision: "allow-once" },
      true,
    );
    expect(resolved.needsInput).toBe(false);
    expect(resolved.running).toBe(true);
  });

  it("returns the same reference for irrelevant events so state updates can bail", () => {
    const running = reduceActivity(undefined, runStarted, true);
    const after = reduceActivity(
      running,
      { type: "message.delta", sessionId: "s", messageId: "m", delta: "x" },
      true,
    );
    expect(after).toBe(running);
    expect(
      affectsActivity({ type: "message.delta", sessionId: "s", messageId: "m", delta: "x" }),
    ).toBe(false);
    expect(affectsActivity(runStarted)).toBe(true);
  });

  it("starts from idle defaults", () => {
    expect(IDLE_ACTIVITY).toEqual({
      running: false,
      needsInput: false,
      unread: false,
      failed: false,
    });
  });
});

describe("appendAgentEvents", () => {
  it("merges adjacent deltas of the same message and tool", () => {
    const merged = appendAgentEvents(
      [item({ type: "message.delta", sessionId: "s", messageId: "m", delta: "Hel" })],
      [
        item({ type: "message.delta", sessionId: "s", messageId: "m", delta: "lo" }),
        item({ type: "tool.output", sessionId: "s", toolCallId: "t", output: "a" }),
        item({ type: "tool.output", sessionId: "s", toolCallId: "t", output: "b" }),
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.event).toMatchObject({ type: "message.delta", delta: "Hello" });
    expect(merged[1]?.event).toMatchObject({ type: "tool.output", output: "ab" });
  });

  it("keeps deltas of different messages separate", () => {
    const merged = appendAgentEvents(
      [item({ type: "message.delta", sessionId: "s", messageId: "m1", delta: "a" })],
      [item({ type: "message.delta", sessionId: "s", messageId: "m2", delta: "b" })],
    );
    expect(merged).toHaveLength(2);
  });

  it("deduplicates run lifecycle echoes from history and live events", () => {
    const merged = appendAgentEvents(
      [item(runStarted)],
      [item(runStarted), item(runCompleted), item(runCompleted)],
    );

    expect(merged.map((entry) => entry.event.type)).toEqual(["run.started", "run.completed"]);
  });

  it("collapses a run of tool.delta for the same call to the latest args", () => {
    const merged = appendAgentEvents(
      [],
      [
        item({
          type: "tool.delta",
          sessionId: "s",
          toolCallId: "t",
          toolName: "write",
          args: { path: "a.html", content: "<a" },
        }),
        item({
          type: "tool.delta",
          sessionId: "s",
          toolCallId: "t",
          toolName: "write",
          args: { path: "a.html", content: "<ab" },
        }),
        item({
          type: "tool.delta",
          sessionId: "s",
          toolCallId: "t",
          toolName: "write",
          args: { path: "a.html", content: "<abc" },
        }),
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.event).toMatchObject({
      type: "tool.delta",
      args: { content: "<abc" },
    });
  });

  it("keeps tool.delta of different calls separate", () => {
    const merged = appendAgentEvents(
      [],
      [
        item({ type: "tool.delta", sessionId: "s", toolCallId: "t1", toolName: "write", args: {} }),
        item({ type: "tool.delta", sessionId: "s", toolCallId: "t2", toolName: "write", args: {} }),
      ],
    );
    expect(merged).toHaveLength(2);
  });

  it("folds interleaved deltas of the same stream regardless of position", () => {
    // A real turn interleaves thinking / answer / tool output. Adjacency-based
    // merging would leave one item per non-adjacent run; keying on the part id
    // collapses each stream to a single accumulated item.
    const folded = foldAgentEvents([
      item({ type: "message.started", sessionId: "s", messageId: "m", role: "assistant" }),
      item({ type: "thinking.delta", sessionId: "s", messageId: "m", delta: "th-1 " }),
      item({ type: "message.delta", sessionId: "s", messageId: "m", delta: "ans-1 " }),
      item({ type: "tool.output", sessionId: "s", toolCallId: "t", output: "out-1" }),
      item({ type: "thinking.delta", sessionId: "s", messageId: "m", delta: "th-2" }),
      item({ type: "message.delta", sessionId: "s", messageId: "m", delta: "ans-2" }),
      item({ type: "tool.output", sessionId: "s", toolCallId: "t", output: "-out-2" }),
    ]);

    // started + one folded thinking + one folded message + one folded tool.output.
    expect(folded).toHaveLength(4);
    expect(folded.find((f) => f.event.type === "thinking.delta")?.event).toMatchObject({
      delta: "th-1 th-2",
    });
    expect(folded.find((f) => f.event.type === "message.delta")?.event).toMatchObject({
      delta: "ans-1 ans-2",
    });
    expect(folded.find((f) => f.event.type === "tool.output")?.event).toMatchObject({
      output: "out-1-out-2",
    });
  });

  it("keeps first createdAt and last updatedAt when folding thinking deltas", () => {
    const folded = foldAgentEvents([
      {
        id: "a",
        createdAt: "2026-01-01T00:00:00.000Z",
        event: { type: "thinking.delta", sessionId: "s", messageId: "m", delta: "a" },
      },
      {
        id: "b",
        createdAt: "2026-01-01T00:00:19.000Z",
        event: { type: "thinking.delta", sessionId: "s", messageId: "m", delta: "b" },
      },
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(folded[0]?.updatedAt).toBe("2026-01-01T00:00:19.000Z");
  });

  it("is idempotent — folding already-folded events changes nothing", () => {
    const once = foldAgentEvents([
      item({ type: "message.delta", sessionId: "s", messageId: "m", delta: "a" }),
      item({ type: "message.delta", sessionId: "s", messageId: "m", delta: "b" }),
    ]);
    const twice = foldAgentEvents(once);
    expect(twice).toHaveLength(1);
    expect(twice[0]?.event).toMatchObject({ type: "message.delta", delta: "ab" });
  });

  it("replaces optimistic user prompt events with matching runtime events", () => {
    const seed = optimisticUserPromptEvents({
      sessionId: "s",
      userMessageId: "m",
      message: "hello",
    });

    const merged = appendAgentEvents(seed, [
      item({ type: "message.started", sessionId: "s", messageId: "m", role: "user" }),
      item({ type: "message.delta", sessionId: "s", messageId: "m", delta: "hello" }),
      item({ type: "message.completed", sessionId: "s", messageId: "m" }),
      item({ type: "session.status", sessionId: "s", status: { type: "idle" } }),
    ]);

    expect(merged).toHaveLength(4);
    expect(merged.some((entry) => entry.optimistic)).toBe(false);
    expect(merged.find((entry) => entry.event.type === "message.delta")?.event).toMatchObject({
      delta: "hello",
    });
    expect(merged.find((entry) => entry.event.type === "session.status")?.event).toMatchObject({
      status: { type: "idle" },
    });
  });
});

describe("AgentEventHub", () => {
  it("fans events out to the matching session's subscribers only", () => {
    const hub = new AgentEventHub();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe("session-a", a);
    const unsubscribeB = hub.subscribe("session-b", b);

    hub.publish(
      item({ type: "run.started", sessionId: "session-a", runId: "r", delivery: "normal" }),
    );
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    unsubscribeB();
    hub.publish(
      item({ type: "run.started", sessionId: "session-b", runId: "r", delivery: "normal" }),
    );
    expect(b).not.toHaveBeenCalled();
    expect(hub.hasSubscribers("session-b")).toBe(false);
    expect(hub.hasSubscribers("session-a")).toBe(true);
  });

  it("supports two panes watching the same session", () => {
    const hub = new AgentEventHub();
    const first = vi.fn();
    const second = vi.fn();
    hub.subscribe("s", first);
    hub.subscribe("s", second);

    hub.publish(item({ type: "run.completed", sessionId: "s", runId: "r" }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("hands prepared events to the first subscriber exactly once", () => {
    const hub = new AgentEventHub();
    const event = item({ type: "run.started", sessionId: "s", runId: "r", delivery: "normal" });
    hub.prepare("s");
    hub.publish(event);

    const first = vi.fn();
    hub.subscribe("s", first);
    expect(first).toHaveBeenCalledWith(event);

    const second = vi.fn();
    hub.subscribe("s", second);
    expect(second).not.toHaveBeenCalled();
  });

  it("drops events after a prepared handoff is cancelled", () => {
    const hub = new AgentEventHub();
    const subscriber = vi.fn();
    hub.prepare("s");
    hub.cancelPrepare("s");
    hub.publish(item({ type: "run.completed", sessionId: "s", runId: "r" }));
    hub.subscribe("s", subscriber);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("keeps parent and subagent chat streams isolated", () => {
    const hub = new AgentEventHub();
    const parent = vi.fn();
    const child = vi.fn();
    hub.subscribe("parent-session", parent);
    hub.subscribe("child-session", child);

    hub.publish(
      item({
        type: "message.delta",
        sessionId: "child-session",
        messageId: "child-message",
        delta: "child output",
      }),
    );
    hub.publish(
      item({
        type: "subagent.updated",
        sessionId: "parent-session",
        childSessionId: "child-session",
        status: "running",
      }),
    );
    hub.publish(
      item({
        type: "message.delta",
        sessionId: "parent-session",
        messageId: "parent-message",
        delta: "parent output",
      }),
    );

    expect(child).toHaveBeenCalledOnce();
    expect(child.mock.calls[0]?.[0].event).toMatchObject({
      sessionId: "child-session",
      delta: "child output",
    });
    expect(parent).toHaveBeenCalledTimes(2);
    expect(parent.mock.calls.map((call) => call[0].event)).toEqual([
      expect.objectContaining({ type: "subagent.updated", sessionId: "parent-session" }),
      expect.objectContaining({
        type: "message.delta",
        sessionId: "parent-session",
        delta: "parent output",
      }),
    ]);
  });
});

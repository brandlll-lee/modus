import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import {
  AgentEventHub,
  type AgentEventItem,
  affectsActivity,
  appendAgentEvents,
  IDLE_ACTIVITY,
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
});

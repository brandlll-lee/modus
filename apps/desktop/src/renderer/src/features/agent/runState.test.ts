import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { isRunActive, isTerminalRunEvent, TERMINAL_RUN_EVENT_TYPES } from "./runState";

const SESSION = "s";
const RUN = "r";

function wrap(events: AgentEvent[]): Array<{ event: AgentEvent }> {
  return events.map((event) => ({ event }));
}

const started: AgentEvent = {
  type: "run.started",
  sessionId: SESSION,
  runId: RUN,
  delivery: "normal",
};
const completed: AgentEvent = { type: "run.completed", sessionId: SESSION, runId: RUN };
const failed: AgentEvent = { type: "run.failed", sessionId: SESSION, runId: RUN, message: "boom" };
const cancelled: AgentEvent = { type: "run.cancelled", sessionId: SESSION, runId: RUN };
const blocked: AgentEvent = {
  type: "run.blocked",
  sessionId: SESSION,
  runId: RUN,
  requestId: "req-1",
  reason: "awaiting permission",
};
const runtimeError: AgentEvent = {
  type: "runtime.error",
  sessionId: SESSION,
  message: "Connection error.",
};
const toolEnded: AgentEvent = {
  type: "tool.ended",
  sessionId: SESSION,
  toolCallId: "t1",
  isError: false,
};

describe("isTerminalRunEvent", () => {
  it("treats completed/failed/cancelled as terminal", () => {
    expect(isTerminalRunEvent(completed)).toBe(true);
    expect(isTerminalRunEvent(failed)).toBe(true);
    expect(isTerminalRunEvent(cancelled)).toBe(true);
  });

  it("does NOT treat runtime.error as terminal (it is recoverable, mid-run)", () => {
    expect(isTerminalRunEvent(runtimeError)).toBe(false);
  });

  it("does NOT treat run.started / run.blocked as terminal", () => {
    expect(isTerminalRunEvent(started)).toBe(false);
    expect(isTerminalRunEvent(blocked)).toBe(false);
  });

  it("excludes runtime.error from the terminal set constant", () => {
    expect(TERMINAL_RUN_EVENT_TYPES).not.toContain("runtime.error");
  });
});

describe("isRunActive", () => {
  it("is inactive with no events", () => {
    expect(isRunActive([])).toBe(false);
  });

  it("is active after run.started", () => {
    expect(isRunActive(wrap([started]))).toBe(true);
  });

  it("stays active across a transient runtime.error (the bug being fixed)", () => {
    // A connection error mid-run must NOT settle the run: the agent auto-retries
    // and keeps streaming, so the composer must stay locked / border visible.
    expect(isRunActive(wrap([started, runtimeError, toolEnded, runtimeError]))).toBe(true);
  });

  it("becomes inactive once the run completes", () => {
    expect(isRunActive(wrap([started, runtimeError, completed]))).toBe(false);
  });

  it("becomes inactive on run.failed and run.cancelled", () => {
    expect(isRunActive(wrap([started, failed]))).toBe(false);
    expect(isRunActive(wrap([started, cancelled]))).toBe(false);
  });

  it("treats a blocked run (awaiting permission) as active", () => {
    expect(isRunActive(wrap([started, blocked]))).toBe(true);
  });

  it("reactivates when a new run starts after a previous one settled", () => {
    expect(isRunActive(wrap([started, completed, started]))).toBe(true);
  });

  it("ignores trailing non-lifecycle events and reads the latest run state", () => {
    expect(isRunActive(wrap([started, completed, toolEnded, runtimeError]))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { AgentEvent, SessionRunStatus } from "../../../../shared/contracts";
import { IDLE_STATUS, latestSessionStatus } from "./runState";

const SESSION = "s";

function wrap(events: AgentEvent[]): Array<{ event: AgentEvent }> {
  return events.map((event) => ({ event }));
}

function status(value: SessionRunStatus): AgentEvent {
  return { type: "session.status", sessionId: SESSION, status: value };
}

const busy = status({ type: "busy" });
const idle = status({ type: "idle" });
const retry = status({
  type: "retry",
  attempt: 1,
  maxAttempts: 5,
  message: "Request timed out",
  nextAt: 1_000,
});
const toolEnded: AgentEvent = {
  type: "tool.ended",
  sessionId: SESSION,
  toolCallId: "t1",
  isError: false,
};
const runtimeError: AgentEvent = {
  type: "runtime.error",
  sessionId: SESSION,
  message: "Connection error.",
};

describe("latestSessionStatus", () => {
  it("defaults to idle with no events", () => {
    expect(latestSessionStatus([])).toEqual(IDLE_STATUS);
  });

  it("reads the most recent session.status newest-first", () => {
    expect(latestSessionStatus(wrap([busy, idle, busy]))).toEqual({ type: "busy" });
    expect(latestSessionStatus(wrap([busy, idle]))).toEqual({ type: "idle" });
  });

  it("returns the retry status with its attempt/countdown payload intact", () => {
    expect(latestSessionStatus(wrap([busy, retry]))).toEqual({
      type: "retry",
      attempt: 1,
      maxAttempts: 5,
      message: "Request timed out",
      nextAt: 1_000,
    });
  });

  it("ignores non-status events when reading the latest status", () => {
    // A transient runtime.error or tool activity after `busy` must NOT change
    // the working state — only the runtime's own status events do.
    expect(latestSessionStatus(wrap([busy, runtimeError, toolEnded]))).toEqual({ type: "busy" });
  });
});

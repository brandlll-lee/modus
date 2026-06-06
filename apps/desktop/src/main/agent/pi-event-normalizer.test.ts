import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createPiEventNormalizer, normalizePiEvent } from "./pi-event-normalizer";

function event(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent;
}

describe("normalizePiEvent", () => {
  it("maps PI assistant text deltas to Modus message deltas", () => {
    expect(
      normalizePiEvent(
        "session-1",
        event({
          type: "message_update",
          message: { id: "message-1", role: "assistant" },
          assistantMessageEvent: { type: "text_delta", delta: "hello" },
        }),
      ),
    ).toEqual([
      {
        type: "message.delta",
        sessionId: "session-1",
        messageId: "message-1",
        delta: "hello",
      },
    ]);
  });

  it("omits absent optional compaction summary fields", () => {
    expect(
      normalizePiEvent(
        "session-1",
        event({
          type: "compaction_end",
          aborted: false,
        }),
      ),
    ).toEqual([
      {
        type: "compaction.ended",
        sessionId: "session-1",
        aborted: false,
      },
    ]);
  });

  it("keeps fallback message ids stable across PI message lifecycle events without message ids", () => {
    const normalize = createPiEventNormalizer("session-1");

    expect(
      normalize(
        event({
          type: "message_start",
          message: { role: "assistant", content: [] },
        }),
      ),
    ).toEqual([
      {
        type: "message.started",
        sessionId: "session-1",
        messageId: "message:assistant:1",
        role: "assistant",
      },
    ]);

    expect(
      normalize(
        event({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: "plan" },
        }),
      ),
    ).toEqual([
      {
        type: "thinking.delta",
        sessionId: "session-1",
        messageId: "message:assistant:1",
        delta: "plan",
      },
    ]);

    expect(
      normalize(
        event({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "text_delta", delta: "answer" },
        }),
      ),
    ).toEqual([
      {
        type: "message.delta",
        sessionId: "session-1",
        messageId: "message:assistant:1",
        delta: "answer",
      },
    ]);

    expect(
      normalize(
        event({
          type: "message_end",
          message: { role: "assistant", content: [] },
        }),
      ),
    ).toEqual([
      {
        type: "message.completed",
        sessionId: "session-1",
        messageId: "message:assistant:1",
      },
    ]);
  });

  it("ignores PI user lifecycle events because Modus persists user text itself", () => {
    const normalize = createPiEventNormalizer("session-1");

    expect(
      normalize(
        event({
          type: "message_start",
          message: { role: "user", content: [] },
        }),
      ),
    ).toEqual([]);
    expect(
      normalize(
        event({
          type: "message_end",
          message: { role: "user", content: [] },
        }),
      ),
    ).toEqual([]);
  });

  it("surfaces assistant message errors from PI message end events", () => {
    const normalize = createPiEventNormalizer("session-1");

    normalize(
      event({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    );

    expect(
      normalize(
        event({
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "403 Your request was blocked.",
          },
        }),
      ),
    ).toEqual([
      {
        type: "message.completed",
        sessionId: "session-1",
        messageId: "message:assistant:1",
      },
      {
        type: "runtime.error",
        sessionId: "session-1",
        message: "403 Your request was blocked.",
      },
    ]);
  });
});

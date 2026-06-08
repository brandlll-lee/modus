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

    const [start] = normalize(
      event({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    );
    const id = start && "messageId" in start ? start.messageId : "";
    // Unique per-normalizer prefix so resumed sessions never collide, yet stable
    // for the whole message lifecycle.
    expect(id).toMatch(/^message:[0-9a-f]{8}:assistant:1$/);
    expect(start).toEqual({
      type: "message.started",
      sessionId: "session-1",
      messageId: id,
      role: "assistant",
    });

    expect(
      normalize(
        event({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "thinking_delta", delta: "plan" },
        }),
      ),
    ).toEqual([{ type: "thinking.delta", sessionId: "session-1", messageId: id, delta: "plan" }]);

    expect(
      normalize(
        event({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: { type: "text_delta", delta: "answer" },
        }),
      ),
    ).toEqual([{ type: "message.delta", sessionId: "session-1", messageId: id, delta: "answer" }]);

    expect(
      normalize(
        event({
          type: "message_end",
          message: { role: "assistant", content: [] },
        }),
      ),
    ).toEqual([{ type: "message.completed", sessionId: "session-1", messageId: id }]);
  });

  it("gives each normalizer instance a distinct fallback id namespace", () => {
    const a = createPiEventNormalizer("session-1");
    const b = createPiEventNormalizer("session-1");
    const startEvent = event({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    const [startA] = a(startEvent);
    const [startB] = b(startEvent);
    const idA = startA && "messageId" in startA ? startA.messageId : "a";
    const idB = startB && "messageId" in startB ? startB.messageId : "b";
    expect(idA).not.toEqual(idB);
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

    const [start] = normalize(
      event({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    );
    const id = start && "messageId" in start ? start.messageId : "";

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
        messageId: id,
      },
      {
        type: "runtime.error",
        sessionId: "session-1",
        message: "403 Your request was blocked.",
      },
    ]);
  });
});

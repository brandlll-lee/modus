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

  it("surfaces a streaming tool call as a live tool.delta with partial args", () => {
    // A `toolcall_delta` whose partial message already carries the parsed
    // arguments-so-far → the card can render immediately and grow live.
    expect(
      normalizePiEvent(
        "session-1",
        event({
          type: "message_update",
          message: { id: "message-1", role: "assistant" },
          assistantMessageEvent: {
            type: "toolcall_delta",
            contentIndex: 0,
            delta: '","content":"<!DOCTYPE',
            partial: {
              content: [
                {
                  type: "toolCall",
                  id: "tooluse_abc",
                  name: "write",
                  arguments: { path: "index.html", content: "<!DOCTYPE html>" },
                },
              ],
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool.delta",
        sessionId: "session-1",
        toolCallId: "tooluse_abc",
        toolName: "write",
        args: { path: "index.html", content: "<!DOCTYPE html>" },
      },
    ]);
  });

  it("ignores a streaming tool call until the provider assigns it an id", () => {
    // Early in the stream the id may not be set yet; emitting then would fork a
    // second card that can't merge with the durable tool.started.
    expect(
      normalizePiEvent(
        "session-1",
        event({
          type: "message_update",
          message: { id: "message-1", role: "assistant" },
          assistantMessageEvent: {
            type: "toolcall_start",
            contentIndex: 0,
            partial: {
              content: [{ type: "toolCall", id: "", name: "write", arguments: {} }],
            },
          },
        }),
      ),
    ).toEqual([]);
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

  it("does not surface a runtime error for a mid-turn assistant error (retry/fatal handled elsewhere)", () => {
    // A message that ends with stopReason "error" is no longer painted red
    // here: if the runtime retries, `auto_retry_start` reports a non-fatal retry
    // status; if it gives up, the backend surfaces a single fatal `run.failed`
    // from the last assistant stopReason. Emitting here too would double every
    // transient failure.
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
    ]);
  });

  it("maps an auto-retry start to a non-fatal retry status with attempt/countdown", () => {
    const before = Date.now();
    const [statusEvent, ...rest] = normalizePiEvent(
      "session-1",
      event({
        type: "auto_retry_start",
        attempt: 2,
        maxAttempts: 5,
        delayMs: 4000,
        errorMessage: "Request timed out",
      }),
    );
    expect(rest).toEqual([]);
    expect(statusEvent).toMatchObject({
      type: "session.status",
      sessionId: "session-1",
      status: {
        type: "retry",
        attempt: 2,
        maxAttempts: 5,
        message: "Request timed out",
      },
    });
    // `nextAt` is the wall-clock deadline for the countdown.
    const next =
      statusEvent && statusEvent.type === "session.status" && statusEvent.status.type === "retry"
        ? statusEvent.status.nextAt
        : 0;
    expect(next).toBeGreaterThanOrEqual(before + 4000);
  });

  it("maps a successful auto-retry end back to busy, and a failed one to nothing", () => {
    expect(
      normalizePiEvent("session-1", event({ type: "auto_retry_end", success: true, attempt: 2 })),
    ).toEqual([{ type: "session.status", sessionId: "session-1", status: { type: "busy" } }]);

    expect(
      normalizePiEvent(
        "session-1",
        event({
          type: "auto_retry_end",
          success: false,
          attempt: 5,
          finalError: "Request timed out",
        }),
      ),
    ).toEqual([]);
  });
});

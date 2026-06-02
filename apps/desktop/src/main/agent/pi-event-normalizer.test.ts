import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { normalizePiEvent } from "./pi-event-normalizer";

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
});

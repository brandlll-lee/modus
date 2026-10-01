import { describe, expect, it } from "vitest";
import type { AgentEvent, QuestionRequest } from "../../../../shared/contracts";
import { latestInlineQuestion } from "./questionRequests";

const inline: QuestionRequest = { id: "inline", questions: [] };
const dialog: QuestionRequest = { id: "dialog", presentation: "dialog", questions: [] };
const requested = (request: QuestionRequest): { event: AgentEvent } => ({
  event: { type: "question.requested", sessionId: "session", request },
});

describe("latestInlineQuestion", () => {
  it("routes dialog questions exclusively to the modal surface", () => {
    expect(latestInlineQuestion([requested(dialog)])).toBeUndefined();
  });

  it("keeps an inline question pending while a separate dialog is open", () => {
    expect(latestInlineQuestion([requested(inline), requested(dialog)])).toBe(inline);
  });

  it("removes the matching inline question after resolution", () => {
    expect(
      latestInlineQuestion([
        requested(inline),
        requested(dialog),
        {
          event: {
            type: "question.resolved",
            sessionId: "session",
            requestId: inline.id,
            answers: [],
            skipped: true,
          },
        },
      ]),
    ).toBeUndefined();
  });
});

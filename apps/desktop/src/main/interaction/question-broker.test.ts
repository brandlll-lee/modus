import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, QuestionPrompt } from "../../shared/contracts";
import {
  denyPendingQuestionRequests,
  requestQuestions,
  resolveQuestionRequest,
} from "./question-broker";

const QUESTIONS: QuestionPrompt[] = [
  { id: "q1", header: "Which view?", multiSelect: false, options: [{ label: "Side" }] },
];

afterEach(() => {
  denyPendingQuestionRequests();
});

describe("question-broker", () => {
  it("emits question.requested and resolves with the user's answers", async () => {
    const events: AgentEvent[] = [];
    const pending = requestQuestions({
      sessionId: "session-1",
      questions: QUESTIONS,
      emit: (event) => events.push(event),
    });

    const requested = events.find((event) => event.type === "question.requested");
    if (requested?.type !== "question.requested") {
      throw new Error("missing question.requested");
    }
    resolveQuestionRequest(requested.request.id, [{ questionId: "q1", selected: ["Side"] }], false);

    await expect(pending).resolves.toMatchObject({
      skipped: false,
      answers: [{ questionId: "q1", selected: ["Side"] }],
    });
    expect(
      events.some((event) => event.type === "question.resolved" && event.skipped === false),
    ).toBe(true);
  });

  it("a skip discards answers and resolves as skipped", async () => {
    const events: AgentEvent[] = [];
    const pending = requestQuestions({
      sessionId: "session-1",
      questions: QUESTIONS,
      emit: (event) => events.push(event),
    });
    const requested = events.find((event) => event.type === "question.requested");
    if (requested?.type !== "question.requested") {
      throw new Error("missing request");
    }
    // Even if answers are passed, skipped=true must win (answers dropped).
    resolveQuestionRequest(requested.request.id, [{ questionId: "q1", selected: ["Side"] }], true);

    await expect(pending).resolves.toMatchObject({ skipped: true, answers: [] });
  });

  it("an aborted run unblocks the question as skipped", async () => {
    const controller = new AbortController();
    const pending = requestQuestions({
      sessionId: "session-1",
      questions: QUESTIONS,
      emit: () => {},
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ skipped: true });
  });

  it("denies all pending questions on window close", async () => {
    const pending = requestQuestions({
      sessionId: "session-1",
      questions: QUESTIONS,
      emit: () => {},
    });
    denyPendingQuestionRequests();
    await expect(pending).resolves.toMatchObject({ skipped: true });
  });
});

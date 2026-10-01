import type { AgentEvent, QuestionRequest } from "../../../../shared/contracts";

export function latestInlineQuestion(
  events: Array<{ event: AgentEvent }>,
): QuestionRequest | undefined {
  const pending = new Map<string, QuestionRequest>();

  for (const { event } of events) {
    if (event.type === "question.requested") {
      pending.delete(event.request.id);
      if (event.request.presentation !== "dialog") pending.set(event.request.id, event.request);
      continue;
    }
    if (event.type === "question.resolved") {
      pending.delete(event.requestId);
    }
  }

  return Array.from(pending.values()).at(-1);
}

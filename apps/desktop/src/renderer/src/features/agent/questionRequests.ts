import type { AgentEvent, QuestionRequest } from "../../../../shared/contracts";

/**
 * The newest still-unanswered ask_user request, derived from the event stream
 * (mirrors latestPendingPermissionRequest): a `question.requested` is pending
 * until its matching `question.resolved` arrives.
 */
export function latestPendingQuestionRequest(
  events: Array<{ event: AgentEvent }>,
): QuestionRequest | undefined {
  const pending = new Map<string, QuestionRequest>();

  for (const { event } of events) {
    if (event.type === "question.requested") {
      pending.delete(event.request.id);
      pending.set(event.request.id, event.request);
      continue;
    }
    if (event.type === "question.resolved") {
      pending.delete(event.requestId);
    }
  }

  return Array.from(pending.values()).at(-1);
}

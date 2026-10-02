import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  QuestionAnswer,
  QuestionPrompt,
  QuestionRequest,
  QuestionResponse,
} from "../../shared/contracts";
import { PendingRequestRegistry } from "./pending-requests";

type QuestionContext = { request: QuestionRequest; emit(event: AgentEvent): void };

const registry = new PendingRequestRegistry<QuestionResponse, QuestionContext>();

function makeResponse(
  context: QuestionContext,
  answers: QuestionAnswer[],
  skipped: boolean,
): QuestionResponse {
  const response: QuestionResponse = { requestId: context.request.id, answers, skipped };
  if (context.request.sessionId) {
    context.emit({
      type: "question.resolved",
      sessionId: context.request.sessionId,
      requestId: context.request.id,
      answers,
      skipped,
    });
  }
  return response;
}

const skip = (context: QuestionContext): QuestionResponse => makeResponse(context, [], true);

export async function requestQuestions(input: {
  sessionId: string;
  questions: QuestionPrompt[];
  emit(event: AgentEvent): void;
  /** When the run is aborted mid-question, unblock as skipped so the turn ends cleanly. */
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}): Promise<QuestionResponse> {
  const request: QuestionRequest = {
    id: randomUUID(),
    sessionId: input.sessionId,
    questions: input.questions,
  };

  input.emit({ type: "question.requested", sessionId: input.sessionId, request });

  const pending = registry.open({
    id: request.id,
    sessionId: input.sessionId,
    context: { request, emit: input.emit },
    timeoutMs: input.timeoutMs,
    onTimeout: (context) => skip(context),
  });

  const abort = () => {
    resolveQuestionRequest(request.id, [], true);
  };
  if (input.signal?.aborted) abort();
  else input.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await pending;
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}

export function resolveQuestionRequest(
  requestId: string,
  answers: QuestionAnswer[],
  skipped: boolean,
): QuestionResponse | undefined {
  return registry.settle(requestId, (context) =>
    makeResponse(context, skipped ? [] : answers, skipped),
  );
}

export function denyPendingQuestionRequests(): void {
  registry.cancelAll((context) => skip(context));
}

export function denyPendingQuestionRequestsForSession(sessionId: string): void {
  registry.cancelForSession(sessionId, (context) => skip(context));
}

import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { QuestionAnswer, QuestionPrompt, QuestionResponse } from "../../../shared/contracts";
import { ASK_USER_TOOL_NAME, ASK_USER_TOOL_UI } from "../../../shared/tools";
import { requestQuestions } from "../../interaction/question-broker";
import { toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

/**
 * Interactive clarification tool. When research can't settle a genuine product/
 * preference decision, the agent calls `ask_user` with menu-style questions; the
 * run blocks on the QuestionsCard above the composer until the user answers (or
 * skips). The answers come back as the tool result so the model proceeds with
 * the user's intent. Capability is `safe` (read-only round-trip — it writes
 * nothing), so it is available in both plan and chat profiles.
 */

function toResult(text: string, details: QuestionResponse): AgentToolResult<QuestionResponse> {
  return { content: [{ type: "text", text }], details };
}

const askUserParams = Type.Object({
  questions: Type.Array(
    Type.Object({
      header: Type.String({ minLength: 1, description: "The question to ask the user." }),
      detail: Type.Optional(
        Type.String({ description: "Optional one-line context shown under the question." }),
      ),
      multiSelect: Type.Optional(
        Type.Boolean({
          description: "Allow choosing several options. Default false (single choice).",
        }),
      ),
      options: Type.Array(
        Type.Object({
          label: Type.String({ minLength: 1, description: "A concise choice." }),
          description: Type.Optional(Type.String({ description: "Optional clarifier." })),
          recommended: Type.Optional(
            Type.Boolean({ description: "Mark your suggested default (shown as 'recommended')." }),
          ),
        }),
        {
          minItems: 1,
          maxItems: 4,
          description:
            "2–4 mutually-exclusive choices. The user may also type a custom answer or skip.",
        },
      ),
    }),
    { minItems: 1, maxItems: 4, description: "1–4 questions to ask together." },
  ),
});

function formatAnswers(questions: QuestionPrompt[], answers: QuestionAnswer[]): string {
  const lines: string[] = [];
  for (const question of questions) {
    const answer = answers.find((entry) => entry.questionId === question.id);
    const parts = [...(answer?.selected ?? [])];
    if (answer?.custom) {
      parts.push(answer.custom);
    }
    lines.push(`Q: ${question.header}`);
    lines.push(`A: ${parts.length > 0 ? parts.join("; ") : "(no answer)"}`);
  }
  return lines.join("\n");
}

const askUserTool: ToolDefinition = defineTool({
  name: ASK_USER_TOOL_NAME,
  label: "Ask the user",
  description:
    "Ask the user one to four menu-style questions and wait for the answer. Use ONLY for genuine " +
    "product/preference decisions that exploring the repo cannot settle — never for facts you can " +
    "discover yourself. Each question offers 2–4 mutually-exclusive options (mark one recommended); " +
    "the user can also type a custom answer or skip. If skipped, proceed with your recommended " +
    "defaults and record them as assumptions.",
  promptSnippet:
    "ask_user(questions) — ask the user menu-style questions and wait for their choices.",
  promptGuidelines: [
    "Front-load the few decisions that actually shape the work; do not ask about anything you can find by reading the repo.",
    "Give each question 2–4 concrete, mutually-exclusive options and mark the one you recommend.",
    "Treat a skip / no-answer as 'use my recommended default' and record it as an assumption.",
  ],
  parameters: askUserParams,
  execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    const emit = context.emit;
    if (!context.sessionId || !emit) {
      const skipped: QuestionResponse = { requestId: "", answers: [], skipped: true };
      return toResult(
        "No interactive channel is available here; proceed with reasonable defaults and record them as assumptions.",
        skipped,
      );
    }

    const questions: QuestionPrompt[] = params.questions.map((question, index) => ({
      id: `q${index + 1}`,
      header: question.header,
      ...(question.detail !== undefined ? { detail: question.detail } : {}),
      multiSelect: question.multiSelect ?? false,
      options: question.options.map((option) => ({
        label: option.label,
        ...(option.description !== undefined ? { description: option.description } : {}),
        ...(option.recommended !== undefined ? { recommended: option.recommended } : {}),
      })),
    }));

    const response = await requestQuestions({
      sessionId: context.sessionId,
      questions,
      emit,
      ...(signal ? { signal } : {}),
    });

    if (response.skipped) {
      return toResult(
        "The user skipped the questions. Proceed with your recommended defaults and record them explicitly as assumptions.",
        response,
      );
    }
    return toResult(formatAnswers(questions, response.answers), response);
  },
});

let registered = false;

/** Register the ask_user tool into the shared registry (idempotent). */
export function registerQuestionTools(): void {
  if (registered) {
    return;
  }
  registered = true;

  toolRegistry.registerTool({
    entry: {
      name: ASK_USER_TOOL_NAME,
      profiles: ["plan", "chat"],
      permission: { danger: "safe" },
      ui: ASK_USER_TOOL_UI,
    },
    definition: askUserTool,
  });
}

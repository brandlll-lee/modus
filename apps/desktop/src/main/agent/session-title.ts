import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { AgentEvent } from "../../shared/contracts";
import { getAgentSession, updateAgentSessionTitle } from "./agent-store";
import { findModel, getDefaultModel, getModelRegistry } from "./model-service";

const DEFAULT_SESSION_TITLES = new Set(["Modus local agent", "New chat"]);
const MAX_TITLE_LENGTH = 50;
const TITLE_TIMEOUT_MS = 20_000;
/** Cap prompt size sent to the title model — not a title heuristic. */
const MAX_TITLE_PROMPT_CHARS = 2_000;

const TITLE_SYSTEM = `You are a title generator. You output ONLY a thread title. Nothing else.

Generate a brief title that helps the user find this conversation later.
- Single line, <=50 characters, no explanations
- Use the same language as the user message
- Grammatically natural — no word salad
- Focus on the main topic; never answer the user's question
- Never include tool names, or the words summarizing/generating
- Keep exact technical terms, numbers, filenames
- Short greetings → a tone label (Greeting, Quick check-in, etc.)
- Always output something meaningful`;

const inFlight = new Set<string>();

export function shouldReplaceSessionTitle(title: string | undefined): boolean {
  if (!title) {
    return true;
  }
  const trimmed = title.trim();
  return !trimmed || DEFAULT_SESSION_TITLES.has(trimmed);
}

/** Strip model chrome; take first non-empty line; hard-cap length. */
export function cleanSessionTitleText(raw: string): string | undefined {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/```[\s\S]*?```/g, " ")
    .trim();
  const line = cleaned
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) {
    return undefined;
  }
  const unquoted = line.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!unquoted) {
    return undefined;
  }
  if (unquoted.length <= MAX_TITLE_LENGTH) {
    return unquoted;
  }
  return unquoted.slice(0, MAX_TITLE_LENGTH).trim();
}

function prepareTitlePrompt(prompt: string): string {
  return prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<context>[\s\S]*?<\/context>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_PROMPT_CHARS);
}

type ScheduleSessionTitleInput = {
  sessionId: string;
  userText: string;
  modelId: string | undefined;
  /** Volatile emit — title lives in agent_sessions, not the event timeline. */
  emit(event: AgentEvent): void;
  onApplied?(title: string): void;
};

/**
 * Fire-and-forget AI title for placeholder sessions. Never blocks the main
 * turn; never spawns a child agent process — one short streamSimple call.
 */
export function scheduleSessionTitle(input: ScheduleSessionTitleInput): void {
  if (inFlight.has(input.sessionId)) {
    return;
  }
  inFlight.add(input.sessionId);
  void applyAiSessionTitle(input).finally(() => {
    inFlight.delete(input.sessionId);
  });
}

async function applyAiSessionTitle(input: ScheduleSessionTitleInput): Promise<void> {
  try {
    const existing = getAgentSession(input.sessionId);
    if (!existing || existing.parentSessionId || !shouldReplaceSessionTitle(existing.title)) {
      return;
    }

    const prompt = prepareTitlePrompt(input.userText);
    if (!prompt) {
      return;
    }

    const raw = await completeTitleText(prompt, input.modelId ?? existing.model);
    const title = raw ? cleanSessionTitleText(raw) : undefined;
    if (!title) {
      return;
    }

    // Re-check: user may have renamed while the request was in flight.
    const latest = getAgentSession(input.sessionId);
    if (!latest || !shouldReplaceSessionTitle(latest.title)) {
      return;
    }

    const updated = updateAgentSessionTitle(input.sessionId, title);
    if (!updated) {
      return;
    }
    input.onApplied?.(title);
    input.emit({ type: "session.updated", sessionId: input.sessionId, title });
  } catch (error) {
    console.warn(
      "[session-title] failed to generate title",
      input.sessionId,
      error instanceof Error ? error.message : error,
    );
  }
}

async function completeTitleText(
  userText: string,
  modelId: string | undefined,
): Promise<string | undefined> {
  const model = findModel(modelId) ?? getDefaultModel();
  if (!model) {
    return undefined;
  }

  const apiKey = await getModelRegistry()
    .getApiKeyForProvider(model.provider)
    .catch(() => undefined);
  if (!apiKey) {
    return undefined;
  }

  const stream = streamSimple(
    model,
    {
      systemPrompt: TITLE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Generate a title for this conversation:\n${userText}`,
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey,
      timeoutMs: TITLE_TIMEOUT_MS,
      maxRetries: 0,
      // Omit reasoning — title calls must stay cheap (no thinking budget).
    },
  );

  for await (const _event of stream) {
    // Drain; result() holds the assembled message.
  }
  const message = await stream.result();
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    return undefined;
  }

  return message.content
    .filter(
      (item): item is Extract<(typeof message.content)[number], { type: "text" }> =>
        item.type === "text" && Boolean(item.text?.trim()),
    )
    .map((item) => item.text.trim())
    .join("\n");
}

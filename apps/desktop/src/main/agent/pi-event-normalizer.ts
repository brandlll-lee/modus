import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../../shared/contracts";

type MessageRole = "assistant" | "user";

type NormalizerState = {
  nextFallbackId: number;
  activeMessageIds: Partial<Record<MessageRole, string>>;
};

function explicitMessageId(message: unknown): string | undefined {
  if (message && typeof message === "object" && "id" in message) {
    const id = (message as { id?: unknown }).id;
    if (id !== undefined && id !== null && String(id).trim()) {
      return String(id);
    }
  }
  return undefined;
}

function messageRole(message: unknown): MessageRole | undefined {
  if (!message || typeof message !== "object" || !("role" in message)) {
    return undefined;
  }

  const role = (message as { role?: unknown }).role;
  return role === "user" || role === "assistant" ? role : undefined;
}

function messageError(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if ("errorMessage" in message) {
    const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
    if (typeof errorMessage === "string" && errorMessage.trim()) {
      return errorMessage;
    }
  }

  if ("stopReason" in message) {
    const stopReason = (message as { stopReason?: unknown }).stopReason;
    if (stopReason === "error") {
      return "The model returned an error without additional details.";
    }
  }

  return undefined;
}

function messageId(message: unknown, role: MessageRole, state: NormalizerState): string {
  const explicit = explicitMessageId(message);
  if (explicit) {
    state.activeMessageIds[role] = explicit;
    return explicit;
  }

  const active = state.activeMessageIds[role];
  if (active) {
    return active;
  }

  const fallback = `message:${role}:${++state.nextFallbackId}`;
  state.activeMessageIds[role] = fallback;
  return fallback;
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function createPiEventNormalizer(
  sessionId: string,
): (event: AgentSessionEvent) => AgentEvent[] {
  const state: NormalizerState = { nextFallbackId: 0, activeMessageIds: {} };
  return (event) => normalizePiEvent(sessionId, event, state);
}

export function normalizePiEvent(
  sessionId: string,
  event: AgentSessionEvent,
  state: NormalizerState = { nextFallbackId: 0, activeMessageIds: {} },
): AgentEvent[] {
  switch (event.type) {
    case "agent_start":
      return [{ type: "agent.started", sessionId }];
    case "agent_end":
      state.activeMessageIds = {};
      return [{ type: "agent.ended", sessionId }];
    case "message_start": {
      const role = messageRole(event.message);
      if (role !== "assistant") {
        return [];
      }
      return [
        {
          type: "message.started",
          sessionId,
          messageId: messageId(event.message, role, state),
          role,
        },
      ];
    }
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return [
          {
            type: "message.delta",
            sessionId,
            messageId: messageId(event.message, "assistant", state),
            delta: event.assistantMessageEvent.delta,
          },
        ];
      }
      if (event.assistantMessageEvent.type === "thinking_delta") {
        return [
          {
            type: "thinking.delta",
            sessionId,
            messageId: messageId(event.message, "assistant", state),
            delta: event.assistantMessageEvent.delta,
          },
        ];
      }
      return [];
    case "message_end": {
      const role = messageRole(event.message);
      if (role !== "assistant") {
        return [];
      }
      const id = messageId(event.message, role, state);
      delete state.activeMessageIds[role];
      const completed = { type: "message.completed", sessionId, messageId: id } as const;
      const error = messageError(event.message);
      return error
        ? [completed, { type: "runtime.error", sessionId, message: error }]
        : [completed];
    }
    case "tool_execution_start":
      return [
        {
          type: "tool.started",
          sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        },
      ];
    case "tool_execution_update":
      return [
        {
          type: "tool.output",
          sessionId,
          toolCallId: event.toolCallId,
          output: stringify(event.partialResult),
        },
      ];
    case "tool_execution_end":
      return [
        {
          type: "tool.ended",
          sessionId,
          toolCallId: event.toolCallId,
          isError: event.isError,
        },
      ];
    case "queue_update":
      return [
        {
          type: "queue.updated",
          sessionId,
          steering: [...event.steering],
          followUp: [...event.followUp],
        },
      ];
    case "compaction_start":
      return [{ type: "compaction.started", sessionId, reason: event.reason }];
    case "compaction_end":
      return event.errorMessage
        ? [
            {
              type: "compaction.ended",
              sessionId,
              aborted: event.aborted,
              summary: event.errorMessage,
            },
          ]
        : [{ type: "compaction.ended", sessionId, aborted: event.aborted }];
    case "auto_retry_start":
      return [{ type: "runtime.error", sessionId, message: event.errorMessage }];
    case "auto_retry_end":
      return event.finalError
        ? [{ type: "runtime.error", sessionId, message: event.finalError }]
        : [];
    default:
      return [];
  }
}

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../../shared/contracts";

function messageId(message: unknown): string {
  if (message && typeof message === "object" && "id" in message) {
    return String((message as { id?: unknown }).id);
  }

  return `message:${Date.now()}`;
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function normalizePiEvent(sessionId: string, event: AgentSessionEvent): AgentEvent[] {
  switch (event.type) {
    case "agent_start":
      return [{ type: "agent.started", sessionId }];
    case "agent_end":
      return [{ type: "agent.ended", sessionId }];
    case "message_start":
      return [
        {
          type: "message.started",
          sessionId,
          messageId: messageId(event.message),
          role: event.message.role === "user" ? "user" : "assistant",
        },
      ];
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return [
          {
            type: "message.delta",
            sessionId,
            messageId: messageId(event.message),
            delta: event.assistantMessageEvent.delta,
          },
        ];
      }
      if (event.assistantMessageEvent.type === "thinking_delta") {
        return [
          {
            type: "thinking.delta",
            sessionId,
            messageId: messageId(event.message),
            delta: event.assistantMessageEvent.delta,
          },
        ];
      }
      return [];
    case "message_end":
      return [{ type: "message.completed", sessionId, messageId: messageId(event.message) }];
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

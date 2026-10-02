import { existsSync, readFileSync } from "node:fs";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { type AgentEventItem, appendAgentEvents } from "../../shared/agent-events";
import type {
  AgentEvent,
  AgentRunInfo,
  PromptImageAttachment,
  SkillSelection,
} from "../../shared/contracts";
import { sessionManagerFor } from "./agent-store";
import { toolResultContent } from "./pi-tool-result";

type MessagePresentation = {
  entryId: string;
  messageId: string;
  text: string;
  paths?: string[];
  skills?: SkillSelection[];
  attachments?: { path: string; mimeType: string; name?: string }[];
};

export function messagePresentations(manager: SessionManager): Map<string, MessagePresentation> {
  return new Map(
    manager
      .getEntries()
      .filter((entry) => entry.type === "custom" && entry.customType === "modus.message")
      .map((entry) => {
        const data = (entry as { data: MessagePresentation }).data;
        return [data.entryId, data];
      }),
  );
}

export function readAgentHistory(sessionId: string): {
  events: AgentEventItem[];
  runs: AgentRunInfo[];
} {
  const manager = sessionManagerFor(sessionId);
  if (!manager) return { events: [], runs: [] };
  const presentations = messagePresentations(manager);
  const events: AgentEventItem[] = [],
    runs: AgentRunInfo[] = [];
  let activeRun: AgentRunInfo | undefined;
  let sequence = 0;
  const emit = (event: AgentEvent, createdAt: string) =>
    events.push({ id: `history:${sequence++}`, event, createdAt });
  const settle = () => {
    if (!activeRun) return;
    if (!activeRun.completedAt) {
      const id = activeRun.id;
      const index = runs.findIndex((run) => run.id === id);
      if (index >= 0) runs.splice(index, 1);
      const eventIndex = events.findIndex(
        ({ event }) => event.type === "run.started" && event.runId === id,
      );
      if (eventIndex >= 0) events.splice(eventIndex, 1);
      activeRun = undefined;
      return;
    }
    if (activeRun.status === "failed")
      emit(
        {
          type: "run.failed",
          sessionId,
          runId: activeRun.id,
          message: activeRun.error ?? "Request failed",
        },
        activeRun.completedAt ?? activeRun.startedAt,
      );
    else if (activeRun.status === "cancelled")
      emit(
        { type: "run.cancelled", sessionId, runId: activeRun.id },
        activeRun.completedAt ?? activeRun.startedAt,
      );
    else
      emit(
        { type: "run.completed", sessionId, runId: activeRun.id },
        activeRun.completedAt ?? activeRun.startedAt,
      );
    activeRun = undefined;
  };
  for (const entry of manager.getBranch()) {
    if (entry.type === "compaction") {
      emit(
        {
          type: "compaction.ended",
          sessionId,
          reason: undefined,
          summary: entry.summary,
          aborted: false,
          willRetry: false,
        },
        entry.timestamp,
      );
      continue;
    }
    if (entry.type === "custom_message") {
      if (entry.display)
        emit(
          {
            type: "extension.notice",
            sessionId,
            message:
              typeof entry.content === "string"
                ? entry.content
                : entry.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("\n"),
            level: "info",
          },
          entry.timestamp,
        );
      continue;
    }
    if (entry.type === "branch_summary") {
      emit(
        { type: "extension.notice", sessionId, message: entry.summary, level: "info" },
        entry.timestamp,
      );
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "user") {
      settle();
      const presentation = presentations.get(entry.id);
      const messageId = presentation?.messageId ?? entry.id;
      const content =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");
      const attachments: PromptImageAttachment[] =
        typeof message.content === "string"
          ? []
          : message.content.filter((part) => part.type === "image");
      for (const image of presentation?.attachments ?? [])
        if (existsSync(image.path))
          attachments.push({
            type: "image",
            ...image,
            data: readFileSync(image.path).toString("base64"),
          });
      emit(
        {
          type: "message.started",
          sessionId,
          messageId,
          role: "user",
          ...(presentation?.paths?.length
            ? { contextItems: presentation.paths.map((path) => ({ type: "file" as const, path })) }
            : {}),
          ...(presentation?.skills?.length ? { skills: presentation.skills } : {}),
          ...(attachments.length ? { attachments } : {}),
        },
        entry.timestamp,
      );
      emit(
        { type: "message.delta", sessionId, messageId, delta: presentation?.text ?? content },
        entry.timestamp,
      );
      emit({ type: "message.completed", sessionId, messageId }, entry.timestamp);
      activeRun = {
        id: `run:${entry.id}`,
        sessionId,
        userMessageId: messageId,
        prompt: content,
        startedAt: entry.timestamp,
        status: "completed",
      };
      runs.push(activeRun);
      emit(
        {
          type: "run.started",
          sessionId,
          runId: activeRun.id,
          userMessageId: messageId,
          delivery: "normal",
        },
        entry.timestamp,
      );
    } else if (message.role === "assistant") {
      for (const [index, part] of message.content.entries()) {
        const messageId = `${entry.id}:${index}`;
        if (part.type === "text") {
          emit(
            { type: "message.started", sessionId, messageId, role: "assistant" },
            entry.timestamp,
          );
          emit({ type: "message.delta", sessionId, messageId, delta: part.text }, entry.timestamp);
          emit({ type: "message.completed", sessionId, messageId }, entry.timestamp);
        } else if (part.type === "thinking") {
          emit(
            { type: "thinking.delta", sessionId, messageId, delta: part.thinking },
            entry.timestamp,
          );
          emit({ type: "thinking.completed", sessionId, messageId }, entry.timestamp);
        } else if (part.type === "toolCall")
          emit(
            {
              type: "tool.started",
              sessionId,
              toolCallId: part.id,
              toolName: part.name,
              args: part.arguments,
            },
            entry.timestamp,
          );
      }
      if (activeRun) {
        activeRun.model = `${message.provider}/${message.model}`;
        if (message.stopReason === "toolUse") delete activeRun.completedAt;
        else activeRun.completedAt = entry.timestamp;
        activeRun.status =
          message.stopReason === "aborted"
            ? "cancelled"
            : message.stopReason === "error"
              ? "failed"
              : "completed";
        if (message.errorMessage) activeRun.error = message.errorMessage;
      }
    } else if (message.role === "bashExecution") {
      emit(
        {
          type: "tool.started",
          sessionId,
          toolCallId: entry.id,
          toolName: "bash",
          args: { command: message.command },
        },
        entry.timestamp,
      );
      emit(
        {
          type: "tool.ended",
          sessionId,
          toolCallId: entry.id,
          isError: message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0),
          output: message.output,
        },
        entry.timestamp,
      );
    } else if (message.role === "custom" && message.display) {
      emit(
        {
          type: "extension.notice",
          sessionId,
          message:
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n"),
          level: "info",
        },
        entry.timestamp,
      );
    } else if (message.role === "toolResult")
      emit(
        {
          type: "tool.ended",
          sessionId,
          toolCallId: message.toolCallId,
          isError: message.isError,
          ...toolResultContent(message),
        },
        entry.timestamp,
      );
  }
  settle();
  return { events, runs };
}

export function listAgentEvents(sessionId: string): AgentEventItem[] {
  return liveEvents.get(sessionId) ?? readAgentHistory(sessionId).events;
}

const liveEvents = new Map<string, AgentEventItem[]>();
export function seedAgentView(sessionId: string): void {
  liveEvents.set(
    sessionId,
    appendAgentEvents(readAgentHistory(sessionId).events, liveEvents.get(sessionId) ?? []),
  );
}
export function appendAgentView(event: AgentEvent): void {
  const current = liveEvents.get(event.sessionId) ?? [];
  liveEvents.set(
    event.sessionId,
    appendAgentEvents(current, [
      { id: crypto.randomUUID(), event, createdAt: new Date().toISOString() },
    ]),
  );
}
export function releaseAgentView(sessionId: string): void {
  liveEvents.delete(sessionId);
}

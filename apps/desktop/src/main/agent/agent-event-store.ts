import { randomUUID } from "node:crypto";
import type { AgentEvent, TodoItem } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type AgentEventRow = {
  id: string;
  payload_json: string;
  created_at: string;
};

type AgentRunPromptRow = {
  id: string;
  user_message_id: string | null;
  prompt: string;
  started_at: string;
};

type AgentEventItem = { id: string; event: AgentEvent; createdAt: string };

export function recordAgentEvent(event: AgentEvent): void {
  getDatabase()
    .prepare(
      `insert into agent_events (id, session_id, type, payload_json, created_at)
       values (?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      event.sessionId,
      event.type,
      JSON.stringify(event),
      new Date().toISOString(),
    );
}

/** Latest persisted to-do list of a session (rehydrates the todo tool store). */
export function getLatestSessionTodos(sessionId: string): TodoItem[] | undefined {
  const row = getDatabase()
    .prepare(
      `select payload_json from agent_events
       where session_id = ? and type = 'todos.updated'
       order by rowid desc
       limit 1`,
    )
    .get(sessionId) as { payload_json: string } | undefined;
  if (!row) {
    return undefined;
  }
  try {
    const event = JSON.parse(row.payload_json) as Extract<AgentEvent, { type: "todos.updated" }>;
    return Array.isArray(event.todos) ? event.todos : undefined;
  } catch {
    return undefined;
  }
}

export function listAgentEvents(
  sessionId: string,
): Array<{ id: string; event: AgentEvent; createdAt: string }> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `select id, payload_json, created_at
       from agent_events
       where session_id = ?
       order by created_at asc, rowid asc`,
    )
    .all(sessionId) as AgentEventRow[];
  const events = rows.map((row) => ({
    id: row.id,
    event: JSON.parse(row.payload_json) as AgentEvent,
    createdAt: row.created_at,
  }));
  const runs = db
    .prepare(
      `select id, user_message_id, prompt, started_at
       from agent_runs
       where session_id = ?
       order by started_at asc, rowid asc`,
    )
    .all(sessionId) as AgentRunPromptRow[];

  return backfillUserPromptEvents(sessionId, events, runs);
}

function backfillUserPromptEvents(
  sessionId: string,
  events: AgentEventItem[],
  runs: AgentRunPromptRow[],
): AgentEventItem[] {
  if (runs.length === 0) {
    return events;
  }

  const userMessageTextById = new Map<string, string>();
  for (const { event } of events) {
    if (event.type === "message.started" && event.role === "user") {
      userMessageTextById.set(event.messageId, userMessageTextById.get(event.messageId) ?? "");
      continue;
    }
    if (event.type === "message.delta" && userMessageTextById.has(event.messageId)) {
      userMessageTextById.set(
        event.messageId,
        `${userMessageTextById.get(event.messageId) ?? ""}${event.delta}`,
      );
    }
  }
  const backfilledByRunId = new Map<string, AgentEventItem[]>();

  for (const run of runs) {
    const messageId = run.user_message_id ?? `user:${run.id}`;
    if ((userMessageTextById.get(messageId) ?? "").trim()) {
      continue;
    }
    const createdAt = run.started_at;
    backfilledByRunId.set(run.id, [
      {
        id: `backfill:${run.id}:user:start`,
        event: { type: "message.started", sessionId, messageId, role: "user" },
        createdAt,
      },
      {
        id: `backfill:${run.id}:user:delta`,
        event: { type: "message.delta", sessionId, messageId, delta: run.prompt },
        createdAt,
      },
      {
        id: `backfill:${run.id}:user:completed`,
        event: { type: "message.completed", sessionId, messageId },
        createdAt,
      },
    ]);
  }

  if (backfilledByRunId.size === 0) {
    return events;
  }

  const result: AgentEventItem[] = [];
  for (const item of events) {
    const event = item.event;
    if (event.type === "run.started") {
      const userEvents = backfilledByRunId.get(event.runId);
      if (userEvents) {
        result.push(...userEvents);
        backfilledByRunId.delete(event.runId);
      }
    }
    result.push(item);
  }

  for (const userEvents of backfilledByRunId.values()) {
    result.push(...userEvents);
  }

  return result;
}

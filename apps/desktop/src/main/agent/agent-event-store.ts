import { randomUUID } from "node:crypto";
import type { AgentEvent } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type AgentEventRow = {
  id: string;
  payload_json: string;
};

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

export function listAgentEvents(sessionId: string): Array<{ id: string; event: AgentEvent }> {
  const rows = getDatabase()
    .prepare(
      `select id, payload_json
       from agent_events
       where session_id = ?
       order by created_at asc`,
    )
    .all(sessionId) as AgentEventRow[];

  return rows.map((row) => ({ id: row.id, event: JSON.parse(row.payload_json) as AgentEvent }));
}

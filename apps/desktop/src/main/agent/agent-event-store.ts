import { randomUUID } from "node:crypto";
import type { AgentEvent } from "../../shared/contracts";
import { getDatabase } from "../db/database";

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

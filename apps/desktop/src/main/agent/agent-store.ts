import { randomUUID } from "node:crypto";
import type { AgentSessionInfo } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type AgentSessionRow = {
  id: string;
  workspace_id: string;
  title: string;
  cwd: string;
  status: AgentSessionInfo["status"];
  created_at: string;
  updated_at: string;
};

function toSession(row: AgentSessionRow): AgentSessionInfo {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    cwd: row.cwd,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAgentSessionRecord(input: {
  workspaceId: string;
  title: string;
  cwd: string;
}): AgentSessionInfo {
  const now = new Date().toISOString();
  const session: AgentSessionInfo = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    title: input.title,
    cwd: input.cwd,
    status: "starting",
    createdAt: now,
    updatedAt: now,
  };

  getDatabase()
    .prepare(
      `insert into agent_sessions (id, workspace_id, title, cwd, status, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session.id,
      session.workspaceId,
      session.title,
      session.cwd,
      session.status,
      session.createdAt,
      session.updatedAt,
    );

  return session;
}

export function updateAgentSessionStatus(
  sessionId: string,
  status: AgentSessionInfo["status"],
): void {
  getDatabase()
    .prepare("update agent_sessions set status = ?, updated_at = ? where id = ?")
    .run(status, new Date().toISOString(), sessionId);
}

export function listAgentSessions(): AgentSessionInfo[] {
  const rows = getDatabase()
    .prepare(
      `select id, workspace_id, title, cwd, status, created_at, updated_at
       from agent_sessions
       order by updated_at desc`,
    )
    .all() as AgentSessionRow[];

  return rows.map(toSession);
}

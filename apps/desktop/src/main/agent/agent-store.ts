import { randomUUID } from "node:crypto";
import type { AgentSessionInfo } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type AgentSessionRow = {
  id: string;
  workspace_id: string;
  title: string;
  cwd: string;
  status: AgentSessionInfo["status"];
  runtime: "pi-sdk" | "pi-rpc";
  model: string | null;
  pi_session_id: string | null;
  pi_session_file: string | null;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
};

function toSession(row: AgentSessionRow): AgentSessionInfo {
  const session: AgentSessionInfo = {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    cwd: row.cwd,
    status: row.status,
    runtime: row.runtime,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.model !== null) {
    session.model = row.model;
  }
  if (row.pi_session_id !== null) {
    session.piSessionId = row.pi_session_id;
  }
  if (row.pi_session_file !== null) {
    session.piSessionFile = row.pi_session_file;
  }
  if (row.worktree_path !== null) {
    session.worktreePath = row.worktree_path;
  }

  return session;
}

export function createAgentSessionRecord(input: {
  workspaceId: string;
  title: string;
  cwd: string;
  runtime?: "pi-sdk" | "pi-rpc";
  model?: string;
  piSessionId?: string;
  piSessionFile?: string;
  worktreePath?: string;
}): AgentSessionInfo {
  const now = new Date().toISOString();
  const runtime = input.runtime ?? "pi-sdk";
  const session: AgentSessionInfo = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    title: input.title,
    cwd: input.cwd,
    status: "starting",
    runtime,
    createdAt: now,
    updatedAt: now,
  };

  if (input.model !== undefined) {
    session.model = input.model;
  }
  if (input.piSessionId !== undefined) {
    session.piSessionId = input.piSessionId;
  }
  if (input.piSessionFile !== undefined) {
    session.piSessionFile = input.piSessionFile;
  }
  if (input.worktreePath !== undefined) {
    session.worktreePath = input.worktreePath;
  }

  getDatabase()
    .prepare(
      `insert into agent_sessions (
        id, workspace_id, title, cwd, status, runtime, model, pi_session_id, pi_session_file,
        worktree_path, created_at, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session.id,
      session.workspaceId,
      session.title,
      session.cwd,
      session.status,
      runtime,
      session.model ?? null,
      session.piSessionId ?? null,
      session.piSessionFile ?? null,
      session.worktreePath ?? null,
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

export function updateAgentSessionMetadata(
  sessionId: string,
  metadata: Partial<
    Pick<AgentSessionInfo, "model" | "piSessionId" | "piSessionFile" | "worktreePath">
  >,
): AgentSessionInfo | undefined {
  const existing = getAgentSession(sessionId);
  if (!existing) {
    return undefined;
  }

  const next = { ...existing, ...metadata, updatedAt: new Date().toISOString() };
  getDatabase()
    .prepare(
      `update agent_sessions
       set model = ?, pi_session_id = ?, pi_session_file = ?, worktree_path = ?, updated_at = ?
       where id = ?`,
    )
    .run(
      next.model ?? null,
      next.piSessionId ?? null,
      next.piSessionFile ?? null,
      next.worktreePath ?? null,
      next.updatedAt,
      sessionId,
    );

  return next;
}

export function updateAgentSessionTitle(
  sessionId: string,
  title: string,
): AgentSessionInfo | undefined {
  const existing = getAgentSession(sessionId);
  if (!existing) {
    return undefined;
  }

  const next = { ...existing, title, updatedAt: new Date().toISOString() };
  getDatabase()
    .prepare("update agent_sessions set title = ?, updated_at = ? where id = ?")
    .run(next.title, next.updatedAt, sessionId);

  return next;
}

export function getAgentSession(sessionId: string): AgentSessionInfo | undefined {
  const row = getDatabase()
    .prepare(
      `select id, workspace_id, title, cwd, status, runtime, model, pi_session_id,
        pi_session_file, worktree_path, created_at, updated_at
       from agent_sessions
       where id = ?`,
    )
    .get(sessionId) as AgentSessionRow | undefined;

  return row ? toSession(row) : undefined;
}

export function listAgentSessions(): AgentSessionInfo[] {
  const rows = getDatabase()
    .prepare(
      `select id, workspace_id, title, cwd, status, runtime, model, pi_session_id,
        pi_session_file, worktree_path, created_at, updated_at
       from agent_sessions
       order by updated_at desc`,
    )
    .all() as AgentSessionRow[];

  return rows.map(toSession);
}

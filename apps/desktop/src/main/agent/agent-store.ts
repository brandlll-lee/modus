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
  pinned_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const SESSION_COLUMNS = `id, workspace_id, title, cwd, status, runtime, model, pi_session_id,
  pi_session_file, pinned_at, archived_at, created_at, updated_at`;

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
  if (row.pinned_at !== null) {
    session.pinnedAt = row.pinned_at;
  }
  if (row.archived_at !== null) {
    session.archivedAt = row.archived_at;
  }
  return session;
}

export function createAgentSessionRecord(input: {
  id?: string;
  workspaceId: string;
  title: string;
  cwd: string;
  runtime?: "pi-sdk" | "pi-rpc";
  model?: string;
  piSessionId?: string;
  piSessionFile?: string;
}): AgentSessionInfo {
  const now = new Date().toISOString();
  const runtime = input.runtime ?? "pi-sdk";
  const session: AgentSessionInfo = {
    id: input.id ?? randomUUID(),
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
  getDatabase()
    .prepare(
      `insert into agent_sessions (
        id, workspace_id, title, cwd, status, runtime, model, pi_session_id, pi_session_file,
        created_at, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      session.createdAt,
      session.updatedAt,
    );

  return session;
}

/**
 * Conversation activity heartbeat — the ONLY writer of `updated_at` after create.
 * Open/resume/status/metadata/pin/archive must never bump the sort key.
 */
export function touchAgentSession(sessionId: string): string {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("update agent_sessions set updated_at = ? where id = ?")
    .run(now, sessionId);
  return now;
}

export function updateAgentSessionStatus(
  sessionId: string,
  status: AgentSessionInfo["status"],
): void {
  getDatabase().prepare("update agent_sessions set status = ? where id = ?").run(status, sessionId);
}

export function updateAgentSessionMetadata(
  sessionId: string,
  metadata: Partial<Pick<AgentSessionInfo, "model" | "piSessionId" | "piSessionFile">>,
): AgentSessionInfo | undefined {
  const existing = getAgentSession(sessionId);
  if (!existing) {
    return undefined;
  }

  const next = { ...existing, ...metadata };
  getDatabase()
    .prepare(
      `update agent_sessions
       set model = ?, pi_session_id = ?, pi_session_file = ?
       where id = ?`,
    )
    .run(next.model ?? null, next.piSessionId ?? null, next.piSessionFile ?? null, sessionId);

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

  const next = { ...existing, title };
  getDatabase()
    .prepare("update agent_sessions set title = ? where id = ?")
    .run(next.title, sessionId);

  return next;
}

export function getAgentSession(sessionId: string): AgentSessionInfo | undefined {
  const row = getDatabase()
    .prepare(
      `select ${SESSION_COLUMNS}
       from agent_sessions
       where id = ?`,
    )
    .get(sessionId) as AgentSessionRow | undefined;

  return row ? toSession(row) : undefined;
}

export function listAgentSessions(options: { includeSessionId?: string } = {}): AgentSessionInfo[] {
  const rows = getDatabase()
    .prepare(
      `select ${SESSION_COLUMNS}
       from agent_sessions
       where archived_at is null
       order by pinned_at is null, pinned_at desc, updated_at desc`,
    )
    .all() as AgentSessionRow[];

  const sessions = rows.map(toSession);
  if (
    options.includeSessionId &&
    !sessions.some((session) => session.id === options.includeSessionId)
  ) {
    const included = getAgentSession(options.includeSessionId);
    if (included) {
      sessions.push(included);
    }
  }
  return sessions;
}

export function listArchivedAgentSessions(workspaceId: string): AgentSessionInfo[] {
  const rows = getDatabase()
    .prepare(
      `select ${SESSION_COLUMNS}
       from agent_sessions
       where workspace_id = ? and archived_at is not null
       order by archived_at desc`,
    )
    .all(workspaceId) as AgentSessionRow[];

  return rows.map(toSession);
}

export function setAgentSessionPinned(
  sessionId: string,
  pinned: boolean,
): AgentSessionInfo | undefined {
  getDatabase()
    .prepare("update agent_sessions set pinned_at = ? where id = ?")
    .run(pinned ? new Date().toISOString() : null, sessionId);
  return getAgentSession(sessionId);
}

export function setAgentSessionArchived(
  sessionId: string,
  archived: boolean,
): AgentSessionInfo | undefined {
  getDatabase()
    .prepare("update agent_sessions set archived_at = ? where id = ?")
    .run(archived ? new Date().toISOString() : null, sessionId);
  return getAgentSession(sessionId);
}

/**
 * Permanently removes a session and (via `on delete cascade`) its recorded
 * events and runs. Used by the explicit delete action.
 */
export function deleteAgentSession(sessionId: string): void {
  getDatabase().prepare("delete from agent_sessions where id = ?").run(sessionId);
}

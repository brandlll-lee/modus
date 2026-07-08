import { randomUUID } from "node:crypto";
import type { AgentSessionInfo, SubagentWorktreeInfo } from "../../shared/contracts";
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
  parent_session_id: string | null;
  subagent_task: string | null;
  subagent_type: string | null;
  subagent_readonly: number;
  subagent_worktree_path: string | null;
  subagent_worktree_branch: string | null;
  subagent_worktree_base_sha: string | null;
  subagent_integration_status: string | null;
  subagent_changed_files_json: string | null;
  subagent_conflict_files_json: string | null;
  pinned_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const SESSION_COLUMNS = `id, workspace_id, title, cwd, status, runtime, model, pi_session_id,
  pi_session_file, parent_session_id, subagent_task, subagent_type, subagent_readonly,
  subagent_worktree_path, subagent_worktree_branch, subagent_worktree_base_sha,
  subagent_integration_status, subagent_changed_files_json, subagent_conflict_files_json,
  pinned_at, archived_at, created_at, updated_at`;

function parseJsonArray(text: string | null): string[] | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : undefined;
  } catch {
    return undefined;
  }
}

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
  if (row.parent_session_id !== null) {
    session.parentSessionId = row.parent_session_id;
  }
  if (row.pinned_at !== null) {
    session.pinnedAt = row.pinned_at;
  }
  if (row.archived_at !== null) {
    session.archivedAt = row.archived_at;
  }
  if (row.subagent_task !== null) {
    session.subagentTask = row.subagent_task;
  }
  if (row.subagent_type !== null) {
    session.subagentType = row.subagent_type;
  }
  if (row.subagent_readonly !== 0) {
    session.subagentReadOnly = true;
  }
  if (
    row.subagent_worktree_path !== null &&
    row.subagent_worktree_branch !== null &&
    row.subagent_worktree_base_sha !== null
  ) {
    const integrationStatus = row.subagent_integration_status as
      | SubagentWorktreeInfo["integrationStatus"]
      | null;
    const changedFiles = parseJsonArray(row.subagent_changed_files_json);
    const conflictFiles = parseJsonArray(row.subagent_conflict_files_json);
    session.subagentWorktree = {
      path: row.subagent_worktree_path,
      branch: row.subagent_worktree_branch,
      baseSha: row.subagent_worktree_base_sha,
      integrationStatus: integrationStatus ?? "running",
      ...(changedFiles ? { changedFiles } : {}),
      ...(conflictFiles ? { conflictFiles } : {}),
    };
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
  parentSessionId?: string;
  subagentTask?: string;
  subagentType?: string;
  subagentReadOnly?: boolean;
  subagentWorktree?: SubagentWorktreeInfo;
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
  if (input.parentSessionId !== undefined) {
    session.parentSessionId = input.parentSessionId;
  }
  if (input.subagentTask !== undefined) {
    session.subagentTask = input.subagentTask;
  }
  if (input.subagentType !== undefined) {
    session.subagentType = input.subagentType;
  }
  if (input.subagentReadOnly !== undefined) {
    session.subagentReadOnly = input.subagentReadOnly;
  }
  if (input.subagentWorktree !== undefined) {
    session.subagentWorktree = input.subagentWorktree;
  }
  getDatabase()
    .prepare(
      `insert into agent_sessions (
        id, workspace_id, title, cwd, status, runtime, model, pi_session_id, pi_session_file,
        parent_session_id, subagent_task, subagent_type, subagent_readonly,
        subagent_worktree_path, subagent_worktree_branch, subagent_worktree_base_sha,
        subagent_integration_status, subagent_changed_files_json, subagent_conflict_files_json,
        created_at, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      session.parentSessionId ?? null,
      session.subagentTask ?? null,
      session.subagentType ?? null,
      session.subagentReadOnly ? 1 : 0,
      session.subagentWorktree?.path ?? null,
      session.subagentWorktree?.branch ?? null,
      session.subagentWorktree?.baseSha ?? null,
      session.subagentWorktree?.integrationStatus ?? null,
      session.subagentWorktree?.changedFiles
        ? JSON.stringify(session.subagentWorktree.changedFiles)
        : null,
      session.subagentWorktree?.conflictFiles
        ? JSON.stringify(session.subagentWorktree.conflictFiles)
        : null,
      session.createdAt,
      session.updatedAt,
    );

  return session;
}

export function updateAgentSessionWorktree(
  sessionId: string,
  worktree: SubagentWorktreeInfo | undefined,
): AgentSessionInfo | undefined {
  const existing = getAgentSession(sessionId);
  if (!existing) {
    return undefined;
  }

  getDatabase()
    .prepare(
      `update agent_sessions
       set subagent_worktree_path = ?,
           subagent_worktree_branch = ?,
           subagent_worktree_base_sha = ?,
           subagent_integration_status = ?,
           subagent_changed_files_json = ?,
           subagent_conflict_files_json = ?,
           updated_at = ?
       where id = ?`,
    )
    .run(
      worktree?.path ?? null,
      worktree?.branch ?? null,
      worktree?.baseSha ?? null,
      worktree?.integrationStatus ?? null,
      worktree?.changedFiles ? JSON.stringify(worktree.changedFiles) : null,
      worktree?.conflictFiles ? JSON.stringify(worktree.conflictFiles) : null,
      new Date().toISOString(),
      sessionId,
    );

  return getAgentSession(sessionId);
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
  metadata: Partial<Pick<AgentSessionInfo, "model" | "piSessionId" | "piSessionFile">>,
): AgentSessionInfo | undefined {
  const existing = getAgentSession(sessionId);
  if (!existing) {
    return undefined;
  }

  const next = { ...existing, ...metadata, updatedAt: new Date().toISOString() };
  getDatabase()
    .prepare(
      `update agent_sessions
       set model = ?, pi_session_id = ?, pi_session_file = ?, updated_at = ?
       where id = ?`,
    )
    .run(
      next.model ?? null,
      next.piSessionId ?? null,
      next.piSessionFile ?? null,
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
       where workspace_id = ? and parent_session_id is null and archived_at is not null
       order by archived_at desc`,
    )
    .all(workspaceId) as AgentSessionRow[];

  return rows.map(toSession);
}

export function listSubagentSessions(parentSessionId: string): AgentSessionInfo[] {
  const rows = getDatabase()
    .prepare(
      `select ${SESSION_COLUMNS}
       from agent_sessions
       where parent_session_id = ?
       order by created_at asc, rowid asc`,
    )
    .all(parentSessionId) as AgentSessionRow[];

  return rows.map(toSession);
}

export function setAgentSessionPinned(
  sessionId: string,
  pinned: boolean,
): AgentSessionInfo | undefined {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("update agent_sessions set pinned_at = ?, updated_at = ? where id = ?")
    .run(pinned ? now : null, now, sessionId);
  return getAgentSession(sessionId);
}

export function setAgentSessionArchived(
  sessionId: string,
  archived: boolean,
): AgentSessionInfo | undefined {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("update agent_sessions set archived_at = ?, updated_at = ? where id = ?")
    .run(archived ? now : null, now, sessionId);
  return getAgentSession(sessionId);
}

/**
 * Permanently removes a session and (via `on delete cascade`) its recorded
 * events and runs. Used by the explicit delete action.
 */
export function deleteAgentSession(sessionId: string): void {
  getDatabase().prepare("delete from agent_sessions where id = ?").run(sessionId);
}

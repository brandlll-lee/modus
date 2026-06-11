import { randomUUID } from "node:crypto";
import type { AgentRunInfo, AgentRunStatus } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type AgentRunRow = {
  id: string;
  session_id: string;
  user_message_id: string | null;
  prompt: string;
  status: AgentRunStatus;
  model: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
};

function toRun(row: AgentRunRow): AgentRunInfo {
  const run: AgentRunInfo = {
    id: row.id,
    sessionId: row.session_id,
    prompt: row.prompt,
    status: row.status,
    startedAt: row.started_at,
  };
  if (row.user_message_id !== null) run.userMessageId = row.user_message_id;
  if (row.model !== null) run.model = row.model;
  if (row.completed_at !== null) run.completedAt = row.completed_at;
  if (row.error !== null) run.error = row.error;
  return run;
}

export function createAgentRun(input: {
  sessionId: string;
  prompt: string;
  userMessageId?: string;
  model?: string;
  /**
   * PI session-tree leaf id captured right before this prompt ("root" when the
   * tree was empty). Anchors `agent:rollback` so editing the message can rewind
   * the conversation context to exactly this point.
   */
  piLeafBefore?: string;
}): AgentRunInfo {
  const run: AgentRunInfo = {
    id: randomUUID(),
    sessionId: input.sessionId,
    prompt: input.prompt,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  if (input.userMessageId !== undefined) run.userMessageId = input.userMessageId;
  if (input.model !== undefined) run.model = input.model;

  getDatabase()
    .prepare(
      `insert into agent_runs (
        id, session_id, user_message_id, prompt, status, model, started_at, completed_at, error,
        pi_leaf_before
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.sessionId,
      run.userMessageId ?? null,
      run.prompt,
      run.status,
      run.model ?? null,
      run.startedAt,
      null,
      null,
      input.piLeafBefore ?? null,
    );

  return run;
}

export function updateAgentRunStatus(
  runId: string,
  status: AgentRunStatus,
  error?: string,
): AgentRunInfo | undefined {
  const completedAt = status === "running" ? null : new Date().toISOString();
  getDatabase()
    .prepare("update agent_runs set status = ?, completed_at = ?, error = ? where id = ?")
    .run(status, completedAt, error ?? null, runId);
  return getAgentRun(runId);
}

export function getAgentRun(runId: string): AgentRunInfo | undefined {
  const row = getDatabase()
    .prepare(
      `select id, session_id, user_message_id, prompt, status, model, started_at, completed_at, error
       from agent_runs
       where id = ?`,
    )
    .get(runId) as AgentRunRow | undefined;
  return row ? toRun(row) : undefined;
}

export function getActiveAgentRun(sessionId: string): AgentRunInfo | undefined {
  const row = getDatabase()
    .prepare(
      `select id, session_id, user_message_id, prompt, status, model, started_at, completed_at, error
       from agent_runs
       where session_id = ? and status in ('running', 'blocked')
       order by started_at desc
       limit 1`,
    )
    .get(sessionId) as AgentRunRow | undefined;
  return row ? toRun(row) : undefined;
}

export function listAgentRuns(sessionId: string): AgentRunInfo[] {
  const rows = getDatabase()
    .prepare(
      `select id, session_id, user_message_id, prompt, status, model, started_at, completed_at, error
       from agent_runs
       where session_id = ?
       order by started_at asc`,
    )
    .all(sessionId) as AgentRunRow[];
  return rows.map(toRun);
}

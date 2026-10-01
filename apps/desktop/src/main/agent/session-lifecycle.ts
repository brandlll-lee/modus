import { join } from "node:path";
import { app } from "electron";
import { denyPendingQuestionRequestsForSession } from "../interaction/question-broker";
import { denyPendingPermissionRequestsForSession } from "../permissions/permission-broker";
import { deleteSessionPlan } from "../plan/plan-store";
import {
  deleteAgentSession,
  getAgentSession,
  listAgentSessions,
  listArchivedAgentSessions,
  setAgentSessionArchived,
} from "./agent-store";
import { deleteSessionCheckpoints } from "./checkpoint-service";
import { getAgentRuntime } from "./runtime-registry";

/**
 * Fully delete one agent session: stop+drop its live runtime, release the
 * checkpoint keep-alive, cancel any blocked interactive requests, then delete
 * the record (events/runs/checkpoints cascade via FK). This is the single
 * authoritative teardown — reused by single-session delete and by
 * workspace-level "Delete chats" / "Remove project" so they can never leave
 * orphaned runtimes or checkpoints behind.
 */
export async function removeAgentSession(sessionId: string): Promise<void> {
  await getAgentRuntime().dispose(sessionId);
  const session = getAgentSession(sessionId);
  if (session) {
    await deleteSessionCheckpoints(sessionId, session.cwd).catch(() => {});
  }
  denyPendingPermissionRequestsForSession(sessionId, "Session deleted");
  denyPendingQuestionRequestsForSession(sessionId);
  deleteSessionPlan(join(app.getPath("userData"), "plans"), sessionId);
  deleteAgentSession(sessionId);
}

export async function archiveWorkspaceSessions(workspaceId: string): Promise<number> {
  const sessions = listAgentSessions().filter((session) => session.workspaceId === workspaceId);
  for (const session of sessions) {
    setAgentSessionArchived(session.id, true);
  }
  return sessions.length;
}

/** Permanently delete every session belonging to a workspace. Returns the count removed. */
export async function deleteWorkspaceSessions(workspaceId: string): Promise<number> {
  const sessions = [...listAgentSessions(), ...listArchivedAgentSessions(workspaceId)].filter(
    (session) => session.workspaceId === workspaceId,
  );
  for (const session of sessions) {
    await removeAgentSession(session.id);
  }
  return sessions.length;
}

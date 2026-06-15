import { denyPendingQuestionRequestsForSession } from "../interaction/question-broker";
import { denyPendingPermissionRequestsForSession } from "../permissions/permission-broker";
import { deleteAgentSession, getAgentSession, listAgentSessions } from "./agent-store";
import { deleteSessionCheckpoints } from "./checkpoint-service";
import { getAgentRuntime } from "./runtime-registry";

/**
 * Fully tear down one agent session: stop+drop its live runtime, release the
 * checkpoint keep-alive, cancel any blocked interactive requests, then delete
 * the record (events/runs/checkpoints cascade via FK). This is the single
 * authoritative teardown — reused by single-session archive and by
 * workspace-level "Archive chats" / "Remove project" so they can never leave
 * orphaned runtimes or checkpoints behind.
 */
export async function archiveAgentSession(sessionId: string): Promise<void> {
  await getAgentRuntime().dispose(sessionId);
  const session = getAgentSession(sessionId);
  if (session) {
    await deleteSessionCheckpoints(sessionId, session.cwd).catch(() => {});
  }
  denyPendingPermissionRequestsForSession(sessionId, "Session archived");
  denyPendingQuestionRequestsForSession(sessionId);
  deleteAgentSession(sessionId);
}

/** Archive every session belonging to a workspace. Returns the count removed. */
export async function archiveWorkspaceSessions(workspaceId: string): Promise<number> {
  const sessions = listAgentSessions().filter((session) => session.workspaceId === workspaceId);
  for (const session of sessions) {
    await archiveAgentSession(session.id);
  }
  return sessions.length;
}

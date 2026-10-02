import { denyPendingQuestionRequestsForSession } from "../interaction/question-broker";
import {
  deleteAgentSession,
  listAgentSessions,
  listArchivedAgentSessions,
  setAgentSessionArchived,
} from "./agent-store";
import { getAgentRuntime } from "./runtime-registry";

export async function removeAgentSession(sessionId: string): Promise<void> {
  await getAgentRuntime().dispose(sessionId);
  denyPendingQuestionRequestsForSession(sessionId);
  deleteAgentSession(sessionId);
}

export async function archiveWorkspaceSessions(workspaceId: string): Promise<number> {
  const sessions = listAgentSessions().filter((session) => session.workspaceId === workspaceId);
  for (const session of sessions) {
    setAgentSessionArchived(session.id, true);
  }
  return sessions.length;
}

export async function deleteWorkspaceSessions(workspaceId: string): Promise<number> {
  const sessions = [...listAgentSessions(), ...listArchivedAgentSessions(workspaceId)].filter(
    (session) => session.workspaceId === workspaceId,
  );
  for (const session of sessions) {
    await removeAgentSession(session.id);
  }
  return sessions.length;
}

import type { SessionDeletionResult } from "../../shared/contracts";
import { denyPendingQuestionRequestsForSession } from "../interaction/question-broker";
import { getActiveAgentRun } from "./agent-run-store";
import { forgetAgentSession, getAgentSession, listAgentSessions } from "./agent-store";
import { isExtensionCommandActive } from "./extension-ui";
import { getAgentRuntime } from "./runtime-registry";
import { deleteSessionFile } from "./session-file";
import { assertConfigurationReady, sessionResources } from "./session-resources";

function assertSessionIdle(sessionId: string): void {
  assertConfigurationReady();
  const session = sessionResources().find(({ id }) => id === sessionId)?.session;
  if (
    getActiveAgentRun(sessionId) ||
    (session && (!session.isIdle || isExtensionCommandActive(session)))
  )
    throw new Error("Wait for the agent to finish before deleting its session.");
}

export async function removeAgentSession(sessionId: string): Promise<SessionDeletionResult> {
  assertSessionIdle(sessionId);
  const info = getAgentSession(sessionId);
  if (!info?.piSessionFile) throw new Error("Session file is not available.");
  await getAgentRuntime().dispose(sessionId);
  denyPendingQuestionRequestsForSession(sessionId);
  const result = await deleteSessionFile(info.piSessionFile);
  forgetAgentSession(sessionId);
  return result;
}

export async function deleteWorkspaceSessions(
  workspaceId: string,
): Promise<SessionDeletionResult[]> {
  const sessions = listAgentSessions().filter((session) => session.workspaceId === workspaceId);
  for (const session of sessions) assertSessionIdle(session.id);
  const results: SessionDeletionResult[] = [];
  for (const session of sessions) results.push(await removeAgentSession(session.id));
  return results;
}

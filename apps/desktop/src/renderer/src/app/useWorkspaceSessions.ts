import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSessionInfo, WorkspaceInfo } from "../../../shared/contracts";
import { deriveSessionTitle } from "../../../shared/session-title";

export function useWorkspaceSessions(setSettingsOpen: (open: boolean) => void) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [agentSessions, setAgentSessions] = useState<AgentSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [sessionCreateError, setSessionCreateError] = useState<string | undefined>();
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const activeWorkspaceRef = useRef<WorkspaceInfo | null>(null);
  const refreshRef = useRef<Promise<void> | undefined>(undefined);
  const refreshVersionRef = useRef(0);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  const refreshSessions = useCallback((): Promise<void> => {
    refreshVersionRef.current++;
    if (refreshRef.current) return refreshRef.current;
    const refresh = async (): Promise<void> => {
      let version: number;
      do {
        version = refreshVersionRef.current;
        const sessions = await window.modus.agent.list({
          includeSessionId: activeSessionIdRef.current,
        });
        if (version === refreshVersionRef.current) setAgentSessions(sessions);
      } while (version !== refreshVersionRef.current);
    };
    refreshRef.current = refresh().finally(() => {
      refreshRef.current = undefined;
    });
    return refreshRef.current;
  }, []);

  const updateSessionTitle = useCallback((sessionId: string, title: string): void => {
    setAgentSessions((sessions) =>
      sessions.map((session) => (session.id === sessionId ? { ...session, title } : session)),
    );
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    if (!agentSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(undefined);
    }
  }, [activeSessionId, agentSessions]);

  const activeSession = useMemo(
    () => agentSessions.find((session) => session.id === activeSessionId),
    [activeSessionId, agentSessions],
  );
  const rootSessions = useMemo(
    () => agentSessions.filter((session) => !session.archivedAt),
    [agentSessions],
  );

  async function openWorkspace(): Promise<void> {
    const workspace = await window.modus.workspace.open();
    if (!workspace) {
      return;
    }
    setActiveWorkspace(workspace);
    setWorkspaces(await window.modus.workspace.list());
    await refreshSessions();
  }

  async function createSession(
    workspace: WorkspaceInfo | null,
    model: string,
    prompt: string,
  ): Promise<AgentSessionInfo | null> {
    if (!workspace) {
      return null;
    }
    if (!model) {
      setSettingsOpen(true);
      setSessionCreateError("No model is configured. Connect a provider in Settings first.");
      return null;
    }
    try {
      const session = await window.modus.agent.create({
        workspaceId: workspace.id,
        cwd: workspace.rootPath,
        ...(model ? { model } : {}),
        title: deriveSessionTitle(prompt),
      });
      refreshVersionRef.current++;
      setSessionCreateError(undefined);
      setActiveWorkspace(workspace);
      setAgentSessions((current) => {
        const exists = current.some((item) => item.id === session.id);
        return exists
          ? current.map((item) => (item.id === session.id ? session : item))
          : [session, ...current];
      });
      setActiveSessionId(session.id);
      return session;
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  function selectSession(session: AgentSessionInfo): void {
    setSessionCreateError(undefined);
    setSettingsOpen(false);
    setActiveWorkspace(
      workspaces.find((workspace) => workspace.id === session.workspaceId) ?? activeWorkspace,
    );
    setAgentSessions((current) => {
      const exists = current.some((item) => item.id === session.id);
      return exists
        ? current.map((item) => (item.id === session.id ? session : item))
        : [session, ...current];
    });
    setActiveSessionId(session.id);
  }

  function openNewChat(workspace?: WorkspaceInfo | null): void {
    if (workspace !== undefined) {
      setActiveWorkspace(workspace);
    }
    setSessionCreateError(undefined);
    setSettingsOpen(false);
    setActiveSessionId(undefined);
  }

  async function pinSession(session: AgentSessionInfo, pinned: boolean): Promise<void> {
    try {
      const updated = await window.modus.agent.pin({ id: session.id, pinned });
      if (updated) {
        setAgentSessions((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      return;
    }
    await refreshSessions();
  }

  async function archiveSession(session: AgentSessionInfo): Promise<void> {
    try {
      await window.modus.agent.archive(session.id);
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      return;
    }
    await refreshSessions();
  }

  async function restoreSession(session: AgentSessionInfo): Promise<void> {
    try {
      await window.modus.agent.restore(session.id);
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      return;
    }
    await refreshSessions();
  }

  async function deleteSession(session: AgentSessionInfo): Promise<void> {
    try {
      await window.modus.agent.delete(session.id);
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (activeSessionIdRef.current === session.id) {
      setActiveSessionId(undefined);
    }
    await refreshSessions();
  }

  /* ── Project (workspace) actions — sidebar "..." menu ──────────────────── */

  async function pinProject(id: string, pinned: boolean): Promise<void> {
    setWorkspaces(await window.modus.workspace.pin({ id, pinned }));
  }

  async function renameProject(id: string, displayName: string): Promise<void> {
    setWorkspaces(await window.modus.workspace.rename({ id, displayName }));
    setActiveWorkspace((current) =>
      current && current.id === id ? { ...current, displayName } : current,
    );
  }

  async function archiveProjectChats(id: string): Promise<void> {
    await window.modus.workspace.archiveChats(id);
    await refreshSessions();
  }

  async function deleteProjectChats(id: string): Promise<void> {
    await window.modus.workspace.deleteChats(id);
    if (activeWorkspaceRef.current?.id === id) {
      setActiveSessionId(undefined);
    }
    await refreshSessions();
  }

  async function removeProject(id: string): Promise<void> {
    const next = await window.modus.workspace.remove(id);
    setWorkspaces(next);
    if (activeWorkspaceRef.current?.id === id) {
      setActiveWorkspace(next[0] ?? null);
      setActiveSessionId(undefined);
    }
    await refreshSessions();
  }

  async function revealProject(id: string): Promise<void> {
    await window.modus.workspace.reveal(id).catch(() => {});
  }

  return {
    workspaces,
    setWorkspaces,
    activeWorkspace,
    setActiveWorkspace,
    activeWorkspaceRef,
    agentSessions,
    setAgentSessions,
    activeSessionId,
    setActiveSessionId,
    activeSessionIdRef,
    activeSession,
    rootSessions,
    refreshSessions,
    updateSessionTitle,
    sessionCreateError,
    setSessionCreateError,
    openWorkspace,
    createSession,
    selectSession,
    openNewChat,
    pinSession,
    archiveSession,
    restoreSession,
    deleteSession,
    pinProject,
    renameProject,
    archiveProjectChats,
    deleteProjectChats,
    removeProject,
    revealProject,
  };
}

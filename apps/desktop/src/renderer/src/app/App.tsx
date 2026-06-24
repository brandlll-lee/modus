import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  IconBrandVisualStudio,
  IconCheck,
  IconChevronDown,
  IconCircles,
  IconDeviceLaptop,
  IconFolder,
  IconFolderPlus,
  IconGitBranch,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconListDetails,
  IconSettings,
  IconSourceCode,
  IconVersions,
} from "@tabler/icons-react";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SecurityState } from "../../../preload/types";
import type {
  AgentEvent,
  AgentMode,
  AgentSessionInfo,
  BrowserEvent,
  ContextItem,
  ContextUsageInfo,
  FileDiff,
  ModelInfo,
  ModelSettingsState,
  PlanRef,
  PromptDelivery,
  PromptImageAttachment,
  SkillSelection,
  WorkspaceInfo,
} from "../../../shared/contracts";
import modusLogo from "../assets/modus-logo.png";
import { SIDEBAR_MIN_WIDTH, Sidebar } from "../components/Sidebar";
import { ImageViewerProvider } from "../components/ui/ImageViewer";
import { ModusBot } from "../components/ui/ModusBot";
import { NativeSurfaceProvider } from "../components/ui/nativeSurface";
import { ToolbarButton } from "../components/ui/ToolbarButton";
import { TooltipProvider } from "../components/ui/Tooltip";
import {
  AgentEventHub,
  type AgentEventItem,
  affectsActivity,
  optimisticUserPromptEvents,
  reduceActivity,
  type SessionActivity,
} from "../features/agent/agentEventHub";
import { ChatPane, type ChatPaneHandle } from "../features/agent/ChatPane";
import { Composer } from "../features/composer/Composer";
import { BranchSwitcher } from "../features/git/BranchSwitcher";
import { INSPECTOR_MIN_WIDTH, Inspector } from "../features/inspector/Inspector";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { cn } from "../lib/cn";
import { useGitBranch } from "../lib/useGitBranch";

/**
 * Floor the main column keeps no matter how wide the side panels get. The
 * sidebar/inspector resize (and any programmatic width change) is clamped so
 * this is always reserved — the chat can't be crushed to an unreadable sliver.
 */
const MAIN_MIN_WIDTH = 480;

export function App() {
  const [securityState, setSecurityState] = useState<SecurityState | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [agentSessions, setAgentSessions] = useState<AgentSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [initialEventsBySession, setInitialEventsBySession] = useState<
    Record<string, AgentEventItem[]>
  >({});
  const [activityBySession, setActivityBySession] = useState<Record<string, SessionActivity>>({});
  const [contextUsageBySession, setContextUsageBySession] = useState<
    Record<string, ContextUsageInfo>
  >({});
  const [heroContextItems, setHeroContextItems] = useState<ContextItem[]>([]);
  // Composer mode for the hero (new-chat) screen — controlled so the "Plan New
  // Idea" pill can start a session straight in plan mode.
  const [heroMode, setHeroMode] = useState<AgentMode>("build");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [modelSettings, setModelSettings] = useState<ModelSettingsState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(384);
  const [inspectorTab, setInspectorTab] = useState("changes");
  const [reviewCwd, setReviewCwd] = useState<string | undefined>();
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | undefined>();
  // Plans are scoped per session (the authoritative key), so switching sessions
  // shows that session's own plan — never the last one any session emitted.
  const [activePlanBySession, setActivePlanBySession] = useState<Record<string, PlanRef>>({});
  // Each distinct plan auto-opens the Plan tab exactly once (by content hash);
  // re-opening a session or a build-status change never force-switches the tab.
  const openedPlanHashesRef = useRef<Set<string>>(new Set());
  // Imperative handle to the active pane so the Plan panel's Build button runs
  // the same build path as the Review card.
  const chatPaneRef = useRef<ChatPaneHandle>(null);
  const [environmentStats, setEnvironmentStats] = useState({ added: 0, removed: 0 });
  const [sessionCreateError, setSessionCreateError] = useState<string | undefined>();
  const [layoutWidth, setLayoutWidth] = useState(0);

  const hubRef = useRef(new AgentEventHub());
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const activeWorkspaceRef = useRef<WorkspaceInfo | null>(null);
  const reviewScopeRef = useRef<{
    sessionId: string | undefined;
    workspaceId: string | undefined;
  }>({ sessionId: undefined, workspaceId: undefined });
  const layoutRowRef = useRef<HTMLDivElement>(null);

  // Track the panel row's live width so side-panel widths can be clamped to keep
  // the main column at least MAIN_MIN_WIDTH (responsive to window + panel state).
  useEffect(() => {
    const row = layoutRowRef.current;
    if (!row) {
      return;
    }
    setLayoutWidth(row.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        setLayoutWidth(width);
      }
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  // When the agent starts driving the browser (an agent-initiated navigation),
  // auto-reveal the browser panel for the active workspace if it isn't already
  // showing. Idempotent — no-op when the panel is open on the browser tab; only
  // user/agent address-bar navigations without the agent flag are ignored.
  useEffect(() => {
    if (!window.modus) {
      return;
    }
    return window.modus.browser.onEvent((event: BrowserEvent) => {
      if (
        event.type === "browser.agent-activity" &&
        event.workspaceId === activeWorkspaceRef.current?.id
      ) {
        setInspectorTab("browser");
        setInspectorOpen(true);
      }
    });
  }, []);

  const refreshSessions = useCallback(async (): Promise<void> => {
    setAgentSessions(await window.modus.agent.list());
  }, []);

  function publishLocalAgentEvent(event: AgentEvent): void {
    hubRef.current.publish({
      id: `local:${Date.now()}:${crypto.randomUUID()}`,
      event,
      createdAt: new Date().toISOString(),
    });
  }

  const refreshModelSettings = useCallback(async (): Promise<void> => {
    const settings = await window.modus.model.settings();
    setModelSettings(settings);
    setModels(settings.models);
    setModel((current) => {
      if (current && settings.models.some((item: ModelInfo) => item.id === current)) {
        return current;
      }
      return settings.defaultModel ?? settings.models[0]?.id ?? "";
    });
  }, []);

  /* ── Global event intake: one IPC listener feeds the active chat + sidebar ── */
  useEffect(() => {
    if (!window.modus) {
      return;
    }
    void window.modus.app.securityState().then(setSecurityState);
    void window.modus.workspace.list().then((items: WorkspaceInfo[]) => {
      setWorkspaces(items);
      setActiveWorkspace(items[0] ?? null);
    });
    void refreshSessions();
    void refreshModelSettings();

    const unsubscribe = window.modus.agent.onEvent((event: AgentEvent) => {
      if (event.type === "context.updated") {
        setContextUsageBySession((current) => ({
          ...current,
          [event.sessionId]: event.usage,
        }));
        return;
      }

      hubRef.current.publish({
        id: `${Date.now()}:${crypto.randomUUID()}`,
        event,
        createdAt: new Date().toISOString(),
      });

      if (affectsActivity(event)) {
        const watched = activeSessionIdRef.current === event.sessionId;
        setActivityBySession((current) => {
          const next = reduceActivity(current[event.sessionId], event, watched);
          if (next === current[event.sessionId]) {
            return current;
          }
          return { ...current, [event.sessionId]: next };
        });
      }

      if (
        event.type === "agent.started" ||
        event.type === "agent.ended" ||
        event.type === "message.completed" ||
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled" ||
        event.type === "run.blocked" ||
        event.type === "subagent.started" ||
        event.type === "subagent.updated"
      ) {
        void refreshSessions();
      }
    });

    // System notification click → surface that session in the chat view.
    const unsubscribeFocus = window.modus.agent.onFocusSession((sessionId: string) => {
      setActiveSessionId(sessionId);
    });

    return () => {
      unsubscribe();
      unsubscribeFocus();
    };
  }, [refreshModelSettings, refreshSessions]);

  // The open session is "watched": its unread flag clears.
  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    setActivityBySession((current) => {
      const activity = current[activeSessionId];
      if (!activity?.unread) {
        return current;
      }
      return { ...current, [activeSessionId]: { ...activity, unread: false } };
    });
  }, [activeSessionId]);

  // Drop the active session if it was archived elsewhere.
  useEffect(() => {
    if (activeSessionId && !agentSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(undefined);
    }
  }, [activeSessionId, agentSessions]);

  const activeSession = useMemo(
    () => agentSessions.find((session) => session.id === activeSessionId),
    [activeSessionId, agentSessions],
  );
  const rootSessions = useMemo(
    () => agentSessions.filter((session) => !session.parentSessionId),
    [agentSessions],
  );

  /* ── Session lifecycle ───────────────────────────────────────────────── */

  async function openWorkspace(): Promise<void> {
    const workspace = await window.modus.workspace.open();
    if (!workspace) {
      return;
    }
    setActiveWorkspace(workspace);
    setWorkspaces(await window.modus.workspace.list());
    await refreshSessions();
  }

  async function createSession(workspace: WorkspaceInfo | null): Promise<AgentSessionInfo | null> {
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
        title: "New chat",
      });
      setSessionCreateError(undefined);
      setActiveWorkspace(workspace);
      setAgentSessions((current) => {
        const exists = current.some((item) => item.id === session.id);
        return exists
          ? current.map((item) => (item.id === session.id ? session : item))
          : [session, ...current];
      });
      setActiveSessionId(session.id);
      void refreshSessions();
      return session;
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  function selectSession(session: AgentSessionInfo): void {
    setSessionCreateError(undefined);
    setSettingsOpen(false);
    setActiveWorkspace(
      workspaces.find((workspace) => workspace.id === session.workspaceId) ?? activeWorkspace,
    );
    setActiveSessionId(session.id);
  }

  function openSubagent(childSessionId: string): void {
    setSelectedSubagentId(childSessionId);
    setInspectorTab("subagents");
    setInspectorOpen(true);
  }

  function openReview(cwd?: string): void {
    setReviewCwd(cwd);
    setInspectorTab("changes");
    setInspectorOpen(true);
  }

  const buildActivePlan = useCallback(() => {
    chatPaneRef.current?.buildActivePlan();
  }, []);

  const rememberActivePlan = useCallback(
    (plan: PlanRef) => {
      const key = plan.sessionId ?? activeSessionId ?? plan.id;
      setActivePlanBySession((current) => (current[key] === plan ? current : { [key]: plan }));
    },
    [activeSessionId],
  );

  const handleChatPlanUpdated = useCallback(
    (plan: PlanRef) => {
      rememberActivePlan(plan);
      if (!openedPlanHashesRef.current.has(plan.hash)) {
        openedPlanHashesRef.current.add(plan.hash);
        setInspectorTab("plan");
        setInspectorOpen(true);
      }
    },
    [rememberActivePlan],
  );

  /**
   * Open the new-chat hero (Figure 1). The session row is created lazily by the
   * first prompt (`submitHeroPrompt`), so "New chat" never spawns an empty
   * session — it just returns to the hero, optionally switching workspace first.
   */
  function openNewChat(workspace?: WorkspaceInfo | null): void {
    if (workspace !== undefined) {
      setActiveWorkspace(workspace);
    }
    setSessionCreateError(undefined);
    setSettingsOpen(false);
    setActiveSessionId(undefined);
  }

  async function archiveSession(session: AgentSessionInfo): Promise<void> {
    try {
      await window.modus.agent.delete(session.id);
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      return;
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

  /** Hero composer: create the session, open its pane, fire the first prompt. */
  async function submitHeroPrompt(
    message: string,
    context: ContextItem[],
    _delivery?: PromptDelivery,
    attachments?: PromptImageAttachment[],
    skills?: SkillSelection[],
    mode?: AgentMode,
  ): Promise<void> {
    if (!message.trim()) {
      return;
    }
    const session = await createSession(activeWorkspace);
    if (!session) {
      return;
    }
    const userMessageId = `local-user:${crypto.randomUUID()}`;
    setInitialEventsBySession((current) => ({
      ...current,
      [session.id]: optimisticUserPromptEvents({
        sessionId: session.id,
        userMessageId,
        message,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
      }),
    }));
    setHeroContextItems([]);
    void window.modus.agent
      .prompt({
        context,
        delivery: "normal",
        sessionId: session.id,
        message,
        userMessageId,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
        ...(mode ? { mode } : {}),
      })
      .then(() => refreshSessions())
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setSessionCreateError(errorMessage);
        publishLocalAgentEvent({
          type: "runtime.error",
          sessionId: session.id,
          message: errorMessage,
        });
        publishLocalAgentEvent({
          type: "session.status",
          sessionId: session.id,
          status: { type: "idle" },
        });
      });
  }

  async function changeDefaultModel(nextModel: string): Promise<void> {
    if (!nextModel) {
      return;
    }
    setModel(nextModel);
    await window.modus.model.setDefault(nextModel);
  }

  async function updateModelThinking(modelId: string, thinkingVariant: string): Promise<void> {
    await window.modus.model.updateConfig({ model: modelId, thinkingVariant });
    await window.modus.model.setDefault(modelId);
    await refreshModelSettings();
    setModel(modelId);
  }

  const cycleModel = useCallback(
    async (direction: "forward" | "backward"): Promise<void> => {
      const next = await window.modus.agent.cycleModel({
        direction,
        sessionId: activeSession?.id,
      });
      setModel(next.id);
      void refreshSessions();
    },
    [activeSession?.id, refreshSessions],
  );

  useEffect(() => {
    function handleModelCycle(event: globalThis.KeyboardEvent): void {
      if (event.ctrlKey && event.key === "/") {
        event.preventDefault();
        void cycleModel(event.shiftKey ? "backward" : "forward");
      }
    }

    window.addEventListener("keydown", handleModelCycle);
    return () => window.removeEventListener("keydown", handleModelCycle);
  }, [cycleModel]);

  const hasSession = Boolean(activeSession);
  const activeCwd = activeSession?.cwd ?? activeWorkspace?.rootPath;
  const branch = useGitBranch(activeCwd);
  const activeRunning = activeSession
    ? (activityBySession[activeSession.id]?.running ?? false)
    : false;

  useEffect(() => {
    const next = { sessionId: activeSessionId, workspaceId: activeWorkspace?.id };
    if (
      reviewScopeRef.current.sessionId !== next.sessionId ||
      reviewScopeRef.current.workspaceId !== next.workspaceId
    ) {
      reviewScopeRef.current = next;
      setReviewCwd(undefined);
    }
  }, [activeSessionId, activeWorkspace?.id]);

  // Each panel may grow only until the OTHER panel + main's reserved floor are
  // accounted for. Until the row is measured, allow the panels' own caps.
  const sidebarSpace = sidebarOpen ? sidebarWidth : 0;
  const inspectorSpace = hasSession && inspectorOpen ? inspectorWidth : 0;
  const sidebarMaxWidth =
    layoutWidth > 0
      ? Math.max(SIDEBAR_MIN_WIDTH, layoutWidth - inspectorSpace - MAIN_MIN_WIDTH)
      : Number.POSITIVE_INFINITY;
  const inspectorMaxWidth =
    layoutWidth > 0
      ? Math.max(INSPECTOR_MIN_WIDTH, layoutWidth - sidebarSpace - MAIN_MIN_WIDTH)
      : Number.POSITIVE_INFINITY;

  // When the window (or the other panel) shrinks, pull an over-wide panel back
  // in so the main column never drops below its floor.
  useEffect(() => {
    if (sidebarWidth > sidebarMaxWidth) {
      setSidebarWidth(sidebarMaxWidth);
    }
  }, [sidebarWidth, sidebarMaxWidth]);
  useEffect(() => {
    if (inspectorWidth > inspectorMaxWidth) {
      setInspectorWidth(inspectorMaxWidth);
    }
  }, [inspectorWidth, inspectorMaxWidth]);

  useEffect(() => {
    // activeRunning gates nothing but re-runs the poll whenever the active
    // agent starts/stops — its edits have just landed when it stops.
    void activeRunning;
    if (!activeCwd) {
      setEnvironmentStats({ added: 0, removed: 0 });
      return;
    }
    void window.modus.diff.read({ cwd: activeCwd }).then((fileDiff: FileDiff) => {
      setEnvironmentStats(getDiffTotals(fileDiff.diff));
    });
  }, [activeCwd, activeRunning]);

  const workspaceRoot = activeWorkspace?.rootPath;
  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }
    void window.modus.mcp.sync(workspaceRoot).catch(() => {});
  }, [workspaceRoot]);

  const canCreateSession = Boolean(activeWorkspace) && Boolean(model);
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );

  return (
    <LazyMotion features={domAnimation} strict>
      <TooltipProvider>
        <NativeSurfaceProvider>
          <ImageViewerProvider>
            <div className="app-root flex h-screen flex-col bg-canvas text-fg">
              <MenuBar />

              <div className="flex min-h-0 flex-1 bg-panel" ref={layoutRowRef}>
                {settingsOpen ? (
                  <SettingsPanel
                    onClose={() => setSettingsOpen(false)}
                    onRefresh={() => void refreshModelSettings()}
                    state={modelSettings}
                    workspaces={workspaces}
                    workspaceCwd={activeWorkspace?.rootPath}
                  />
                ) : (
                  <>
                    <Sidebar
                      activeWorkspace={activeWorkspace}
                      activityBySession={activityBySession}
                      agentSessions={rootSessions}
                      canCreateSession={canCreateSession}
                      onArchiveSession={(session) => void archiveSession(session)}
                      onPinProject={(id, pinned) => void pinProject(id, pinned)}
                      onRenameProject={(id, displayName) => void renameProject(id, displayName)}
                      onArchiveProjectChats={(id) => void archiveProjectChats(id)}
                      onRemoveProject={(id) => void removeProject(id)}
                      onRevealProject={(id) => void revealProject(id)}
                      onNewSession={() => openNewChat()}
                      onNewWorkspaceSession={(workspace) => openNewChat(workspace)}
                      onOpenChange={setSidebarOpen}
                      onOpenWorkspace={() => void openWorkspace()}
                      onOpenSettings={() => setSettingsOpen(true)}
                      onSelectSession={selectSession}
                      onSelectWorkspace={setActiveWorkspace}
                      onWidthChange={setSidebarWidth}
                      activeSessionId={activeSessionId}
                      maxWidth={sidebarMaxWidth}
                      open={sidebarOpen}
                      width={sidebarWidth}
                      workspaces={workspaces}
                    />

                    <main
                      className="relative flex flex-1 flex-col overflow-hidden rounded-tl-xl border-hairline-strong border-t border-l bg-canvas"
                      style={{ minWidth: MAIN_MIN_WIDTH }}
                    >
                      <header className="relative flex h-12 shrink-0 items-center px-3">
                        <div className="app-no-drag flex flex-1 items-center gap-1.5">
                          <AnimatePresence initial={false}>
                            {!sidebarOpen ? (
                              <m.div
                                animate={{ opacity: 1, width: "auto" }}
                                className="overflow-hidden"
                                exit={{ opacity: 0, width: 0 }}
                                initial={{ opacity: 0, width: 0 }}
                                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                              >
                                <ToolbarButton
                                  label="Show left sidebar"
                                  onClick={() => setSidebarOpen(true)}
                                >
                                  <IconLayoutSidebar size={15} stroke={1.65} />
                                </ToolbarButton>
                              </m.div>
                            ) : null}
                          </AnimatePresence>
                          {!hasSession ? (
                            <ChatTopBar
                              activeWorkspace={activeWorkspace}
                              branch={branch}
                              cwd={activeCwd}
                              onError={setSessionCreateError}
                              onOpenFolder={() => void openWorkspace()}
                              onSelectWorkspace={openNewChat}
                              workspaces={workspaces}
                            />
                          ) : null}
                        </div>
                        <div className="flex flex-1 items-center justify-end pr-2">
                          <HeaderActions
                            activeWorkspace={activeWorkspace}
                            branch={branch}
                            environmentStats={environmentStats}
                            inspectorOpen={inspectorOpen}
                            onToggleInspector={() => setInspectorOpen((open) => !open)}
                          />
                        </div>
                      </header>

                      {sessionCreateError ? (
                        <div className="mx-6 mb-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
                          {sessionCreateError}
                        </div>
                      ) : null}

                      <AnimatePresence initial={false} mode="wait">
                        {activeSession ? (
                          <m.div
                            animate={{ opacity: 1 }}
                            className="flex min-h-0 flex-1"
                            exit={{ opacity: 0 }}
                            initial={{ opacity: 0 }}
                            key="conversation"
                            transition={{ duration: 0.12, ease: "easeOut" }}
                          >
                            <ChatPane
                              contextUsage={contextUsageBySession[activeSession.id]}
                              defaultModel={model}
                              hub={hubRef.current}
                              initialEvents={initialEventsBySession[activeSession.id]}
                              key={activeSession.id}
                              models={models}
                              onModelChange={setModel}
                              onModelConfigChange={(next, thinkingVariant) =>
                                void updateModelThinking(next, thinkingVariant)
                              }
                              onOpenReview={openReview}
                              onOpenSubagent={openSubagent}
                              onInitialEventsConsumed={(sessionId) => {
                                setInitialEventsBySession((current) => {
                                  if (!current[sessionId]) {
                                    return current;
                                  }
                                  const next = { ...current };
                                  delete next[sessionId];
                                  return next;
                                });
                              }}
                              onPlanUpdated={handleChatPlanUpdated}
                              ref={chatPaneRef}
                              onSessionsChanged={() => void refreshSessions()}
                              session={activeSession}
                              workspace={
                                workspaceById.get(activeSession.workspaceId) ?? activeWorkspace
                              }
                            />
                          </m.div>
                        ) : (
                          <m.div
                            animate={{ opacity: 1 }}
                            className="flex min-h-0 flex-1 flex-col items-center justify-center px-6"
                            exit={{ opacity: 0 }}
                            initial={{ opacity: 0 }}
                            key="hero"
                            transition={{ duration: 0.12, ease: "easeOut" }}
                          >
                            <div className="w-full max-w-[680px] -translate-y-4">
                              <div className="mb-5 flex justify-center">
                                <ModusBot className="size-12" />
                              </div>
                              <Composer
                                canSubmit={canCreateSession}
                                contextItems={heroContextItems}
                                cwd={activeWorkspace?.rootPath}
                                hasSession={false}
                                mode={heroMode}
                                model={model}
                                models={models}
                                onContextChange={setHeroContextItems}
                                onModeChange={setHeroMode}
                                onModelChange={(next) => void changeDefaultModel(next)}
                                onModelConfigChange={(next, thinkingVariant) =>
                                  void updateModelThinking(next, thinkingVariant)
                                }
                                onSubmit={(message, context, delivery, attachments, skills, mode) =>
                                  void submitHeroPrompt(
                                    message,
                                    context,
                                    delivery,
                                    attachments,
                                    skills,
                                    mode,
                                  )
                                }
                                workspaceId={activeWorkspace?.id}
                              />
                              <div className="mt-4 flex items-center justify-center gap-2">
                                <Pill onClick={() => setHeroMode("plan")} shortcut="⇧Tab">
                                  Plan New Idea
                                </Pill>
                                <Pill onClick={() => setSettingsOpen(true)}>Use Your Model</Pill>
                              </div>
                            </div>
                            <p className="absolute bottom-5 text-xs font-normal text-fg-faint">
                              Bring your own model to Modus for local, private, context-aware agent
                              work.
                            </p>
                          </m.div>
                        )}
                      </AnimatePresence>
                    </main>

                    {hasSession ? (
                      <Inspector
                        activeWorkspace={activeWorkspace}
                        contextUsageBySession={contextUsageBySession}
                        cwd={reviewCwd ?? activeCwd}
                        defaultModel={model}
                        hub={hubRef.current}
                        sessionId={activeSession?.id}
                        maxWidth={inspectorMaxWidth}
                        models={models}
                        onModelChange={setModel}
                        onModelConfigChange={(next, thinkingVariant) =>
                          void updateModelThinking(next, thinkingVariant)
                        }
                        onOpenChange={setInspectorOpen}
                        onOpenReview={openReview}
                        onOpenSubagent={openSubagent}
                        onPlanUpdated={rememberActivePlan}
                        onSelectSubagent={setSelectedSubagentId}
                        onSessionsChanged={() => void refreshSessions()}
                        onTabChange={setInspectorTab}
                        onWidthChange={setInspectorWidth}
                        open={inspectorOpen}
                        {...(activeSession && activePlanBySession[activeSession.id]
                          ? { plan: activePlanBySession[activeSession.id] }
                          : {})}
                        sessionWorking={activeRunning}
                        onBuildPlan={buildActivePlan}
                        securityState={securityState}
                        selectedSubagentId={selectedSubagentId}
                        sessions={agentSessions}
                        tab={inspectorTab}
                        width={inspectorWidth}
                      />
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </ImageViewerProvider>
        </NativeSurfaceProvider>
      </TooltipProvider>
    </LazyMotion>
  );
}

/**
 * 顶部 menubar 行 —— 整行 44px 高，自绘 titlebar：
 *   - 左侧 BrandMark + File/Edit/View/Help（menubar 区，app-drag）
 *   - 右侧 WindowControls 自绘 min/max/close（无 native overlay，无越界）
 * 这样 hover 命中区域完全由 CSS 控制，永远不会超出 menubar 高度。
 */
function MenuBar() {
  return (
    <div className="app-drag flex h-11 shrink-0 items-center bg-panel">
      <div className="flex flex-1 items-center gap-0.5 pl-2.5">
        <BrandMark />
        <MenuItem>File</MenuItem>
        <MenuItem>Edit</MenuItem>
        <MenuItem>View</MenuItem>
        <MenuItem>Help</MenuItem>
      </div>
      <WindowControls />
    </div>
  );
}

function BrandMark() {
  return (
    <div className="mr-1 flex size-7 items-center justify-center">
      <img alt="Modus" className="size-[18px] object-contain" src={modusLogo} />
    </div>
  );
}

function MenuItem({ children }: { children: string }) {
  return (
    <button
      className={cn(
        "app-no-drag flex h-7 items-center rounded-md px-2 text-xs font-normal text-fg-muted",
        "transition-colors hover:bg-hover hover:text-fg",
      )}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * 自绘 Caption Buttons —— 严格被 menubar 44px 高度包覆，hover 区域不越界。
 * Windows 风格：min/max/close 三键，close hover 用 #c42b1c 高亮。
 * 命中区域 46×44（跟随自绘 menubar），但绘制完全 CSS 控制。
 */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!window.modus?.window) {
      return;
    }
    void window.modus.window.getState().then((state: { maximized: boolean }) => {
      setMaximized(state.maximized);
    });
    return window.modus.window.onStateChange((state: { maximized: boolean }) => {
      setMaximized(state.maximized);
    });
  }, []);

  return (
    <div className="app-no-drag flex h-full shrink-0 items-stretch">
      <CaptionButton label="Minimize" onClick={() => void window.modus?.window.minimize()}>
        <svg aria-hidden height="10" viewBox="0 0 10 10" width="10">
          <title>Minimize</title>
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
      <CaptionButton
        label={maximized ? "Restore" : "Maximize"}
        onClick={() => void window.modus?.window.toggleMaximize()}
      >
        {maximized ? (
          <svg aria-hidden height="10" viewBox="0 0 10 10" width="10">
            <title>Restore</title>
            <path
              d="M2.5 0.5h7v7h-2M0.5 2.5h7v7h-7v-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        ) : (
          <svg aria-hidden height="10" viewBox="0 0 10 10" width="10">
            <title>Maximize</title>
            <path d="M0.5 0.5h9v9h-9z" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </CaptionButton>
      <CaptionButton danger label="Close" onClick={() => void window.modus?.window.close()}>
        <svg aria-hidden height="10" viewBox="0 0 10 10" width="10">
          <title>Close</title>
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
    </div>
  );
}

function CaptionButton({
  children,
  label,
  onClick,
  danger = false,
}: {
  children: ReactNode;
  label: string;
  onClick(): void;
  danger?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "flex h-full w-[46px] items-center justify-center text-fg-muted transition-colors",
        danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-hover hover:text-fg",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/** Shared look for the two top-bar dropdown triggers (folder + branch). */
const TOPBAR_TRIGGER_CLASS =
  "flex h-7 items-center gap-1.5 rounded-md px-2 outline-none transition-colors hover:bg-hover hover:text-fg-muted data-popup-open:bg-hover data-popup-open:text-fg-muted disabled:opacity-60 disabled:hover:bg-transparent";

/**
 * New-chat hero top bar: the workspace folder and its git branch, both now
 * selectable. Picking a folder switches the workspace and drops back to a fresh
 * (lazy) chat; the branch list/checkout is driven off the active workspace's
 * cwd, so the two stay linked. The branch label tracks the workspace live via
 * `useGitBranch` (App) — switching folder repaints the branch without a refresh.
 */
function ChatTopBar({
  activeWorkspace,
  branch,
  cwd,
  workspaces,
  onSelectWorkspace,
  onOpenFolder,
  onError,
}: {
  activeWorkspace: WorkspaceInfo | null;
  branch: string | undefined;
  cwd: string | undefined;
  workspaces: WorkspaceInfo[];
  onSelectWorkspace(workspace: WorkspaceInfo): void;
  onOpenFolder(): void;
  onError(message: string): void;
}) {
  return (
    <div className="app-no-drag flex items-center gap-3 text-sm font-normal text-fg-subtle">
      <WorkspaceMenu
        activeWorkspace={activeWorkspace}
        onOpenFolder={onOpenFolder}
        onSelect={onSelectWorkspace}
        workspaces={workspaces}
      />
      <BranchSwitcher cwd={cwd} onError={onError} triggerClassName={TOPBAR_TRIGGER_CLASS}>
        <span className="text-fg-faint">
          <IconGitBranch size={15} stroke={1.65} />
        </span>
        <span className="max-w-40 truncate">{branch ?? "No branch"}</span>
        <IconChevronDown className="text-fg-faint" size={11} stroke={2} />
      </BranchSwitcher>
    </div>
  );
}

/**
 * Folder switcher: lists every known workspace (the authoritative recents from
 * `workspace.list()`), marks the active one, and offers "Open folder…" to add a
 * new root. Selecting a different workspace hands it to the host, which switches
 * and opens a fresh chat — no empty session row is created until the first prompt.
 */
function WorkspaceMenu({
  activeWorkspace,
  workspaces,
  onSelect,
  onOpenFolder,
}: {
  activeWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  onSelect(workspace: WorkspaceInfo): void;
  onOpenFolder(): void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className={TOPBAR_TRIGGER_CLASS}>
        <span className="text-fg-faint">
          <IconFolder size={15} stroke={1.65} />
        </span>
        <span className="max-w-40 truncate">{activeWorkspace?.displayName ?? "No workspace"}</span>
        <IconChevronDown className="text-fg-faint" size={11} stroke={2} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom" sideOffset={6}>
          <Menu.Popup className="scroll-thin origin-(--transform-origin) max-h-[360px] min-w-[260px] overflow-y-auto rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
            {workspaces.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-2xs text-fg-faint">
                No recent workspaces
              </div>
            ) : (
              workspaces.map((workspace) => {
                const active = workspace.id === activeWorkspace?.id;
                return (
                  <Menu.Item
                    className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none transition-colors select-none data-highlighted:bg-hover"
                    closeOnClick
                    key={workspace.id}
                    onClick={() => {
                      if (!active) {
                        onSelect(workspace);
                      }
                    }}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-accent">
                      {active ? <IconCheck size={14} stroke={2} /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{workspace.displayName}</span>
                      <span className="truncate text-2xs text-fg-faint">{workspace.rootPath}</span>
                    </span>
                  </Menu.Item>
                );
              })
            )}
            <div className="my-1 h-px bg-hairline" />
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none transition-colors select-none data-highlighted:bg-hover"
              onClick={onOpenFolder}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-fg-subtle">
                <IconFolderPlus size={15} stroke={1.7} />
              </span>
              <span className="flex-1">Open folder…</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function HeaderActions({
  activeWorkspace,
  branch,
  environmentStats,
  inspectorOpen,
  onToggleInspector,
}: {
  activeWorkspace: WorkspaceInfo | null;
  branch: string | undefined;
  environmentStats: { added: number; removed: number };
  inspectorOpen: boolean;
  onToggleInspector(): void;
}) {
  return (
    <div className="app-no-drag flex h-7 items-center gap-1">
      <EnvironmentPopover
        activeWorkspace={activeWorkspace}
        branch={branch}
        environmentStats={environmentStats}
      />
      <ToolbarButton
        active={inspectorOpen}
        label={inspectorOpen ? "Hide right sidebar" : "Show right sidebar"}
        onClick={onToggleInspector}
      >
        <IconLayoutSidebarRight size={15} stroke={1.65} />
      </ToolbarButton>
    </div>
  );
}

function EnvironmentPopover({
  activeWorkspace,
  branch,
  environmentStats,
}: {
  activeWorkspace: WorkspaceInfo | null;
  branch: string | undefined;
  environmentStats: { added: number; removed: number };
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        aria-label="Environment"
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-fg-subtle",
          open ? "bg-active text-fg-subtle" : "text-fg-faint",
        )}
      >
        <IconListDetails size={15} stroke={1.65} />
      </Popover.Trigger>
      <AnimatePresence>
        {open ? (
          <Popover.Portal keepMounted>
            <Popover.Positioner align="end" side="bottom" sideOffset={10}>
              <Popover.Popup render={<m.div />}>
                <m.div
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="w-[375px] rounded-[22px] border border-hairline bg-surface p-5 shadow-popup outline-none"
                  exit={{ opacity: 0, scale: 0.98, y: -6 }}
                  initial={{ opacity: 0, scale: 0.98, y: -6 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-normal text-fg-subtle">Environment</h2>
                    <button
                      aria-label="Environment settings"
                      className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
                      type="button"
                    >
                      <IconSettings size={15} stroke={1.65} />
                    </button>
                  </div>
                  <div className="space-y-3 text-sm text-fg">
                    <EnvironmentRow icon={<IconSourceCode size={17} stroke={1.65} />}>
                      <span>Changes</span>
                      <span className="ml-auto font-mono text-success">
                        +{environmentStats.added}
                      </span>
                      <span className="font-mono text-danger">-{environmentStats.removed}</span>
                    </EnvironmentRow>
                    <EnvironmentRow icon={<IconDeviceLaptop size={17} stroke={1.65} />}>
                      <span>{activeWorkspace ? "Local" : "No workspace"}</span>
                      <IconChevronDown className="text-fg-faint" size={12} stroke={2} />
                    </EnvironmentRow>
                    <EnvironmentRow icon={<IconGitBranch size={17} stroke={1.65} />}>
                      <span>{branch ?? "No branch"}</span>
                    </EnvironmentRow>
                    <EnvironmentRow icon={<IconVersions size={17} stroke={1.65} />}>
                      <span>Commit or push</span>
                    </EnvironmentRow>
                  </div>

                  <div className="my-5 h-px bg-hairline-soft" />

                  <section>
                    <h2 className="mb-3 text-sm font-normal text-fg-subtle">Sources</h2>
                    <div className="flex items-center gap-3 text-fg-subtle">
                      <IconCircles size={18} stroke={1.6} />
                      <span className="flex size-5 items-center justify-center rounded bg-[#2f5dff] text-white">
                        <IconBrandVisualStudio size={15} stroke={1.7} />
                      </span>
                      <IconCircles size={18} stroke={1.6} />
                    </div>
                  </section>
                </m.div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        ) : null}
      </AnimatePresence>
    </Popover.Root>
  );
}

function EnvironmentRow({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <button
      className="flex h-8 w-full items-center gap-3 rounded-md px-1 text-left transition-colors hover:bg-hover"
      type="button"
    >
      <span className="flex size-5 items-center justify-center text-fg">{icon}</span>
      {children}
    </button>
  );
}

function getDiffTotals(diff: string): { added: number; removed: number } {
  return diff.split("\n").reduce(
    (total, line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) total.added += 1;
      if (line.startsWith("-") && !line.startsWith("---")) total.removed += 1;
      return total;
    },
    { added: 0, removed: 0 },
  );
}

function Pill({
  children,
  onClick,
  shortcut,
  disabled = false,
}: {
  children: string;
  onClick(): void;
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-full border border-hairline bg-chip-faint px-3 py-[5px] text-xs font-normal text-fg-muted transition-colors hover:bg-chip hover:text-fg active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-chip-faint disabled:hover:text-fg-muted"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span>{children}</span>
      {shortcut ? (
        <kbd className="font-sans text-2xs font-normal text-fg-faint">{shortcut}</kbd>
      ) : null}
    </button>
  );
}

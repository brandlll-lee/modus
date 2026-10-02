import { IconLayoutSidebar } from "@tabler/icons-react";
import { AnimatePresence, domMax, LazyMotion, m, useReducedMotion } from "motion/react";
import { Activity, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SecurityState } from "../../../preload/types";
import type {
  AgentMode,
  BrowserEvent,
  ContextItem,
  PlanRef,
  PromptDelivery,
  PromptImageAttachment,
  SkillSelection,
} from "../../../shared/contracts";
import { NavigationRail } from "../components/layout/NavigationRail";
import { usePanelLayout } from "../components/layout/usePanelLayout";
import { SIDEBAR_TRANSITION, Sidebar } from "../components/Sidebar";
import { ImageViewerProvider } from "../components/ui/ImageViewer";
import { ModusLoadingFallback } from "../components/ui/ModusLoadingMark";
import { NativeSurfaceProvider } from "../components/ui/nativeSurface";
import { TOOLBAR_ICON, ToolbarButton } from "../components/ui/ToolbarButton";
import { TooltipProvider } from "../components/ui/Tooltip";
import { WindowTitleBar } from "../components/ui/WindowTitleBar";
import { type AgentEventItem, optimisticUserPromptEvents } from "../features/agent/agentEventHub";
import { ChatPane } from "../features/agent/ChatPane";
import { ExtensionDialog } from "../features/agent/ExtensionDialog";
import { SessionTitlePopover } from "../features/agent/SessionTitlePopover";
import { Composer } from "../features/composer/Composer";
import type {
  ChatComposerDraft,
  ChatComposerDraftUpdate,
} from "../features/composer/chatComposerDraft";
import { addContextItemToDraft } from "../features/composer/chatComposerDraft";
import { createEmptyComposerDraft } from "../features/composer/composerDraft";
import { contextItemKey } from "../features/composer/composerTokens";
import { normalizePlan } from "../features/plan/planState";
import { useGitBranch } from "../lib/useGitBranch";
import { RuntimeNotice } from "./RuntimeNotice";
import { useAgentEvents } from "./useAgentEvents";
import { useEnvironmentStats } from "./useEnvironmentStats";
import { useInitialHydration } from "./useInitialHydration";
import { useModels } from "./useModels";
import { useWorkspaceSessions } from "./useWorkspaceSessions";
import { WorkspaceHeaderActions } from "./WorkspaceHeaderActions";
import { WorkspacePicker } from "./WorkspacePicker";

const loadInspector = () => import("../features/inspector/Inspector");
const loadSettingsPanel = () => import("../features/settings/SettingsPanel");
const Inspector = lazy(() =>
  loadInspector().then(({ Inspector: Component }) => ({
    default: Component,
  })),
);
const SettingsPanel = lazy(() =>
  loadSettingsPanel().then(({ SettingsPanel: Component }) => ({
    default: Component,
  })),
);

export function App() {
  const reduceMotion = useReducedMotion();
  const [securityState, setSecurityState] = useState<SecurityState | null>(null);
  const [initialEventsBySession, setInitialEventsBySession] = useState<
    Record<string, AgentEventItem[]>
  >({});
  const [composerDraftBySession, setComposerDraftBySession] = useState<
    Record<string, ChatComposerDraft>
  >({});
  const [heroContextItems, setHeroContextItems] = useState<ContextItem[]>([]);
  const [heroDraft, setHeroDraft] = useState(createEmptyComposerDraft);
  const [heroMode, setHeroMode] = useState<AgentMode>("build");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    workspaces,
    setWorkspaces,
    activeWorkspace,
    setActiveWorkspace,
    setAgentSessions,
    activeSessionId,
    setActiveSessionId,
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
  } = useWorkspaceSessions(setSettingsOpen);
  const focusSession = useCallback(
    (id: string) => {
      setActiveSessionId(id);
      setSettingsOpen(false);
    },
    [setActiveSessionId],
  );
  const {
    hubRef,
    extensionQuestions,
    activityBySession,
    contextUsageBySession,
    notice,
    dismissNotice,
    restoreError,
    publishLocalAgentEvent,
  } = useAgentEvents(
    activeSessionId,
    refreshSessions,
    focusSession,
    updateSessionTitle,
    !settingsOpen,
  );
  const {
    models,
    model,
    modelSettings,
    applyModelSettings,
    refreshModelCatalog,
    changeDefaultModel,
    updateModelThinking,
  } = useModels(activeSession, refreshSessions);
  const {
    showSidebar,
    setSidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    inspectorOpen,
    setInspectorOpen,
    inspectorWidth,
    setInspectorWidth,
    layoutRowRef,
    responsiveInspectorOpen,
    responsiveSidebarOpen,
    sidebarMaxWidth,
    inspectorMaxWidth,
  } = usePanelLayout(Boolean(activeWorkspace));
  const [inspectorTab, setInspectorTab] = useState("changes");
  const [filesRevealPath, setFilesRevealPath] = useState<string | undefined>();
  const [terminalRevealId, setTerminalRevealId] = useState<string | undefined>();
  const [reviewCwd, setReviewCwd] = useState<string | undefined>();
  // Plans are scoped per session (the authoritative key), so switching sessions
  // shows that session's own plan — never the last one any session emitted.
  const [activePlanBySession, setActivePlanBySession] = useState<Record<string, PlanRef>>({});

  const reviewScopeRef = useRef<{
    sessionId: string | undefined;
    workspaceId: string | undefined;
  }>({ sessionId: undefined, workspaceId: undefined });
  useInitialHydration({
    setSecurityState,
    setWorkspaces,
    setActiveWorkspace,
    setAgentSessions,
    applyModelSettings,
  });

  useEffect(() => {
    if (!window.modus) {
      return;
    }
    return window.modus.browser.onEvent((event: BrowserEvent) => {
      if (event.type === "browser.agent-activity" && event.workspaceId === activeWorkspace?.id) {
        setInspectorTab("browser");
        setInspectorOpen(true);
      }
    });
  }, [activeWorkspace?.id, setInspectorOpen]);

  function openReview(cwd?: string): void {
    setReviewCwd(cwd);
    setInspectorTab("changes");
    setInspectorOpen(true);
  }

  const rememberActivePlan = useCallback(
    (plan: PlanRef) => {
      const normalized = normalizePlan(plan);
      const key = normalized.sessionId ?? activeSessionId ?? normalized.id;
      setActivePlanBySession((current) =>
        current[key] === normalized ? current : { ...current, [key]: normalized },
      );
    },
    [activeSessionId],
  );

  const openPlan = useCallback(
    (plan: PlanRef) => {
      rememberActivePlan(plan);
      setInspectorTab("plan");
      setInspectorOpen(true);
    },
    [rememberActivePlan, setInspectorOpen],
  );

  async function submitHeroPrompt(
    message: string,
    context: ContextItem[],
    _delivery?: PromptDelivery,
    attachments?: PromptImageAttachment[],
    skills?: SkillSelection[],
    mode?: AgentMode,
  ): Promise<void> {
    if (!message.trim() && !attachments?.length) {
      return;
    }
    const session = await createSession(
      activeWorkspace,
      model,
      message.trim() ||
        attachments
          ?.map((image) => image.name)
          .filter(Boolean)
          .join(" ") ||
        "",
    );
    if (!session) {
      throw new Error("Select a workspace and model before sending.");
    }
    hubRef.current.prepare(session.id);
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
      })
      .finally(() => hubRef.current.cancelPrepare(session.id));
  }

  function reportModelFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    setSessionCreateError(message);
    if (activeSession)
      publishLocalAgentEvent({ type: "runtime.error", sessionId: activeSession.id, message });
  }

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

  const environmentStats = useEnvironmentStats(activeCwd, activeRunning);

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
  const updateSessionComposerDraft = useCallback(
    (sessionId: string, update: ChatComposerDraftUpdate): void => {
      setComposerDraftBySession((current) => {
        const draft = current[sessionId] ?? {
          ...createEmptyComposerDraft(),
          contextItems: [],
          mode: "build" as const,
        };
        const next = typeof update === "function" ? update(draft) : update;
        return { ...current, [sessionId]: next };
      });
    },
    [],
  );

  const addContextToChat = useCallback(
    (item: ContextItem) => {
      if (activeSession) {
        updateSessionComposerDraft(activeSession.id, (draft) => addContextItemToDraft(draft, item));
        return;
      }
      setHeroContextItems((current) => {
        const key = contextItemKey(item);
        if (current.some((existing) => contextItemKey(existing) === key)) {
          return current;
        }
        return [...current, item];
      });
    },
    [activeSession, updateSessionComposerDraft],
  );

  const openWorkspaceFile = useCallback(
    (path: string) => {
      setInspectorOpen(true);
      setInspectorTab("files");
      setFilesRevealPath(path);
    },
    [setInspectorOpen],
  );

  const openTerminal = useCallback(
    (terminalId: string) => {
      setInspectorOpen(true);
      setInspectorTab("terminal");
      setTerminalRevealId(terminalId);
    },
    [setInspectorOpen],
  );

  return (
    <LazyMotion features={domMax} strict>
      <TooltipProvider>
        <NativeSurfaceProvider>
          <ImageViewerProvider>
            <div className="app-root flex min-h-0 flex-1 flex-col bg-panel text-fg">
              <WindowTitleBar />
              {restoreError ? (
                <p role="alert" className="px-4 py-2 text-sm text-danger">
                  {restoreError}
                </p>
              ) : null}
              {notice ? <RuntimeNotice notice={notice} onDismiss={dismissNotice} /> : null}
              {extensionQuestions[0] ? (
                <ExtensionDialog key={extensionQuestions[0].id} request={extensionQuestions[0]} />
              ) : null}

              <div className="flex min-h-0 min-w-0 flex-1 bg-chrome">
                <NavigationRail
                  settingsOpen={settingsOpen}
                  onHome={() => setSettingsOpen(false)}
                  onSettings={() => setSettingsOpen(true)}
                />
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-xl border border-hairline bg-canvas">
                  <Activity mode={settingsOpen ? "visible" : "hidden"}>
                    <Suspense fallback={<ModusLoadingFallback />}>
                      <SettingsPanel
                        sessionId={activeSessionId ?? undefined}
                        onClose={() => setSettingsOpen(false)}
                        onRefreshCatalog={refreshModelCatalog}
                        state={modelSettings}
                        workspaces={workspaces}
                        workspaceCwd={activeWorkspace?.rootPath}
                      />
                    </Suspense>
                  </Activity>
                  <Activity mode={settingsOpen ? "hidden" : "visible"}>
                    <div className="workspace-layout" ref={layoutRowRef}>
                      <Sidebar
                        activityBySession={activityBySession}
                        agentSessions={rootSessions}
                        canCreateSession={canCreateSession}
                        onArchiveSession={(session) => void archiveSession(session)}
                        onDeleteSession={(session) => void deleteSession(session)}
                        onListArchivedSessions={(workspaceId) =>
                          window.modus.agent.listArchived(workspaceId)
                        }
                        onPinProject={(id, pinned) => void pinProject(id, pinned)}
                        onPinSession={(session, pinned) => void pinSession(session, pinned)}
                        onRenameProject={(id, displayName) => void renameProject(id, displayName)}
                        onArchiveProjectChats={(id) => void archiveProjectChats(id)}
                        onDeleteProjectChats={(id) => void deleteProjectChats(id)}
                        onRemoveProject={(id) => void removeProject(id)}
                        onRestoreSession={(session) => void restoreSession(session)}
                        onRevealProject={(id) => void revealProject(id)}
                        onNewSession={() => openNewChat()}
                        onNewWorkspaceSession={(workspace) => openNewChat(workspace)}
                        onOpenChange={setSidebarOpen}
                        onOpenWorkspace={() => void openWorkspace()}
                        onSelectSession={selectSession}
                        onWidthChange={setSidebarWidth}
                        activeSessionId={activeSessionId}
                        maxWidth={sidebarMaxWidth}
                        open={responsiveSidebarOpen}
                        width={sidebarWidth}
                        workspaces={workspaces}
                      />

                      <m.main
                        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
                        layout={!reduceMotion}
                        layoutDependency={responsiveSidebarOpen}
                        transition={{ layout: SIDEBAR_TRANSITION }}
                      >
                        <header className="toolbar-row relative flex shrink-0 items-center px-3">
                          <div className="app-no-drag flex min-w-0 flex-1 items-center gap-1.5">
                            <AnimatePresence initial={false}>
                              {!responsiveSidebarOpen ? (
                                <m.div
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: -4 }}
                                  initial={{ opacity: 0, x: -4 }}
                                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                                >
                                  <ToolbarButton label="Show left sidebar" onClick={showSidebar}>
                                    <IconLayoutSidebar
                                      size={TOOLBAR_ICON.size}
                                      stroke={TOOLBAR_ICON.stroke}
                                    />
                                  </ToolbarButton>
                                </m.div>
                              ) : null}
                            </AnimatePresence>
                            {activeSession ? (
                              <SessionTitlePopover
                                branch={branch}
                                contextUsage={contextUsageBySession[activeSession.id]}
                                modelId={activeSession.model ?? model}
                                models={models}
                                session={activeSession}
                                workspace={
                                  workspaceById.get(activeSession.workspaceId) ?? activeWorkspace
                                }
                              />
                            ) : null}
                          </div>
                          <div className="flex flex-1 items-center justify-end pr-2">
                            <WorkspaceHeaderActions
                              activeWorkspace={activeWorkspace}
                              branch={branch}
                              environmentStats={environmentStats}
                              inspectorOpen={responsiveInspectorOpen}
                              onOpenReview={() => openReview(activeCwd)}
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
                              className="flex min-h-0 min-w-0 flex-1"
                              exit={{ opacity: 0 }}
                              initial={
                                initialEventsBySession[activeSession.id] ? false : { opacity: 0 }
                              }
                              key="conversation"
                              layout={reduceMotion ? false : "position"}
                              layoutDependency={responsiveSidebarOpen}
                              transition={{ ...SIDEBAR_TRANSITION, layout: SIDEBAR_TRANSITION }}
                            >
                              <Suspense fallback={<ModusLoadingFallback />}>
                                <ChatPane
                                  composerDraft={composerDraftBySession[activeSession.id]}
                                  contextUsage={contextUsageBySession[activeSession.id]}
                                  defaultModel={model}
                                  hub={hubRef.current}
                                  initialEvents={initialEventsBySession[activeSession.id]}
                                  key={activeSession.id}
                                  models={models}
                                  onModelChange={(next) =>
                                    void changeDefaultModel(next).catch(reportModelFailure)
                                  }
                                  onModelConfigChange={(next, thinkingVariant) =>
                                    void updateModelThinking(next, thinkingVariant).catch(
                                      reportModelFailure,
                                    )
                                  }
                                  onOpenReview={openReview}
                                  onComposerDraftChange={(update) =>
                                    updateSessionComposerDraft(activeSession.id, update)
                                  }
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
                                  onOpenPlan={openPlan}
                                  onOpenFile={openWorkspaceFile}
                                  onOpenTerminal={openTerminal}
                                  onPlanUpdated={rememberActivePlan}
                                  onSessionsChanged={() => void refreshSessions()}
                                  session={activeSession}
                                  workspace={
                                    workspaceById.get(activeSession.workspaceId) ?? activeWorkspace
                                  }
                                />
                              </Suspense>
                            </m.div>
                          ) : (
                            <m.div
                              animate={{ opacity: 1 }}
                              className="flex min-h-0 flex-1 flex-col items-center justify-center px-6"
                              exit={{ opacity: 0, transition: { duration: 0 } }}
                              initial={{ opacity: 0 }}
                              key="hero"
                              transition={{ duration: 0.12, ease: "easeOut" }}
                            >
                              <div className="w-full max-w-[760px] -translate-y-4">
                                <h1 className="mb-8 text-center text-[28px] font-medium">
                                  What are we working on?
                                </h1>
                                <Composer
                                  draft={heroDraft}
                                  onDraftChange={setHeroDraft}
                                  canSubmit={canCreateSession}
                                  contextItems={heroContextItems}
                                  cwd={activeWorkspace?.rootPath}
                                  footer={
                                    <WorkspacePicker
                                      activeWorkspace={activeWorkspace}
                                      branch={branch}
                                      cwd={activeCwd}
                                      onError={setSessionCreateError}
                                      onOpenFolder={() => void openWorkspace()}
                                      onSelectWorkspace={openNewChat}
                                      workspaces={workspaces}
                                    />
                                  }
                                  mode={heroMode}
                                  model={model}
                                  models={models}
                                  onContextChange={setHeroContextItems}
                                  onModeChange={setHeroMode}
                                  onModelChange={(next) =>
                                    void changeDefaultModel(next).catch(reportModelFailure)
                                  }
                                  onModelConfigChange={(next, thinkingVariant) =>
                                    void updateModelThinking(next, thinkingVariant).catch(
                                      reportModelFailure,
                                    )
                                  }
                                  onSubmit={(
                                    message,
                                    context,
                                    delivery,
                                    attachments,
                                    skills,
                                    mode,
                                  ) =>
                                    submitHeroPrompt(
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
                              </div>
                            </m.div>
                          )}
                        </AnimatePresence>
                      </m.main>

                      {responsiveInspectorOpen ? (
                        <Suspense
                          fallback={
                            <div
                              className="flex min-h-0 min-w-0 shrink-0 overflow-hidden border-l border-hairline bg-canvas"
                              style={{ width: inspectorWidth }}
                            >
                              <ModusLoadingFallback />
                            </div>
                          }
                        >
                          <Inspector
                            activeWorkspace={activeWorkspace}
                            cwd={reviewCwd ?? activeCwd}
                            sessionId={activeSession?.id}
                            maxWidth={inspectorMaxWidth}
                            onOpenChange={setInspectorOpen}
                            onOpenSettings={() => setSettingsOpen(true)}
                            onTabChange={setInspectorTab}
                            onWidthChange={setInspectorWidth}
                            onAddToChat={addContextToChat}
                            onRevealConsumed={() => setFilesRevealPath(undefined)}
                            onRevealTerminalConsumed={() => setTerminalRevealId(undefined)}
                            revealPath={filesRevealPath}
                            revealTerminalId={terminalRevealId}
                            open={inspectorOpen}
                            {...(activeSession && activePlanBySession[activeSession.id]
                              ? { plan: activePlanBySession[activeSession.id] }
                              : {})}
                            securityState={securityState}
                            tab={inspectorTab}
                            width={inspectorWidth}
                          />
                        </Suspense>
                      ) : null}
                    </div>
                  </Activity>
                </div>
              </div>
            </div>
          </ImageViewerProvider>
        </NativeSurfaceProvider>
      </TooltipProvider>
    </LazyMotion>
  );
}

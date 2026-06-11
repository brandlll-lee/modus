import { Popover } from "@base-ui/react/popover";
import {
  IconBrandVisualStudio,
  IconCheck,
  IconChevronDown,
  IconCircles,
  IconColumns,
  IconDeviceLaptop,
  IconFolder,
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
  AgentSessionInfo,
  ContextItem,
  ContextUsageInfo,
  FileDiff,
  ModelInfo,
  ModelSettingsState,
  PromptDelivery,
  PromptImageAttachment,
  ThinkingLevel,
  WorkspaceInfo,
} from "../../../shared/contracts";
import modusLogo from "../assets/modus-logo.png";
import { Sidebar } from "../components/Sidebar";
import { ToolbarButton } from "../components/ui/ToolbarButton";
import { TooltipProvider } from "../components/ui/Tooltip";
import {
  AgentEventHub,
  affectsActivity,
  reduceActivity,
  type SessionActivity,
} from "../features/agent/agentEventHub";
import { ChatPane } from "../features/agent/ChatPane";
import { Composer } from "../features/composer/Composer";
import { Inspector } from "../features/inspector/Inspector";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { cn } from "../lib/cn";

/** Side-by-side agent columns (Agents-Window style). 3 keeps panes readable at the app's min width. */
const MAX_PANES = 3;

export function App() {
  const [securityState, setSecurityState] = useState<SecurityState | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [agentSessions, setAgentSessions] = useState<AgentSessionInfo[]>([]);
  const [paneSessionIds, setPaneSessionIds] = useState<string[]>([]);
  const [focusedPane, setFocusedPane] = useState(0);
  const [activityBySession, setActivityBySession] = useState<Record<string, SessionActivity>>({});
  const [contextUsageBySession, setContextUsageBySession] = useState<
    Record<string, ContextUsageInfo>
  >({});
  const [heroContextItems, setHeroContextItems] = useState<ContextItem[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [modelSettings, setModelSettings] = useState<ModelSettingsState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(384);
  const [environmentStats, setEnvironmentStats] = useState({ added: 0, removed: 0 });
  const [sessionCreateError, setSessionCreateError] = useState<string | undefined>();

  const hubRef = useRef(new AgentEventHub());
  const paneSessionIdsRef = useRef<string[]>([]);

  useEffect(() => {
    paneSessionIdsRef.current = paneSessionIds;
  }, [paneSessionIds]);

  const refreshSessions = useCallback(async (): Promise<void> => {
    setAgentSessions(await window.modus.agent.list());
  }, []);

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

  /* ── Global event intake: one IPC listener feeds every pane + the sidebar ──
   * Mount-once wiring: openSessionInPane works off setState callbacks/refs, so
   * subscribing it as a dependency would only churn the IPC listener.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
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
        const watched = paneSessionIdsRef.current.includes(event.sessionId);
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
        event.type === "runtime.error"
      ) {
        void refreshSessions();
      }
    });

    // System notification click → surface that session in the focused pane.
    const unsubscribeFocus = window.modus.agent.onFocusSession((sessionId: string) => {
      openSessionInPane(sessionId, "focus");
    });

    return () => {
      unsubscribe();
      unsubscribeFocus();
    };
  }, [refreshModelSettings, refreshSessions]);

  /* ── Pane management ──────────────────────────────────────────────────── */

  /**
   * Bring a session on screen. "replace" swaps it into the focused pane (the
   * classic single-chat behavior); "split" opens a new column (up to
   * MAX_PANES, falling back to replace); "focus" prefers an existing pane.
   */
  function openSessionInPane(sessionId: string, mode: "replace" | "split" | "focus"): void {
    setPaneSessionIds((current) => {
      const existingIndex = current.indexOf(sessionId);
      if (existingIndex >= 0) {
        setFocusedPane(existingIndex);
        return current;
      }
      if (current.length === 0) {
        setFocusedPane(0);
        return [sessionId];
      }
      if (mode === "split" && current.length < MAX_PANES) {
        setFocusedPane(current.length);
        return [...current, sessionId];
      }
      const target =
        mode === "split" ? current.length - 1 : Math.min(focusedPane, current.length - 1);
      const next = current.slice();
      next[target] = sessionId;
      setFocusedPane(target);
      return next;
    });
  }

  function closePane(index: number): void {
    setPaneSessionIds((current) => {
      const next = current.filter((_, paneIndex) => paneIndex !== index);
      setFocusedPane((focus) =>
        Math.max(0, Math.min(focus > index ? focus - 1 : focus, next.length - 1)),
      );
      return next;
    });
  }

  // Sessions opened in a pane are "watched": their unread flag clears.
  useEffect(() => {
    setActivityBySession((current) => {
      let changed = false;
      const next = { ...current };
      for (const sessionId of paneSessionIds) {
        const activity = next[sessionId];
        if (activity?.unread) {
          next[sessionId] = { ...activity, unread: false };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [paneSessionIds]);

  // Drop panes whose sessions were archived elsewhere.
  useEffect(() => {
    setPaneSessionIds((current) => {
      const next = current.filter((id) => agentSessions.some((session) => session.id === id));
      return next.length === current.length ? current : next;
    });
  }, [agentSessions]);

  const paneSessions = useMemo(
    () =>
      paneSessionIds
        .map((id) => agentSessions.find((session) => session.id === id))
        .filter((session): session is AgentSessionInfo => Boolean(session)),
    [paneSessionIds, agentSessions],
  );
  const focusedSession = paneSessions[Math.min(focusedPane, paneSessions.length - 1)];

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

  async function createSession(
    workspace: WorkspaceInfo | null,
    mode: "replace" | "split",
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
        title: "New chat",
      });
      setSessionCreateError(undefined);
      setActiveWorkspace(workspace);
      await refreshSessions();
      openSessionInPane(session.id, mode);
      return session;
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  function selectSession(session: AgentSessionInfo, mode: "replace" | "split" = "replace"): void {
    setSessionCreateError(undefined);
    setActiveWorkspace(
      workspaces.find((workspace) => workspace.id === session.workspaceId) ?? activeWorkspace,
    );
    openSessionInPane(session.id, mode);
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

  /** Hero composer: create the session, open its pane, fire the first prompt. */
  async function submitHeroPrompt(
    message: string,
    context: ContextItem[],
    _delivery?: PromptDelivery,
    attachments?: PromptImageAttachment[],
    skills?: string[],
  ): Promise<void> {
    if (!message.trim()) {
      return;
    }
    const session = await createSession(activeWorkspace, "replace");
    if (!session) {
      return;
    }
    setHeroContextItems([]);
    void window.modus.agent
      .prompt({
        context,
        delivery: "normal",
        sessionId: session.id,
        message,
        userMessageId: `local-user:${crypto.randomUUID()}`,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
      })
      .then(() => refreshSessions())
      .catch((error: unknown) => {
        setSessionCreateError(error instanceof Error ? error.message : String(error));
      });
  }

  async function changeDefaultModel(nextModel: string): Promise<void> {
    if (!nextModel) {
      return;
    }
    setModel(nextModel);
    await window.modus.model.setDefault(nextModel);
  }

  async function updateModelThinking(modelId: string, thinkingLevel: ThinkingLevel): Promise<void> {
    await window.modus.model.updateConfig({ model: modelId, thinkingLevel });
    await window.modus.model.setDefault(modelId);
    await refreshModelSettings();
    setModel(modelId);
  }

  const cycleModel = useCallback(
    async (direction: "forward" | "backward"): Promise<void> => {
      const next = await window.modus.agent.cycleModel({
        direction,
        sessionId: focusedSession?.id,
      });
      setModel(next.id);
      void refreshSessions();
    },
    [focusedSession?.id, refreshSessions],
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

  const hasPanes = paneSessions.length > 0;
  const activeCwd =
    focusedSession?.worktreePath ?? focusedSession?.cwd ?? activeWorkspace?.rootPath;
  const focusedRunning = focusedSession
    ? (activityBySession[focusedSession.id]?.running ?? false)
    : false;

  useEffect(() => {
    // focusedRunning gates nothing but re-runs the poll whenever the focused
    // agent starts/stops — its edits have just landed when it stops.
    void focusedRunning;
    if (!activeCwd) {
      setEnvironmentStats({ added: 0, removed: 0 });
      return;
    }
    void window.modus.diff.read({ cwd: activeCwd }).then((fileDiff: FileDiff) => {
      setEnvironmentStats(getDiffTotals(fileDiff.diff));
    });
  }, [activeCwd, focusedRunning]);

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
        <div className="app-root flex h-screen flex-col bg-canvas text-fg">
          <MenuBar />

          <div className="flex min-h-0 flex-1">
            {settingsOpen ? (
              <SettingsPanel
                onClose={() => setSettingsOpen(false)}
                onRefresh={() => void refreshModelSettings()}
                open
                state={modelSettings}
                workspaceCwd={activeWorkspace?.rootPath}
              />
            ) : (
              <>
                <Sidebar
                  activeWorkspace={activeWorkspace}
                  activityBySession={activityBySession}
                  agentSessions={agentSessions}
                  canCreateSession={canCreateSession}
                  onArchiveSession={(session) => void archiveSession(session)}
                  onNewSession={() => void createSession(activeWorkspace, "replace")}
                  onNewWorkspaceSession={(workspace) => void createSession(workspace, "replace")}
                  onOpenChange={setSidebarOpen}
                  onOpenWorkspace={() => void openWorkspace()}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onSelectSession={(session, mode) => selectSession(session, mode)}
                  onSelectWorkspace={setActiveWorkspace}
                  onWidthChange={setSidebarWidth}
                  open={sidebarOpen}
                  paneSessionIds={paneSessionIds}
                  width={sidebarWidth}
                  workspaces={workspaces}
                />

                <main className="relative flex min-w-0 flex-1 flex-col bg-canvas">
                  <header className="relative flex h-9 shrink-0 items-center px-3">
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
                      {!hasPanes ? <ChatTopBar activeWorkspace={activeWorkspace} /> : null}
                    </div>
                    <div className="flex flex-1 items-center justify-end pr-2">
                      <HeaderActions
                        activeWorkspace={activeWorkspace}
                        canSplit={canCreateSession && paneSessions.length < MAX_PANES}
                        environmentStats={environmentStats}
                        inspectorOpen={inspectorOpen}
                        onNewParallelTask={() => void createSession(activeWorkspace, "split")}
                        onToggleInspector={() => setInspectorOpen((open) => !open)}
                        showParallel={hasPanes}
                      />
                    </div>
                  </header>

                  {sessionCreateError ? (
                    <div className="mx-6 mb-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
                      {sessionCreateError}
                    </div>
                  ) : null}

                  <AnimatePresence initial={false} mode="wait">
                    {hasPanes ? (
                      <m.div
                        animate={{ opacity: 1 }}
                        className="flex min-h-0 flex-1"
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        key="conversation"
                        transition={{ duration: 0.12, ease: "easeOut" }}
                      >
                        {paneSessions.map((session, index) => (
                          <ChatPane
                            activity={activityBySession[session.id]}
                            contextUsage={contextUsageBySession[session.id]}
                            defaultModel={model}
                            focused={index === focusedPane}
                            hub={hubRef.current}
                            key={session.id}
                            models={models}
                            onClose={paneSessions.length > 1 ? () => closePane(index) : undefined}
                            onFocus={() => setFocusedPane(index)}
                            onModelChange={setModel}
                            onModelConfigChange={(next, thinkingLevel) =>
                              void updateModelThinking(next, thinkingLevel)
                            }
                            onOpenReview={() => {
                              setFocusedPane(index);
                              setInspectorOpen(true);
                            }}
                            onSessionsChanged={() => void refreshSessions()}
                            session={session}
                            showHeader={paneSessions.length > 1}
                            workspace={workspaceById.get(session.workspaceId) ?? activeWorkspace}
                          />
                        ))}
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
                        <div className="w-full max-w-[680px] -translate-y-8">
                          <Composer
                            canSubmit={canCreateSession}
                            contextItems={heroContextItems}
                            cwd={activeWorkspace?.rootPath}
                            hasSession={false}
                            model={model}
                            models={models}
                            onContextChange={setHeroContextItems}
                            onModelChange={(next) => void changeDefaultModel(next)}
                            onModelConfigChange={(next, thinkingLevel) =>
                              void updateModelThinking(next, thinkingLevel)
                            }
                            onSubmit={(message, context, delivery, attachments, skills) =>
                              void submitHeroPrompt(message, context, delivery, attachments, skills)
                            }
                            workspaceId={activeWorkspace?.id}
                          />
                          <div className="mt-4 flex items-center justify-center gap-2">
                            <Pill
                              disabled={!activeWorkspace}
                              onClick={() => void createSession(activeWorkspace, "replace")}
                              shortcut="⌥Tab"
                            >
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

                {hasPanes ? (
                  <Inspector
                    activeWorkspace={activeWorkspace}
                    cwd={activeCwd}
                    sessionId={focusedSession?.id}
                    onOpenChange={setInspectorOpen}
                    onWidthChange={setInspectorWidth}
                    open={inspectorOpen}
                    securityState={securityState}
                    width={inspectorWidth}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </TooltipProvider>
    </LazyMotion>
  );
}

/**
 * 顶部 menubar 行 —— 整行 36px 高，自绘 titlebar：
 *   - 左侧 BrandMark + File/Edit/View/Help（menubar 区，app-drag）
 *   - 右侧 WindowControls 自绘 min/max/close（无 native overlay，无越界）
 * 这样 hover 命中区域完全由 CSS 控制，永远不会超出 menubar 高度。
 */
function MenuBar() {
  return (
    <div className="app-drag flex h-9 shrink-0 items-center border-hairline-strong border-b bg-canvas">
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
 * 自绘 Caption Buttons —— 严格被 menubar 36px 高度包覆，hover 区域不越界。
 * Windows 风格：min/max/close 三键，close hover 用 #c42b1c 高亮。
 * 命中区域 46×36（与 Windows 11 native caption buttons 一致），但绘制完全 CSS 控制。
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

function ChatTopBar({ activeWorkspace }: { activeWorkspace: WorkspaceInfo | null }) {
  return (
    <div className="app-no-drag flex items-center gap-3 text-sm font-normal text-fg-subtle">
      <TopBarItem icon={<IconFolder size={15} stroke={1.65} />}>
        {activeWorkspace?.displayName ?? "No workspace"}
      </TopBarItem>
      <TopBarItem icon={<IconDeviceLaptop size={15} stroke={1.65} />}>Work locally</TopBarItem>
      <TopBarItem icon={<IconGitBranch size={15} stroke={1.65} />}>main</TopBarItem>
    </div>
  );
}

function TopBarItem({ children, icon }: { children: string; icon: ReactNode }) {
  return (
    <button
      className="flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-hover hover:text-fg-muted"
      type="button"
    >
      <span className="text-fg-faint">{icon}</span>
      <span className="max-w-40 truncate">{children}</span>
      <IconChevronDown className="text-fg-faint" size={11} stroke={2} />
    </button>
  );
}

function HeaderActions({
  activeWorkspace,
  canSplit,
  environmentStats,
  inspectorOpen,
  onNewParallelTask,
  onToggleInspector,
  showParallel,
}: {
  activeWorkspace: WorkspaceInfo | null;
  canSplit: boolean;
  environmentStats: { added: number; removed: number };
  inspectorOpen: boolean;
  onNewParallelTask(): void;
  onToggleInspector(): void;
  showParallel: boolean;
}) {
  return (
    <div className="app-no-drag flex h-7 items-center gap-1">
      {showParallel ? (
        <ToolbarButton
          disabled={!canSplit}
          label={canSplit ? "New parallel agent (own worktree)" : "Pane limit reached"}
          onClick={onNewParallelTask}
        >
          <IconColumns size={15} stroke={1.65} />
        </ToolbarButton>
      ) : null}
      <EnvironmentPopover activeWorkspace={activeWorkspace} environmentStats={environmentStats} />
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
  environmentStats,
}: {
  activeWorkspace: WorkspaceInfo | null;
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
                      <span>main</span>
                      <IconChevronDown className="text-fg-faint" size={12} stroke={2} />
                    </EnvironmentRow>
                    <EnvironmentRow icon={<IconVersions size={17} stroke={1.65} />}>
                      <span>Commit or push</span>
                    </EnvironmentRow>
                  </div>

                  <div className="my-5 h-px bg-hairline-soft" />

                  <section>
                    <h2 className="mb-3 text-sm font-normal text-fg-subtle">Progress</h2>
                    <div className="space-y-2.5 text-sm text-fg-muted">
                      <ProgressRow done>梳理 Chat 顶部栏与 Session 状态</ProgressRow>
                      <ProgressRow done>核对 BaseUI、Motion 官方用法</ProgressRow>
                      <ProgressRow done>重构极简顶部栏显示逻辑</ProgressRow>
                      <ProgressRow>弹出面板动画与视觉校准</ProgressRow>
                    </div>
                  </section>

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

function ProgressRow({ children, done = false }: { children: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border",
          done ? "border-transparent bg-fg-subtle text-canvas" : "border-fg-faint text-transparent",
        )}
      >
        {done ? <IconCheck size={12} stroke={2.2} /> : null}
      </span>
      <span className="leading-snug">{children}</span>
    </div>
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

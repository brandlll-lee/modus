import { Popover } from "@base-ui/react/popover";
import {
  IconBrandVisualStudio,
  IconCheck,
  IconChevronDown,
  IconCircles,
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
import { SIDEBAR_MIN_WIDTH, Sidebar } from "../components/Sidebar";
import { ImageViewerProvider } from "../components/ui/ImageViewer";
import { NativeSurfaceProvider } from "../components/ui/nativeSurface";
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
import { INSPECTOR_MIN_WIDTH, Inspector } from "../features/inspector/Inspector";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { cn } from "../lib/cn";

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
  const [layoutWidth, setLayoutWidth] = useState(0);

  const hubRef = useRef(new AgentEventHub());
  const activeSessionIdRef = useRef<string | undefined>(undefined);
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
        event.type === "runtime.error"
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
      await refreshSessions();
      setActiveSessionId(session.id);
      return session;
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  function selectSession(session: AgentSessionInfo): void {
    setSessionCreateError(undefined);
    setActiveWorkspace(
      workspaces.find((workspace) => workspace.id === session.workspaceId) ?? activeWorkspace,
    );
    setActiveSessionId(session.id);
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
    const session = await createSession(activeWorkspace);
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
  const activeRunning = activeSession
    ? (activityBySession[activeSession.id]?.running ?? false)
    : false;

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

              <div className="flex min-h-0 flex-1" ref={layoutRowRef}>
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
                      onNewSession={() => void createSession(activeWorkspace)}
                      onNewWorkspaceSession={(workspace) => void createSession(workspace)}
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
                      className="relative flex flex-1 flex-col bg-canvas"
                      style={{ minWidth: MAIN_MIN_WIDTH }}
                    >
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
                          {!hasSession ? <ChatTopBar activeWorkspace={activeWorkspace} /> : null}
                        </div>
                        <div className="flex flex-1 items-center justify-end pr-2">
                          <HeaderActions
                            activeWorkspace={activeWorkspace}
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
                              key={activeSession.id}
                              models={models}
                              onModelChange={setModel}
                              onModelConfigChange={(next, thinkingLevel) =>
                                void updateModelThinking(next, thinkingLevel)
                              }
                              onOpenReview={() => setInspectorOpen(true)}
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
                                  void submitHeroPrompt(
                                    message,
                                    context,
                                    delivery,
                                    attachments,
                                    skills,
                                  )
                                }
                                workspaceId={activeWorkspace?.id}
                              />
                              <div className="mt-4 flex items-center justify-center gap-2">
                                <Pill
                                  disabled={!activeWorkspace}
                                  onClick={() => void createSession(activeWorkspace)}
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

                    {hasSession ? (
                      <Inspector
                        activeWorkspace={activeWorkspace}
                        cwd={activeCwd}
                        sessionId={activeSession?.id}
                        maxWidth={inspectorMaxWidth}
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
          </ImageViewerProvider>
        </NativeSurfaceProvider>
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
  environmentStats,
  inspectorOpen,
  onToggleInspector,
}: {
  activeWorkspace: WorkspaceInfo | null;
  environmentStats: { added: number; removed: number };
  inspectorOpen: boolean;
  onToggleInspector(): void;
}) {
  return (
    <div className="app-no-drag flex h-7 items-center gap-1">
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

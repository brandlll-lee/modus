import { Popover } from "@base-ui/react/popover";
import {
  IconBrandVisualStudio,
  IconCheck,
  IconChevronDown,
  IconCircles,
  IconDeviceLaptop,
  IconFolder,
  IconGitBranch,
  IconLayoutSidebarRight,
  IconListDetails,
  IconSettings,
  IconSourceCode,
  IconVersions,
} from "@tabler/icons-react";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { type ReactNode, type UIEvent, useCallback, useEffect, useState } from "react";
import type { SecurityState } from "../../../preload/types";
import type {
  AgentEvent,
  AgentSessionInfo,
  ContextItem,
  FileDiff,
  ModelInfo,
  WorkspaceInfo,
} from "../../../shared/contracts";
import { Sidebar } from "../components/Sidebar";
import { Tooltip, TooltipProvider } from "../components/ui/Tooltip";
import { Timeline } from "../features/agent/Timeline";
import { Composer } from "../features/composer/Composer";
import { Inspector } from "../features/inspector/Inspector";
import { cn } from "../lib/cn";

export function App() {
  const [securityState, setSecurityState] = useState<SecurityState | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [agentSession, setAgentSession] = useState<AgentSessionInfo | null>(null);
  const [agentSessions, setAgentSessions] = useState<AgentSessionInfo[]>([]);
  const [agentEvents, setAgentEvents] = useState<Array<{ id: string; event: AgentEvent }>>([]);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("pi-default");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(384);
  const [environmentStats, setEnvironmentStats] = useState({ added: 0, removed: 0 });
  const [pinnedUserMessageId, setPinnedUserMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (!window.modus) {
      return;
    }
    void window.modus.app.securityState().then(setSecurityState);
    void window.modus.workspace.list().then((items: WorkspaceInfo[]) => {
      setWorkspaces(items);
      setActiveWorkspace(items[0] ?? null);
    });
    void window.modus.agent.list().then(setAgentSessions);
    void window.modus.model.list().then((items: ModelInfo[]) => {
      setModels(items);
      setModel(items.find((item) => item.available)?.id ?? items[0]?.id ?? "pi-default");
    });
    return window.modus.agent.onEvent((event: AgentEvent) => {
      setAgentEvents((events) => [
        ...events.slice(-200),
        { id: `${Date.now()}:${crypto.randomUUID()}`, event },
      ]);
      if (
        event.type === "agent.started" ||
        event.type === "agent.ended" ||
        event.type === "message.completed" ||
        event.type === "runtime.error"
      ) {
        void window.modus.agent.list().then(setAgentSessions);
      }
    });
  }, []);

  async function openWorkspace(): Promise<void> {
    const workspace = await window.modus.workspace.open();
    if (!workspace) {
      return;
    }
    setActiveWorkspace(workspace);
    setWorkspaces(await window.modus.workspace.list());
    setAgentSessions(await window.modus.agent.list());
  }

  async function createSession(workspace: WorkspaceInfo | null): Promise<AgentSessionInfo | null> {
    if (!workspace) {
      return null;
    }
    const session = await window.modus.agent.create({
      workspaceId: workspace.id,
      cwd: workspace.rootPath,
      model,
      title: "Modus local agent",
    });
    setActiveWorkspace(workspace);
    setAgentSession(session);
    setAgentEvents([]);
    setAgentSessions(await window.modus.agent.list());
    return session;
  }

  async function ensureSession(): Promise<AgentSessionInfo | null> {
    if (agentSession) {
      return agentSession;
    }
    return await createSession(activeWorkspace);
  }

  async function selectSession(session: AgentSessionInfo): Promise<void> {
    setAgentSession(session);
    setActiveWorkspace(
      workspaces.find((workspace) => workspace.id === session.workspaceId) ?? activeWorkspace,
    );
    setAgentEvents(await window.modus.agent.listEvents(session.id));
  }

  async function submitPrompt(message: string, context: ContextItem[]): Promise<void> {
    if (!message.trim()) {
      return;
    }
    const session = await ensureSession();
    if (!session) {
      return;
    }
    const messageId = `local-user:${crypto.randomUUID()}`;
    setAgentEvents((events) => [
      ...events,
      {
        id: `${Date.now()}:${messageId}:start`,
        event: { type: "message.started", sessionId: session.id, messageId, role: "user" },
      },
      {
        id: `${Date.now()}:${messageId}:delta`,
        event: { type: "message.delta", sessionId: session.id, messageId, delta: message },
      },
      {
        id: `${Date.now()}:${messageId}:completed`,
        event: { type: "message.completed", sessionId: session.id, messageId },
      },
    ]);
    void window.modus.agent
      .prompt({ context, sessionId: session.id, message })
      .then(() => window.modus.agent.list())
      .then(setAgentSessions);
  }

  async function changeModel(nextModel: string): Promise<void> {
    setModel(nextModel);
    await window.modus.model.setDefault(nextModel);
    if (agentSession) {
      const nextSession = await window.modus.agent.setModel({
        sessionId: agentSession.id,
        model: nextModel,
      });
      setAgentSession(nextSession);
    }
  }

  const cycleModel = useCallback(
    async (direction: "forward" | "backward"): Promise<void> => {
      const next = await window.modus.agent.cycleModel({
        direction,
        sessionId: agentSession?.id,
      });
      setModel(next.id);
    },
    [agentSession],
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

  const hasSession = Boolean(agentSession);

  useEffect(() => {
    if (!activeWorkspace?.rootPath) {
      setEnvironmentStats({ added: 0, removed: 0 });
      return;
    }

    void window.modus.diff.read({ cwd: activeWorkspace.rootPath }).then((fileDiff: FileDiff) => {
      setEnvironmentStats(getDiffTotals(fileDiff.diff));
    });
  }, [activeWorkspace]);

  function handleTimelineScroll(event: UIEvent<HTMLDivElement>): void {
    const container = event.currentTarget;
    const userMessages = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-role="user"]'),
    );
    const containerTop = container.getBoundingClientRect().top;
    const pinned = userMessages
      .filter((element) => element.getBoundingClientRect().top <= containerTop + 16)
      .at(-1);

    setPinnedUserMessageId(pinned?.dataset.messageId ?? null);
  }

  return (
    // LazyMotion + domAnimation：只加载 transform/opacity 等 DOM 动画 features，bundle 缩减 60%、
    // 减少 SSR/初始化 cost。所有 motion. 改用更轻量的 m. 组件。
    <LazyMotion features={domAnimation} strict>
      <TooltipProvider>
        <div className="app-root flex h-screen flex-col bg-canvas text-fg">
          {/* Row 1: Cursor 风格 menubar（32px）—— 品牌 + File/Edit/View/Help + 右侧给 window controls 留位 */}
          <MenuBar />

          {/* Row 2: 三栏内容 */}
          <div className="flex min-h-0 flex-1">
            <Sidebar
              activeWorkspace={activeWorkspace}
              agentSession={agentSession}
              agentSessions={agentSessions}
              canCreateSession={Boolean(activeWorkspace) && !hasSession}
              onNewSession={() => void ensureSession()}
              onNewWorkspaceSession={(workspace) => void createSession(workspace)}
              onOpenWorkspace={() => void openWorkspace()}
              onSelectSession={(session) => void selectSession(session)}
              onSelectWorkspace={setActiveWorkspace}
              workspaces={workspaces}
            />

            <main className="relative flex min-w-0 flex-1 flex-col bg-canvas">
              {/* 面包屑栏 36px —— 居中三段 chip，右侧复刻 Cursor 的轻量图标区 */}
              <header className="relative flex h-9 shrink-0 items-center px-3">
                <div className="flex flex-1 items-center">
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

              <AnimatePresence initial={false} mode="wait">
                {hasSession ? (
                  <m.div
                    animate={{ opacity: 1 }}
                    className="flex min-h-0 flex-1 flex-col"
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key="conversation"
                    transition={{ duration: 0.12, ease: "easeOut" }}
                  >
                    <div
                      className="scroll-thin min-h-0 flex-1 overflow-y-auto"
                      onScroll={handleTimelineScroll}
                    >
                      <Timeline
                        agentEvents={agentEvents}
                        pinnedUserMessageId={pinnedUserMessageId}
                      />
                    </div>
                    <div className="shrink-0 px-6 pb-5">
                      <div className="mx-auto max-w-3xl">
                        <Composer
                          canSubmit={Boolean(activeWorkspace)}
                          contextItems={contextItems}
                          cwd={activeWorkspace?.rootPath}
                          hasSession
                          model={model}
                          models={models}
                          onContextChange={setContextItems}
                          onModelChange={(next) => void changeModel(next)}
                          onSubmit={(message, context) => void submitPrompt(message, context)}
                          workspaceId={activeWorkspace?.id}
                        />
                      </div>
                    </div>
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
                        canSubmit={Boolean(activeWorkspace)}
                        contextItems={contextItems}
                        cwd={activeWorkspace?.rootPath}
                        hasSession={false}
                        model={model}
                        models={models}
                        onContextChange={setContextItems}
                        onModelChange={(next) => void changeModel(next)}
                        onSubmit={(message, context) => void submitPrompt(message, context)}
                        workspaceId={activeWorkspace?.id}
                      />
                      <div className="mt-4 flex items-center justify-center gap-2">
                        <Pill
                          disabled={!activeWorkspace}
                          onClick={() => void ensureSession()}
                          shortcut="⌥Tab"
                        >
                          Plan New Idea
                        </Pill>
                        <Pill onClick={() => void openWorkspace()}>Use Your Model</Pill>
                      </div>
                    </div>
                    <p className="absolute bottom-5 text-xs font-normal text-fg-faint">
                      Bring your own model to Modus for local, private, context-aware agent work.
                    </p>
                  </m.div>
                )}
              </AnimatePresence>
            </main>

            {hasSession ? (
              <Inspector
                activeWorkspace={activeWorkspace}
                onOpenChange={setInspectorOpen}
                onWidthChange={setInspectorWidth}
                open={inspectorOpen}
                securityState={securityState}
                width={inspectorWidth}
              />
            ) : null}
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
    <div className="mr-1 flex size-7 items-center justify-center text-fg-muted">
      <svg
        aria-hidden
        fill="none"
        height="15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
        viewBox="0 0 24 24"
        width="15"
      >
        <title>Modus</title>
        <path d="M12 2.5l9 5v9l-9 5-9-5v-9z" />
        <path d="M12 7.5l4.5 2.5v5L12 17.5 7.5 15v-5z" />
      </svg>
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
      <HeaderIconButton
        active={inspectorOpen}
        label={inspectorOpen ? "Hide right sidebar" : "Show right sidebar"}
        onClick={onToggleInspector}
      >
        <IconLayoutSidebarRight size={15} stroke={1.65} />
      </HeaderIconButton>
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

function HeaderIconButton({
  children,
  label,
  active = false,
  onClick,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-fg-subtle",
          active ? "bg-active text-fg-subtle" : "text-fg-faint",
        )}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
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
      className="flex items-center gap-1.5 rounded-full border border-hairline bg-white/2.5 px-3 py-[5px] text-xs font-normal text-fg-muted transition-colors hover:bg-white/6 hover:text-fg active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/2.5 disabled:hover:text-fg-muted"
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

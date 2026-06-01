import { IconArrowUpRight, IconChevronDown, IconLayoutSidebarRight } from "@tabler/icons-react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import type { SecurityState } from "../../../preload/types";
import type { AgentEvent, AgentSessionInfo, WorkspaceInfo } from "../../../shared/contracts";
import { Sidebar } from "../components/Sidebar";
import { Tooltip, TooltipProvider } from "../components/ui/Tooltip";
import { cn } from "../lib/cn";
import { Timeline } from "../features/agent/Timeline";
import { Composer } from "../features/composer/Composer";
import { Inspector } from "../features/inspector/Inspector";

export function App() {
  const [securityState, setSecurityState] = useState<SecurityState | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [agentSession, setAgentSession] = useState<AgentSessionInfo | null>(null);
  const [agentEvents, setAgentEvents] = useState<Array<{ id: string; event: AgentEvent }>>([]);
  const [model, setModel] = useState("pi-default");

  useEffect(() => {
    if (!window.modus) {
      return;
    }
    void window.modus.app.securityState().then(setSecurityState);
    void window.modus.workspace.list().then((items: WorkspaceInfo[]) => {
      setWorkspaces(items);
      setActiveWorkspace(items[0] ?? null);
    });
    return window.modus.agent.onEvent((event: AgentEvent) => {
      setAgentEvents((events) => [
        ...events.slice(-20),
        { id: `${Date.now()}:${crypto.randomUUID()}`, event },
      ]);
    });
  }, []);

  async function openWorkspace(): Promise<void> {
    const workspace = await window.modus.workspace.open();
    if (!workspace) {
      return;
    }
    setActiveWorkspace(workspace);
    setWorkspaces(await window.modus.workspace.list());
  }

  async function ensureSession(): Promise<AgentSessionInfo | null> {
    if (agentSession) {
      return agentSession;
    }
    if (!activeWorkspace) {
      return null;
    }
    const session = await window.modus.agent.create({
      workspaceId: activeWorkspace.id,
      cwd: activeWorkspace.rootPath,
      title: "Modus local agent",
    });
    setAgentSession(session);
    return session;
  }

  async function submitPrompt(message: string): Promise<void> {
    if (!message.trim()) {
      return;
    }
    const session = await ensureSession();
    if (!session) {
      return;
    }
    void window.modus.agent.prompt({ sessionId: session.id, message });
  }

  const hasSession = Boolean(agentSession);

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
              canCreateSession={Boolean(activeWorkspace) && !hasSession}
              onNewSession={() => void ensureSession()}
              onOpenWorkspace={() => void openWorkspace()}
              onSelectWorkspace={setActiveWorkspace}
              workspaces={workspaces}
            />

            <main className="relative flex min-w-0 flex-1 flex-col bg-canvas">
              {/* 面包屑栏 36px —— 居中三段 chip，右侧复刻 Cursor 的轻量图标区 */}
              <header className="relative flex h-9 shrink-0 items-center px-3">
                <div className="flex-1" />
                <Breadcrumb activeWorkspace={activeWorkspace} />
                <div className="flex flex-1 items-center justify-end pr-2">
                  <HeaderActions />
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
                    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                      <Timeline agentEvents={agentEvents} />
                    </div>
                    <div className="shrink-0 px-6 pb-5">
                      <div className="mx-auto max-w-3xl">
                        <Composer
                          canSubmit={Boolean(activeWorkspace)}
                          hasSession
                          model={model}
                          onModelChange={setModel}
                          onSubmit={(message) => void submitPrompt(message)}
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
                        hasSession={false}
                        model={model}
                        onModelChange={setModel}
                        onSubmit={(message) => void submitPrompt(message)}
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
              <Inspector activeWorkspace={activeWorkspace} securityState={securityState} />
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
      <CaptionButton
        danger
        label="Close"
        onClick={() => void window.modus?.window.close()}
      >
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

function Breadcrumb({ activeWorkspace }: { activeWorkspace: WorkspaceInfo | null }) {
  return (
    <div className="app-no-drag flex items-center gap-0.5 text-sm font-normal text-fg-muted">
      <BreadcrumbItem>{activeWorkspace?.displayName ?? "No workspace"}</BreadcrumbItem>
      <BreadcrumbItem>main</BreadcrumbItem>
      <BreadcrumbItem>Local</BreadcrumbItem>
    </div>
  );
}

function BreadcrumbItem({ children }: { children: string }) {
  return (
    <button
      className="flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-hover hover:text-fg"
      type="button"
    >
      <span className="max-w-40 truncate">{children}</span>
      <IconChevronDown className="text-fg-faint" size={11} stroke={2} />
    </button>
  );
}

function HeaderActions() {
  return (
    <div className="app-no-drag flex h-7 items-center gap-1">
      <HeaderIconButton label="Open editor window">
        <IconArrowUpRight size={13} stroke={1.65} />
      </HeaderIconButton>
      <HeaderIconButton label="Toggle right sidebar">
        <IconLayoutSidebarRight size={14} stroke={1.55} />
      </HeaderIconButton>
    </div>
  );
}

function HeaderIconButton({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
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

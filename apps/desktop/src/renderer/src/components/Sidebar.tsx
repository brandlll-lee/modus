import {
  IconArchive,
  IconChevronRight,
  IconClock,
  IconColumns,
  IconDeviceMobile,
  IconEdit,
  IconFolder,
  IconFolderPlus,
  IconGridDots,
  IconGripHorizontal,
  IconLayoutSidebar,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { AnimatePresence, animate, m, useMotionValue } from "motion/react";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AgentSessionInfo, WorkspaceInfo } from "../../../shared/contracts";
import type { SessionActivity } from "../features/agent/agentEventHub";
import { SessionStatusDot } from "../features/agent/SessionStatusDot";
import { cn } from "../lib/cn";
import { ToolbarButton } from "./ui/ToolbarButton";

const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

type SidebarProps = {
  workspaces: WorkspaceInfo[];
  activeWorkspace: WorkspaceInfo | null;
  agentSessions: AgentSessionInfo[];
  /** Sessions currently open as panes — highlighted as active rows. */
  paneSessionIds: string[];
  /** Live run/needs-input/unread state per session for the status dots. */
  activityBySession: Record<string, SessionActivity>;
  open: boolean;
  width: number;
  onOpenWorkspace(): void;
  onSelectWorkspace(workspace: WorkspaceInfo): void;
  /** mode "split" opens the session in a new pane (Ctrl/Cmd+click or split icon). */
  onSelectSession(session: AgentSessionInfo, mode: "replace" | "split"): void;
  onNewSession(): void;
  onNewWorkspaceSession(workspace: WorkspaceInfo): void;
  onArchiveSession(session: AgentSessionInfo): void;
  onOpenSettings(): void;
  onOpenChange(open: boolean): void;
  onWidthChange(width: number): void;
  canCreateSession: boolean;
};

export function Sidebar({
  workspaces,
  activeWorkspace,
  agentSessions,
  paneSessionIds,
  activityBySession,
  open,
  width,
  onOpenWorkspace,
  onSelectWorkspace,
  onSelectSession,
  onNewSession,
  onNewWorkspaceSession,
  onArchiveSession,
  onOpenSettings,
  onOpenChange,
  onWidthChange,
  canCreateSession,
}: SidebarProps) {
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const sessionsByWorkspace = groupSessionsByWorkspace(agentSessions);

  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const latestWidthRef = useRef(width);
  // Width is a motion value, not React state: a drag calls `.set()` which writes
  // straight to the DOM without re-rendering App + the heavy Timeline on every
  // pointermove. `contentWidth` keeps the inner content laid out at a stable
  // width so the panel *clips* (instead of reflowing) while it slides shut —
  // exactly how the right inspector behaves.
  const panelWidth = useMotionValue(open ? width : 0);
  const contentWidth = useMotionValue(width);

  // Drive the open/close animation and keep the motion value in sync with an
  // externally committed width. Never re-animate mid-drag (the pointer owns it).
  useEffect(() => {
    if (dragStartRef.current) {
      return;
    }
    latestWidthRef.current = width;
    if (open) {
      contentWidth.set(width);
      const controls = animate(panelWidth, width, SIDEBAR_TRANSITION);
      return () => controls.stop();
    }
    // Freeze content at its current visible width, then slide the panel to 0 so
    // the text clips away cleanly with no last-frame reflow or snap.
    contentWidth.set(Math.max(panelWidth.get(), 1));
    const controls = animate(panelWidth, 0, SIDEBAR_TRANSITION);
    return () => controls.stop();
  }, [open, width, panelWidth, contentWidth]);

  const startResize = (event: PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    dragStartRef.current = { x: event.clientX, width };
    latestWidthRef.current = width;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const resize = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!dragStartRef.current) {
      return;
    }
    // Left panel: the handle is on the right edge, so dragging right widens.
    const nextWidth = Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(
        SIDEBAR_MIN_WIDTH,
        dragStartRef.current.width + event.clientX - dragStartRef.current.x,
      ),
    );
    latestWidthRef.current = nextWidth;
    panelWidth.set(nextWidth);
    contentWidth.set(nextWidth);
  };

  const stopResize = (): void => {
    if (!dragStartRef.current) {
      return;
    }
    dragStartRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const finalWidth = latestWidthRef.current;
    // Drag-to-collapse: releasing at (or near) the floor closes the panel and
    // keeps the last good width, so reopening never lands on a sliver.
    if (finalWidth < SIDEBAR_MIN_WIDTH + 24) {
      onOpenChange(false);
    } else {
      onWidthChange(finalWidth);
    }
  };

  return (
    <m.aside
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden bg-panel",
        open && "border-hairline-strong border-r",
      )}
      style={{ width: panelWidth }}
    >
      <m.div className="flex h-full flex-col bg-panel" style={{ width: contentWidth }}>
        <div className="scroll-thin flex-1 overflow-y-auto px-2.5 pt-4 pb-2">
          <NavRow
            disabled={!canCreateSession}
            icon={<IconEdit size={17} stroke={1.75} />}
            onClick={onNewSession}
          >
            New chat
          </NavRow>
          <NavRow icon={<IconSearch size={17} stroke={1.75} />}>Search</NavRow>
          <NavRow icon={<IconGridDots size={17} stroke={1.75} />}>Plugins</NavRow>
          <NavRow icon={<IconClock size={17} stroke={1.75} />}>Automations</NavRow>
          <NavRow
            icon={
              <span className="relative flex">
                <IconDeviceMobile size={17} stroke={1.75} />
                <span className="-right-0.5 -bottom-0.5 absolute size-1.5 rounded-full bg-focus-ring-soft" />
              </span>
            }
          >
            Remote control
          </NavRow>

          <SectionHeader
            expanded={projectsExpanded}
            onToggle={() => setProjectsExpanded((expanded) => !expanded)}
          >
            Projects
          </SectionHeader>

          <AnimatePresence initial={false}>
            {projectsExpanded ? (
              <m.div
                animate={{ height: "auto", opacity: 1 }}
                className="overflow-hidden"
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {workspaces.length === 0 ? (
                  <NavRow
                    icon={<IconFolder size={17} stroke={1.6} />}
                    muted
                    onClick={onOpenWorkspace}
                  >
                    Open a repository…
                  </NavRow>
                ) : (
                  workspaces.map((workspace) => (
                    <WorkspaceItem
                      activityBySession={activityBySession}
                      isActive={activeWorkspace?.id === workspace.id}
                      key={workspace.id}
                      onArchiveSession={onArchiveSession}
                      onNewSession={() => onNewWorkspaceSession(workspace)}
                      onSelect={() => onSelectWorkspace(workspace)}
                      onSelectSession={onSelectSession}
                      paneSessionIds={paneSessionIds}
                      sessions={sessionsByWorkspace.get(workspace.id) ?? []}
                      workspace={workspace}
                    />
                  ))
                )}

                <div className="mt-1">
                  <NavRow
                    icon={<IconFolderPlus size={17} stroke={1.6} />}
                    muted
                    onClick={onOpenWorkspace}
                  >
                    Open workspace
                  </NavRow>
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>

          <SectionLabel>Chats</SectionLabel>
        </div>

        <div className="app-no-drag flex items-center gap-1 px-2.5 pt-2 pb-3">
          <div className="min-w-0 flex-1">
            <NavRow icon={<IconSettings size={17} stroke={1.75} />} onClick={onOpenSettings}>
              Settings
            </NavRow>
          </div>
          <ToolbarButton label="Collapse sidebar" onClick={() => onOpenChange(false)}>
            <IconLayoutSidebar size={15} stroke={1.65} />
          </ToolbarButton>
        </div>
      </m.div>
      {open ? (
        <button
          aria-label="Resize left panel"
          className="app-no-drag absolute top-0 right-0 bottom-0 z-20 w-1 cursor-col-resize hover:bg-chip-strong"
          onPointerCancel={stopResize}
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={stopResize}
          type="button"
        />
      ) : null}
    </m.aside>
  );
}

function WorkspaceItem({
  workspace,
  isActive,
  paneSessionIds,
  activityBySession,
  sessions,
  onSelect,
  onSelectSession,
  onNewSession,
  onArchiveSession,
}: {
  workspace: WorkspaceInfo;
  isActive: boolean;
  paneSessionIds: string[];
  activityBySession: Record<string, SessionActivity>;
  sessions: AgentSessionInfo[];
  onSelect(): void;
  onSelectSession(session: AgentSessionInfo, mode: "replace" | "split"): void;
  onNewSession(): void;
  onArchiveSession(session: AgentSessionInfo): void;
}) {
  return (
    <>
      <ProjectRow
        isActive={isActive}
        onClick={onSelect}
        onCreate={(event) => {
          event.stopPropagation();
          onNewSession();
        }}
        title={workspace.rootPath}
      >
        {workspace.displayName}
      </ProjectRow>
      {sessions.map((session) => (
        <SessionRow
          activity={activityBySession[session.id]}
          isActive={paneSessionIds.includes(session.id)}
          key={session.id}
          onArchive={(event) => {
            event.stopPropagation();
            onArchiveSession(session);
          }}
          onSelect={(event) =>
            onSelectSession(session, event.ctrlKey || event.metaKey ? "split" : "replace")
          }
          onSplit={(event) => {
            event.stopPropagation();
            onSelectSession(session, "split");
          }}
          title={session.title}
          updatedAt={session.updatedAt}
        />
      ))}
    </>
  );
}

function SessionRow({
  title,
  updatedAt,
  isActive,
  activity,
  onSelect,
  onSplit,
  onArchive,
}: {
  title: string;
  updatedAt: string;
  isActive: boolean;
  activity: SessionActivity | undefined;
  onSelect(event: MouseEvent<HTMLButtonElement>): void;
  onSplit(event: MouseEvent<HTMLButtonElement>): void;
  onArchive(event: MouseEvent<HTMLButtonElement>): void;
}) {
  const hasStatus = Boolean(
    activity && (activity.running || activity.needsInput || activity.unread || activity.failed),
  );
  return (
    <m.div
      className={cn(
        "group flex h-[34px] w-full items-center rounded-lg pr-1 pl-[30px] text-sm font-normal transition-colors hover:bg-hover",
        isActive ? "bg-active text-fg" : "text-fg-muted hover:text-fg",
      )}
      layout
      transition={{ duration: 0.14, ease: "easeOut" }}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-1 pl-3 text-left"
        onClick={onSelect}
        title="Open · Ctrl+click to open in a split"
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {hasStatus ? <SessionStatusDot activity={activity} className="ml-1" /> : null}
        <span
          className={cn(
            "shrink-0 text-xs font-normal text-fg-faint group-hover:hidden",
            hasStatus ? "ml-1" : "ml-2",
          )}
        >
          {formatRelativeTime(updatedAt)}
        </span>
      </button>
      <span className="ml-1 hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        <IconButton label="Open in split pane" onClick={onSplit}>
          <IconColumns size={14} stroke={1.8} />
        </IconButton>
        <IconButton label="Archive" onClick={onArchive}>
          <IconArchive size={14} stroke={1.8} />
        </IconButton>
      </span>
    </m.div>
  );
}

function ProjectRow({
  children,
  isActive,
  onClick,
  onCreate,
  title,
}: {
  children: ReactNode;
  isActive: boolean;
  onClick(): void;
  onCreate(event: MouseEvent<HTMLButtonElement>): void;
  title?: string;
}) {
  return (
    <m.div
      className={cn(
        "group flex h-[36px] w-full items-center rounded-lg pr-1 text-sm font-normal transition-colors hover:bg-hover",
        isActive ? "text-fg" : "text-fg-muted hover:text-fg",
      )}
      layout
      transition={{ duration: 0.14, ease: "easeOut" }}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-3 px-2 text-left"
        onClick={onClick}
        title={title}
        type="button"
      >
        <span className={cn("shrink-0", isActive ? "text-fg" : "text-fg-subtle")}>
          <IconFolder size={17} stroke={1.6} />
        </span>
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </button>
      <HoverActions onCreate={onCreate} />
    </m.div>
  );
}

function NavRow({
  icon,
  children,
  onClick,
  active = false,
  muted = false,
  disabled = false,
  trailing,
  layoutHighlight = false,
  highlight = false,
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  muted?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  layoutHighlight?: boolean;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <button
      className={cn(
        "group relative flex h-[36px] w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-normal transition-colors",
        active ? "text-fg hover:bg-hover" : "text-fg-muted hover:bg-hover hover:text-fg",
        highlight && "bg-active text-fg hover:bg-hover",
        muted && "text-fg-subtle hover:text-fg-muted",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-fg-subtle",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {active && layoutHighlight ? (
        <m.span
          className="absolute inset-0 rounded-lg bg-active"
          layoutId="sidebar-active"
          transition={{ duration: 0.12, ease: "easeOut" }}
        />
      ) : null}
      <span
        className={cn(
          "relative shrink-0",
          active || highlight ? "text-fg" : "text-fg-subtle group-hover:text-fg-muted",
        )}
      >
        {icon}
      </span>
      <span className="relative flex min-w-0 flex-1 items-center truncate">{children}</span>
      {trailing ? <span className="relative shrink-0">{trailing}</span> : null}
    </button>
  );
}

function HoverActions({ onCreate }: { onCreate(event: MouseEvent<HTMLButtonElement>): void }) {
  return (
    <span className="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <IconButton label="More">
        <IconGripHorizontal size={14} stroke={1.8} />
      </IconButton>
      <IconButton label="New session" onClick={onCreate}>
        <IconEdit size={14} stroke={1.8} />
      </IconButton>
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <m.button
      aria-label={label}
      className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-active hover:text-fg-muted"
      onClick={onClick}
      type="button"
      whileTap={{ scale: 0.96 }}
    >
      {children}
    </m.button>
  );
}

function SectionHeader({
  children,
  expanded,
  onToggle,
}: {
  children: string;
  expanded: boolean;
  onToggle(): void;
}) {
  return (
    <div className="group mt-5 mb-1 flex h-7 items-center px-2 text-sm font-normal text-fg-faint">
      <button
        aria-expanded={expanded}
        className="flex items-center gap-1.5 transition-colors hover:text-fg-subtle"
        onClick={onToggle}
        type="button"
      >
        <span>{children}</span>
        <m.span
          animate={{ rotate: expanded ? 90 : 0 }}
          className="flex size-3.5 items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <IconChevronRight size={13} stroke={1.7} />
        </m.span>
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="px-2 pt-5 pb-1 text-sm font-normal text-fg-faint">{children}</div>;
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 14) {
    return `${days}d`;
  }

  return `${Math.floor(days / 7)}w`;
}

function groupSessionsByWorkspace(sessions: AgentSessionInfo[]): Map<string, AgentSessionInfo[]> {
  const grouped = new Map<string, AgentSessionInfo[]>();

  for (const session of sessions) {
    const workspaceSessions = grouped.get(session.workspaceId) ?? [];
    workspaceSessions.push(session);
    grouped.set(session.workspaceId, workspaceSessions);
  }

  return grouped;
}

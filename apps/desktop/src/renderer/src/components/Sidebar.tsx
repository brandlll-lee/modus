import { Menu } from "@base-ui/react/menu";
import {
  IconChevronRight,
  IconDots,
  IconEdit,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconLayoutSidebar,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { m, useMotionValue, useReducedMotion } from "motion/react";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AgentSessionInfo,
  SessionDeletionResult,
  WorkspaceInfo,
} from "../../../shared/contracts";
import type { SessionActivity } from "../features/agent/agentEventHub";
import { SessionStatusDot } from "../features/agent/SessionStatusDot";
import { cn } from "../lib/cn";
import { useScrollFade } from "../lib/useScrollFade";
import { NavItem } from "./layout/NavItem";
import { SIDEBAR_MIN_WIDTH } from "./layout/usePanelLayout";
import { SessionDeleteDialog } from "./SessionDeleteDialog";
import { CollapsibleMotion } from "./ui/CollapsibleMotion";
import { SearchField } from "./ui/SearchField";
import { TOOLBAR_ICON, ToolbarButton } from "./ui/ToolbarButton";

const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

const SB_RAIL = "pointer-events-none flex w-4 shrink-0 items-center justify-center";
const SB_ROW = "navigation-row";
const SB_SESSION = "navigation-row relative pl-[calc(8px+var(--spacing-nav-indent))]";
const SB_ICON = 16;
const SB_STROKE = 1.5;

type SidebarProps = {
  workspaces: WorkspaceInfo[];
  agentSessions: AgentSessionInfo[];
  activeSessionId?: string | undefined;
  /** Live run/needs-input/unread state per session for the status dots. */
  activityBySession: Record<string, SessionActivity>;
  open: boolean;
  width: number;
  /** Upper bound from App so the panel can't crush the main column's min width. */
  maxWidth: number;
  onOpenWorkspace(): void;
  onSelectSession(session: AgentSessionInfo): void;
  onNewSession(): void;
  onNewWorkspaceSession(workspace: WorkspaceInfo): void;
  onPinSession(session: AgentSessionInfo, pinned: boolean): void;
  onDeleteSession(session: AgentSessionInfo): Promise<SessionDeletionResult>;
  onPinProject(id: string, pinned: boolean): void;
  onRenameProject(id: string, displayName: string): void;
  onDeleteProjectChats(id: string): Promise<SessionDeletionResult[]>;
  onRemoveProject(id: string): void;
  onRevealProject(id: string): void;
  onOpenChange(open: boolean): void;
  onWidthChange(width: number): void;
  canCreateSession: boolean;
};

export function Sidebar({
  workspaces,
  agentSessions,
  activeSessionId,
  activityBySession,
  open,
  width,
  maxWidth,
  onOpenWorkspace,
  onSelectSession,
  onNewSession,
  onNewWorkspaceSession,
  onPinSession,
  onDeleteSession,
  onPinProject,
  onRenameProject,
  onDeleteProjectChats,
  onRemoveProject,
  onRevealProject,
  onOpenChange,
  onWidthChange,
  canCreateSession,
}: SidebarProps) {
  const [deletion, setDeletion] = useState<{
    title: string;
    remove(): Promise<SessionDeletionResult[]>;
  }>();
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const sessionsByWorkspace = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    const visibleSessions = query
      ? agentSessions.filter((session) =>
          `${session.title} ${session.cwd}`.toLowerCase().includes(query),
        )
      : agentSessions;
    return groupSessionsByWorkspace(visibleSessions);
  }, [agentSessions, sessionQuery]);
  const { ref: scrollFadeRef, fadeTop, fadeBottom } = useScrollFade();

  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const latestWidthRef = useRef(width);
  const reduceMotion = useReducedMotion();
  const panelWidth = useMotionValue(width);

  useEffect(() => {
    if (!dragStartRef.current) panelWidth.set(width);
  }, [width, panelWidth]);

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
      maxWidth,
      Math.max(
        SIDEBAR_MIN_WIDTH,
        dragStartRef.current.width + event.clientX - dragStartRef.current.x,
      ),
    );
    latestWidthRef.current = nextWidth;
    panelWidth.set(nextWidth);
  };

  const stopResize = (): void => {
    if (!dragStartRef.current) {
      return;
    }
    dragStartRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const finalWidth = latestWidthRef.current;
    onWidthChange(finalWidth);
  };

  return (
    <m.aside
      ref={sidebarRef}
      tabIndex={-1}
      className="relative flex shrink-0 flex-col overflow-hidden border-r border-hairline bg-panel"
      layout={reduceMotion ? false : "size"}
      layoutDependency={open}
      style={{ transformOrigin: "left", width: open ? panelWidth : 0 }}
      transition={{ layout: SIDEBAR_TRANSITION }}
    >
      <m.div
        className="flex h-full flex-col bg-panel"
        layout={reduceMotion ? false : "position"}
        style={{ width: panelWidth }}
        transition={{ layout: SIDEBAR_TRANSITION }}
      >
        <div className="flex h-12 shrink-0 items-center justify-between px-4">
          <span className="text-lg font-semibold">Modus</span>
          <div className="flex items-center gap-1">
            <ToolbarButton
              label="Search chats"
              active={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <IconSearch size={16} stroke={SB_STROKE} />
            </ToolbarButton>
            <ToolbarButton label="Collapse sidebar" onClick={() => onOpenChange(false)}>
              <IconLayoutSidebar size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
            </ToolbarButton>
          </div>
        </div>
        <div className="px-3 pt-1 pb-3">
          <NavItem
            disabled={!canCreateSession}
            icon={<IconEdit size={SB_ICON} stroke={SB_STROKE} />}
            onClick={onNewSession}
          >
            New chat
          </NavItem>
          {searchOpen ? (
            <SearchField
              ariaLabel="Search chats"
              className="mx-1 mt-1 mb-2"
              onChange={setSessionQuery}
              placeholder="Search chats"
              value={sessionQuery}
            />
          ) : null}
        </div>

        <div
          className={cn(
            "scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2",
            (fadeTop || fadeBottom) && "scroll-fade",
          )}
          {...(fadeTop ? { "data-fade-top": "" } : {})}
          {...(fadeBottom ? { "data-fade-bottom": "" } : {})}
          ref={scrollFadeRef}
        >
          <SectionHeader
            expanded={projectsExpanded}
            onToggle={() => setProjectsExpanded((expanded) => !expanded)}
          >
            Projects
          </SectionHeader>

          <CollapsibleMotion open={projectsExpanded} preset="default">
            {workspaces.length === 0 ? (
              <NavItem
                icon={<IconFolder size={SB_ICON} stroke={SB_STROKE} />}
                className="text-fg-faint"
                onClick={onOpenWorkspace}
              >
                Open a repository…
              </NavItem>
            ) : (
              workspaces.map((workspace) => (
                <WorkspaceItem
                  activityBySession={activityBySession}
                  key={workspace.id}
                  onDeleteSession={(session) =>
                    setDeletion({
                      title: session.title,
                      remove: async () => [await onDeleteSession(session)],
                    })
                  }
                  onNewSession={() => onNewWorkspaceSession(workspace)}
                  onPinSession={onPinSession}
                  onSelectSession={onSelectSession}
                  activeSessionId={activeSessionId}
                  sessions={sessionsByWorkspace.get(workspace.id) ?? []}
                  workspace={workspace}
                  renaming={renamingId === workspace.id}
                  onStartRename={() => setRenamingId(workspace.id)}
                  onCommitRename={(name) => {
                    setRenamingId(null);
                    const next = name.trim();
                    if (next && next !== workspace.displayName) {
                      onRenameProject(workspace.id, next);
                    }
                  }}
                  onCancelRename={() => setRenamingId(null)}
                  onPin={() => onPinProject(workspace.id, !workspace.pinned)}
                  onReveal={() => onRevealProject(workspace.id)}
                  onDeleteChats={() =>
                    setDeletion({
                      title: `All sessions in ${workspace.displayName}`,
                      remove: () => onDeleteProjectChats(workspace.id),
                    })
                  }
                  onRemove={() => onRemoveProject(workspace.id)}
                />
              ))
            )}

            <div className="mt-1">
              <NavItem
                icon={<IconFolderPlus size={SB_ICON} stroke={SB_STROKE} />}
                className="text-fg-faint"
                onClick={onOpenWorkspace}
              >
                Open workspace
              </NavItem>
            </div>
          </CollapsibleMotion>
        </div>
      </m.div>
      {deletion ? (
        <SessionDeleteDialog
          title={deletion.title}
          onDelete={deletion.remove}
          onClose={() => setDeletion(undefined)}
          finalFocus={sidebarRef}
        />
      ) : null}
      {open ? (
        <button
          aria-label="Resize left panel"
          className="app-no-drag absolute top-0 right-0 bottom-0 z-20 w-3 cursor-col-resize"
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
  activeSessionId,
  activityBySession,
  sessions,
  onSelectSession,
  onNewSession,
  onPinSession,
  onDeleteSession,
  renaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onPin,
  onReveal,
  onDeleteChats,
  onRemove,
}: {
  workspace: WorkspaceInfo;
  activeSessionId?: string | undefined;
  activityBySession: Record<string, SessionActivity>;
  sessions: AgentSessionInfo[];
  onSelectSession(session: AgentSessionInfo): void;
  onNewSession(): void;
  onPinSession(session: AgentSessionInfo, pinned: boolean): void;
  onDeleteSession(session: AgentSessionInfo): void;
  renaming: boolean;
  onStartRename(): void;
  onCommitRename(name: string): void;
  onCancelRename(): void;
  onPin(): void;
  onReveal(): void;
  onDeleteChats(): void;
  onRemove(): void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const previewLimit = 5;
  const visibleSessions = (() => {
    if (showAllSessions || sessions.length <= previewLimit) {
      return sessions;
    }
    const preview = sessions.slice(0, previewLimit);
    if (!activeSessionId || preview.some((session) => session.id === activeSessionId)) {
      return preview;
    }
    const active = sessions.find((session) => session.id === activeSessionId);
    return active ? [...preview.slice(0, previewLimit - 1), active] : preview;
  })();
  const canToggleSessions = sessions.length > previewLimit;

  return (
    <>
      <ProjectRow
        expanded={expanded}
        pinned={workspace.pinned}
        renaming={renaming}
        onClick={() => {
          setExpanded((value) => !value);
        }}
        onCreate={(event) => {
          event.stopPropagation();
          onNewSession();
        }}
        onStartRename={onStartRename}
        onCommitRename={onCommitRename}
        onCancelRename={onCancelRename}
        onPin={onPin}
        onReveal={onReveal}
        onDeleteChats={onDeleteChats}
        onRemove={onRemove}
        title={workspace.rootPath}
      >
        {workspace.displayName}
      </ProjectRow>
      <CollapsibleMotion open={expanded} preset="default">
        {visibleSessions.map((session) => (
          <SessionRow
            activity={activityBySession[session.id]}
            isActive={activeSessionId === session.id}
            key={session.id}
            onDelete={(event) => {
              event.stopPropagation();
              onDeleteSession(session);
            }}
            onPin={(event) => {
              event.stopPropagation();
              onPinSession(session, !session.pinnedAt);
            }}
            onSelect={() => onSelectSession(session)}
            pinned={Boolean(session.pinnedAt)}
            title={session.title}
            updatedAt={session.updatedAt}
          />
        ))}
        {canToggleSessions ? (
          <button
            className={cn(SB_SESSION, "text-fg-faint hover:text-fg-subtle")}
            onClick={() => setShowAllSessions((value) => !value)}
            type="button"
          >
            {showAllSessions ? "Show less" : "Show more"}
          </button>
        ) : null}
      </CollapsibleMotion>
    </>
  );
}

function SessionRow({
  title,
  updatedAt,
  isActive,
  pinned,
  activity,
  onSelect,
  onPin,
  onDelete,
}: {
  title: string;
  updatedAt: string;
  isActive: boolean;
  pinned: boolean;
  activity: SessionActivity | undefined;
  onSelect(): void;
  onPin(event: MouseEvent<HTMLButtonElement>): void;
  onDelete(event: MouseEvent<HTMLButtonElement>): void;
}) {
  return (
    <m.div
      className={cn(
        SB_SESSION,
        "group",
        isActive ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
      layout
      transition={{ duration: 0.14, ease: "easeOut" }}
    >
      <span className="pointer-events-none absolute left-2 flex w-4 items-center justify-center">
        <SessionStatusDot activity={activity} />
      </span>
      <button
        className="flex min-w-0 flex-1 items-center pr-1 text-left"
        onClick={onSelect}
        title="Open"
        type="button"
      >
        <span className="min-w-0 flex-1 truncate-fade">{title}</span>
      </button>
      <span className="ml-0.5 hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        <span className="px-1 text-2xs font-normal text-fg-faint tabular-nums">
          {formatRelativeTime(updatedAt)}
        </span>
        <ToolbarButton label={pinned ? "Unpin chat" : "Pin chat"} onClick={onPin}>
          {pinned ? (
            <IconPinnedOff size={14} stroke={SB_STROKE} />
          ) : (
            <IconPin size={14} stroke={SB_STROKE} />
          )}
        </ToolbarButton>
        <ToolbarButton label="Delete" onClick={onDelete}>
          <IconTrash size={14} stroke={SB_STROKE} />
        </ToolbarButton>
      </span>
    </m.div>
  );
}

function ProjectRow({
  children,
  expanded,
  pinned,
  renaming,
  onClick,
  onCreate,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onPin,
  onReveal,
  onDeleteChats,
  onRemove,
  title,
}: {
  children: ReactNode;
  expanded: boolean;
  pinned: boolean;
  renaming: boolean;
  onClick(): void;
  onCreate(event: MouseEvent<HTMLButtonElement>): void;
  onStartRename(): void;
  onCommitRename(name: string): void;
  onCancelRename(): void;
  onPin(): void;
  onReveal(): void;
  onDeleteChats(): void;
  onRemove(): void;
  title?: string;
}) {
  const FolderIcon = expanded ? IconFolderOpen : IconFolder;
  const label = typeof children === "string" ? children : "";

  if (renaming) {
    return (
      <div className={cn(SB_ROW, "text-fg")}>
        <span className={cn(SB_RAIL, "text-fg-subtle")}>
          <FolderIcon size={SB_ICON} stroke={SB_STROKE} />
        </span>
        <RenameInput initialValue={label} onCancel={onCancelRename} onCommit={onCommitRename} />
      </div>
    );
  }

  return (
    <ProjectActions
      onDeleteChats={onDeleteChats}
      onPin={onPin}
      onRemove={onRemove}
      onRename={onStartRename}
      onReveal={onReveal}
      pinned={pinned}
    >
      {(menuOpen, trigger) => (
        <m.div
          className={cn(
            SB_ROW,
            "group text-fg-muted hover:bg-hover hover:text-fg",
            menuOpen && "bg-hover text-fg",
          )}
          layout
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          <button
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={onClick}
            title={title}
            type="button"
          >
            <span className={cn(SB_RAIL, "text-fg-muted group-hover:text-fg")}>
              <FolderIcon size={SB_ICON} stroke={SB_STROKE} />
            </span>
            <span className="min-w-0 truncate">{children}</span>
            <m.span
              animate={{ rotate: expanded ? 90 : 0 }}
              className="flex size-3 shrink-0 items-center justify-center text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <IconChevronRight size={12} stroke={SB_STROKE} />
            </m.span>
          </button>
          <span
            className={cn(
              "flex shrink-0 items-center gap-0.5 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
              menuOpen ? "opacity-100" : "opacity-0",
            )}
          >
            {trigger}
            <ToolbarButton label="New session" onClick={onCreate}>
              <IconEdit size={14} stroke={SB_STROKE} />
            </ToolbarButton>
          </span>
        </m.div>
      )}
    </ProjectActions>
  );
}

/**
 * Inline rename editor. The `committedRef` guard makes commit idempotent so the
 * Enter/Escape keydown and the subsequent blur can't both fire `onCommit`/
 * `onCancel` and double-apply (or fight each other).
 */
function RenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit(name: string): void;
  onCancel(): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  const commit = (): void => {
    if (committedRef.current) {
      return;
    }
    committedRef.current = true;
    onCommit(inputRef.current?.value ?? initialValue);
  };

  const cancel = (): void => {
    if (committedRef.current) {
      return;
    }
    committedRef.current = true;
    onCancel();
  };

  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: rename starts a focused edit by design
      autoFocus
      className="min-w-0 flex-1 rounded-md border border-composer-border bg-elevated px-1.5 py-1 text-fg text-sm outline-none focus:border-accent"
      defaultValue={initialValue}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onFocusCapture={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      ref={inputRef}
      type="text"
    />
  );
}

/**
 * The "…" project menu (Figure-2). Render-prop so the trigger lives inline with
 * the hover actions while the row still knows whether the menu is open (to keep
 * the actions pinned visible). Items are data-driven below — adding an action is
 * one row, not a new branch.
 */
function ProjectActions({
  pinned,
  onPin,
  onReveal,
  onRename,
  onDeleteChats,
  onRemove,
  children,
}: {
  pinned: boolean;
  onPin(): void;
  onReveal(): void;
  onRename(): void;
  onDeleteChats(): void;
  onRemove(): void;
  children(open: boolean, trigger: ReactNode): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <Menu.Trigger
      aria-label="Project actions"
      className="flex size-6 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-active hover:text-fg-muted data-popup-open:bg-active data-popup-open:text-fg-muted"
      onClick={(event) => event.stopPropagation()}
    >
      <IconDots size={14} stroke={1.8} />
    </Menu.Trigger>
  );
  return (
    <Menu.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
      }}
      open={open}
    >
      {children(open, trigger)}
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom" sideOffset={4}>
          <Menu.Popup className="origin-(--transform-origin) min-w-[184px] popup-chrome p-1">
            <ProjectMenuItem
              icon={
                pinned ? (
                  <IconPinnedOff size={15} stroke={1.7} />
                ) : (
                  <IconPin size={15} stroke={1.7} />
                )
              }
              onClick={onPin}
            >
              {pinned ? "Unpin project" : "Pin project"}
            </ProjectMenuItem>
            <ProjectMenuItem icon={<IconFolderOpen size={15} stroke={1.7} />} onClick={onReveal}>
              Open in Explorer
            </ProjectMenuItem>
            <ProjectMenuItem icon={<IconPencil size={15} stroke={1.7} />} onClick={onRename}>
              Rename project
            </ProjectMenuItem>
            <div className="my-1 h-px bg-hairline" />
            <ProjectMenuItem
              danger
              icon={<IconTrash size={15} stroke={1.7} />}
              onClick={onDeleteChats}
            >
              Delete chats
            </ProjectMenuItem>
            <ProjectMenuItem danger icon={<IconX size={15} stroke={1.7} />} onClick={onRemove}>
              Remove from recents
            </ProjectMenuItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ProjectMenuItem({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick(): void;
  danger?: boolean;
}) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-hover",
        danger ? "text-danger" : "text-fg",
      )}
      onClick={onClick}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      {children}
    </Menu.Item>
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
    <div className="group mt-3 mb-1 flex h-6 items-center px-2 text-[length:var(--text-nav-heading)] font-medium text-fg-faint">
      <button
        aria-expanded={expanded}
        className="flex items-center gap-1 transition-colors hover:text-fg-subtle"
        onClick={onToggle}
        type="button"
      >
        <span>{children}</span>
        <m.span
          animate={{ rotate: expanded ? 90 : 0 }}
          className="flex size-3 items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <IconChevronRight size={11} stroke={SB_STROKE} />
        </m.span>
      </button>
    </div>
  );
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

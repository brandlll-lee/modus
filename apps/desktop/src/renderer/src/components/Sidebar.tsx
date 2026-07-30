import { Menu } from "@base-ui/react/menu";
import {
  IconArchive,
  IconArchiveOff,
  IconChevronRight,
  IconClock,
  IconDots,
  IconEdit,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconGridDots,
  IconLayoutSidebar,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconSearch,
  IconSettings,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { animate, m, useMotionValue } from "motion/react";
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
import { useScrollFade } from "../lib/useScrollFade";
import { CollapsibleMotion } from "./ui/CollapsibleMotion";
import { ToolbarButton, TOOLBAR_ICON } from "./ui/ToolbarButton";

export const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * Sidebar density contract — one icon rail for nav / folder / session dots.
 * Nested blocks indent by exactly one rail (no magic pl-[30px]).
 */
const SB_RAIL = "pointer-events-none flex w-5 shrink-0 items-center justify-center";
const SB_ROW =
  "flex h-[30px] w-full items-center gap-2 rounded-md pr-1 pl-2 text-sm font-normal transition-colors";
/** Session titles — one step quieter/smaller than nav & project rows (Cursor density). */
const SB_SESSION =
  "flex h-[30px] w-full items-center gap-2 rounded-md pr-1 pl-2 text-xs font-normal transition-colors";
const SB_NEST = "pl-5"; // 20px = one rail
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
  onArchiveSession(session: AgentSessionInfo): void;
  onRestoreSession(session: AgentSessionInfo): void;
  onDeleteSession(session: AgentSessionInfo): void;
  onListArchivedSessions(workspaceId: string): Promise<AgentSessionInfo[]>;
  onPinProject(id: string, pinned: boolean): void;
  onRenameProject(id: string, displayName: string): void;
  onArchiveProjectChats(id: string): void;
  onDeleteProjectChats(id: string): void;
  onRemoveProject(id: string): void;
  onRevealProject(id: string): void;
  onOpenSettings(): void;
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
  onArchiveSession,
  onRestoreSession,
  onDeleteSession,
  onListArchivedSessions,
  onPinProject,
  onRenameProject,
  onArchiveProjectChats,
  onDeleteProjectChats,
  onRemoveProject,
  onRevealProject,
  onOpenSettings,
  onOpenChange,
  onWidthChange,
  canCreateSession,
}: SidebarProps) {
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const sessionsByWorkspace = groupSessionsByWorkspace(agentSessions);
  const { ref: scrollFadeRef, fadeTop, fadeBottom } = useScrollFade();

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
      maxWidth,
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
    onWidthChange(finalWidth);
  };

  return (
    <m.aside
      className="relative flex shrink-0 flex-col overflow-hidden bg-panel"
      style={{ width: panelWidth }}
    >
      <m.div className="flex h-full flex-col bg-panel" style={{ width: contentWidth }}>
        <div className="px-2 pt-3 pb-1">
          <NavRow
            disabled={!canCreateSession}
            icon={<IconEdit size={SB_ICON} stroke={SB_STROKE} />}
            onClick={onNewSession}
          >
            New chat
          </NavRow>
          <NavRow icon={<IconSearch size={SB_ICON} stroke={SB_STROKE} />}>Search</NavRow>
          <NavRow icon={<IconGridDots size={SB_ICON} stroke={SB_STROKE} />}>Plugins</NavRow>
          <NavRow icon={<IconClock size={SB_ICON} stroke={SB_STROKE} />}>Automations</NavRow>
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
              <NavRow
                icon={<IconFolder size={SB_ICON} stroke={SB_STROKE} />}
                muted
                onClick={onOpenWorkspace}
              >
                Open a repository…
              </NavRow>
            ) : (
              workspaces.map((workspace) => (
                <WorkspaceItem
                  activityBySession={activityBySession}
                  key={workspace.id}
                  onArchiveSession={onArchiveSession}
                  onDeleteSession={onDeleteSession}
                  onListArchivedSessions={onListArchivedSessions}
                  onNewSession={() => onNewWorkspaceSession(workspace)}
                  onPinSession={onPinSession}
                  onRestoreSession={onRestoreSession}
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
                  onArchiveChats={() => onArchiveProjectChats(workspace.id)}
                  onDeleteChats={() => onDeleteProjectChats(workspace.id)}
                  onRemove={() => onRemoveProject(workspace.id)}
                />
              ))
            )}

            <div className="mt-1">
              <NavRow
                icon={<IconFolderPlus size={SB_ICON} stroke={SB_STROKE} />}
                muted
                onClick={onOpenWorkspace}
              >
                Open workspace
              </NavRow>
            </div>
          </CollapsibleMotion>

          <SectionLabel>Chats</SectionLabel>
        </div>

        <div className="app-no-drag flex items-center gap-1 px-2 pt-1 pb-2">
          <div className="min-w-0 flex-1">
            <NavRow
              icon={<IconSettings size={SB_ICON} stroke={SB_STROKE} />}
              onClick={onOpenSettings}
            >
              Settings
            </NavRow>
          </div>
          <ToolbarButton label="Collapse sidebar" onClick={() => onOpenChange(false)}>
            <IconLayoutSidebar size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
          </ToolbarButton>
        </div>
      </m.div>
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
  onArchiveSession,
  onRestoreSession,
  onDeleteSession,
  onListArchivedSessions,
  renaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onPin,
  onReveal,
  onArchiveChats,
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
  onArchiveSession(session: AgentSessionInfo): void;
  onRestoreSession(session: AgentSessionInfo): void;
  onDeleteSession(session: AgentSessionInfo): void;
  onListArchivedSessions(workspaceId: string): Promise<AgentSessionInfo[]>;
  renaming: boolean;
  onStartRename(): void;
  onCommitRename(name: string): void;
  onCancelRename(): void;
  onPin(): void;
  onReveal(): void;
  onArchiveChats(): void;
  onDeleteChats(): void;
  onRemove(): void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<AgentSessionInfo[] | undefined>();
  const [showAllSessions, setShowAllSessions] = useState(false);

  const previewLimit = 2;
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

  const toggleArchived = (): void => {
    const nextOpen = !archivedOpen;
    setArchivedOpen(nextOpen);
    setExpanded(true);
    if (nextOpen && !archivedSessions) {
      void onListArchivedSessions(workspace.id).then(setArchivedSessions);
    }
  };

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
        onShowArchived={toggleArchived}
        onArchiveChats={onArchiveChats}
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
            onArchive={(event) => {
              event.stopPropagation();
              onArchiveSession(session);
            }}
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
            <span aria-hidden className={SB_RAIL} />
            {showAllSessions ? "See less" : "See more"}
          </button>
        ) : null}
        <CollapsibleMotion open={archivedOpen} preset="default">
          <div className={cn("mt-1 space-y-0.5", SB_NEST)}>
            {archivedSessions === undefined ? (
              <div className="px-2 py-1 text-2xs text-fg-faint">Loading archived chats…</div>
            ) : archivedSessions.length === 0 ? (
              <div className="px-2 py-1 text-2xs text-fg-faint">No archived chats</div>
            ) : (
              archivedSessions.map((session) => (
                <ArchivedSessionRow
                  key={session.id}
                  onOpen={() => onSelectSession(session)}
                  onRestore={() => {
                    setArchivedSessions((current) =>
                      current?.filter((item) => item.id !== session.id),
                    );
                    onRestoreSession(session);
                  }}
                  session={session}
                />
              ))
            )}
          </div>
        </CollapsibleMotion>
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
  onArchive,
  onDelete,
}: {
  title: string;
  updatedAt: string;
  isActive: boolean;
  pinned: boolean;
  activity: SessionActivity | undefined;
  onSelect(): void;
  onPin(event: MouseEvent<HTMLButtonElement>): void;
  onArchive(event: MouseEvent<HTMLButtonElement>): void;
  onDelete(event: MouseEvent<HTMLButtonElement>): void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) {
      return;
    }
    const timeout = window.setTimeout(() => setConfirmDelete(false), 2500);
    return () => window.clearTimeout(timeout);
  }, [confirmDelete]);

  return (
    <m.div
      className={cn(
        SB_SESSION,
        "group",
        isActive
          ? "bg-active text-fg-muted"
          : "text-fg-subtle hover:bg-hover hover:text-fg-muted",
      )}
      layout
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setConfirmDelete(false);
        }
      }}
      onMouseLeave={() => setConfirmDelete(false)}
      transition={{ duration: 0.14, ease: "easeOut" }}
    >
      <span className={SB_RAIL}>
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
        <IconButton label={pinned ? "Unpin chat" : "Pin chat"} onClick={onPin}>
          {pinned ? (
            <IconPinnedOff size={14} stroke={SB_STROKE} />
          ) : (
            <IconPin size={14} stroke={SB_STROKE} />
          )}
        </IconButton>
        <IconButton label="Archive" onClick={onArchive}>
          <IconArchive size={14} stroke={SB_STROKE} />
        </IconButton>
        {confirmDelete ? (
          <button
            className="ml-0.5 h-5 rounded-md px-1.5 text-2xs text-danger transition-colors hover:bg-active"
            onClick={onDelete}
            type="button"
          >
            Confirm
          </button>
        ) : (
          <IconButton
            label="Delete"
            onClick={(event) => {
              event.stopPropagation();
              setConfirmDelete(true);
            }}
          >
            <IconTrash size={14} stroke={SB_STROKE} />
          </IconButton>
        )}
      </span>
    </m.div>
  );
}

function ArchivedSessionRow({
  session,
  onOpen,
  onRestore,
}: {
  session: AgentSessionInfo;
  onOpen(): void;
  onRestore(): void;
}) {
  return (
    <div className={cn(SB_SESSION, "group text-fg-faint hover:bg-hover hover:text-fg-subtle")}>
      <span aria-hidden className={SB_RAIL} />
      <button
        className="min-w-0 flex-1 truncate-fade pr-1 text-left"
        onClick={onOpen}
        title="Open archived chat"
        type="button"
      >
        {session.title}
      </button>
      <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        <span className="px-1 text-2xs tabular-nums">
          {formatRelativeTime(session.archivedAt ?? session.updatedAt)}
        </span>
        <IconButton label="Restore" onClick={onRestore}>
          <IconArchiveOff size={14} stroke={SB_STROKE} />
        </IconButton>
      </span>
    </div>
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
  onShowArchived,
  onArchiveChats,
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
  onShowArchived(): void;
  onArchiveChats(): void;
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
      onArchiveChats={onArchiveChats}
      onDeleteChats={onDeleteChats}
      onPin={onPin}
      onRemove={onRemove}
      onRename={onStartRename}
      onReveal={onReveal}
      onShowArchived={onShowArchived}
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
            <IconButton label="New session" onClick={onCreate}>
              <IconEdit size={14} stroke={SB_STROKE} />
            </IconButton>
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
        SB_ROW,
        "group relative text-left",
        "text-fg-muted hover:bg-hover hover:text-fg",
        highlight && "bg-active text-fg hover:bg-hover",
        muted && "text-fg-faint hover:text-fg-muted",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-fg-faint",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {active && layoutHighlight ? (
        <m.span
          className="absolute inset-0 rounded-md bg-active"
          layoutId="sidebar-active"
          transition={{ duration: 0.12, ease: "easeOut" }}
        />
      ) : null}
      <span className={cn(SB_RAIL, "relative text-current")}>{icon}</span>
      <span className="relative flex min-w-0 flex-1 items-center truncate">{children}</span>
      {trailing ? <span className="relative shrink-0">{trailing}</span> : null}
    </button>
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
  onShowArchived,
  onArchiveChats,
  onDeleteChats,
  onRemove,
  children,
}: {
  pinned: boolean;
  onPin(): void;
  onReveal(): void;
  onRename(): void;
  onShowArchived(): void;
  onArchiveChats(): void;
  onDeleteChats(): void;
  onRemove(): void;
  children(open: boolean, trigger: ReactNode): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDeleteChats, setConfirmDeleteChats] = useState(false);
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
        if (!nextOpen) {
          setConfirmDeleteChats(false);
        }
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
            <ProjectMenuItem
              icon={<IconArchiveOff size={15} stroke={1.7} />}
              onClick={onShowArchived}
            >
              Archived chats
            </ProjectMenuItem>
            <ProjectMenuItem icon={<IconArchive size={15} stroke={1.7} />} onClick={onArchiveChats}>
              Archive chats
            </ProjectMenuItem>
            <div className="my-1 h-px bg-hairline" />
            <ProjectMenuItem
              danger
              icon={<IconTrash size={15} stroke={1.7} />}
              onClick={() => {
                if (!confirmDeleteChats) {
                  setConfirmDeleteChats(true);
                  return;
                }
                setConfirmDeleteChats(false);
                onDeleteChats();
              }}
            >
              {confirmDeleteChats ? "Confirm delete chats" : "Delete chats"}
            </ProjectMenuItem>
            <ProjectMenuItem danger icon={<IconX size={15} stroke={1.7} />} onClick={onRemove}>
              Remove
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
    <div className="group mt-3 mb-0.5 flex h-6 items-center px-2 text-2xs font-normal text-fg-faint">
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

function SectionLabel({ children }: { children: string }) {
  return <div className="px-2 pt-3 pb-0.5 text-2xs font-normal text-fg-faint">{children}</div>;
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

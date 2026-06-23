import { IconArrowLeft, IconLayoutBoard, IconList, IconSearch } from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSessionInfo,
  ContextUsageInfo,
  GitChangeEvent,
  GitStatusSummary,
  ModelInfo,
  PlanRef,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { ModusBot } from "../../components/ui/ModusBot";
import type { AgentEventHub } from "../agent/agentEventHub";
import { ChatPane } from "../agent/ChatPane";
import { subagentColor } from "../agent/subagentUi";

type PanelView = "overview" | "detail";
type DisplayMode = "board" | "list";
type SubagentGroup = "running" | "blocked" | "ready";

type SubagentsPanelProps = {
  parentSessionId?: string | undefined;
  sessions: AgentSessionInfo[];
  selectedId?: string | undefined;
  hub: AgentEventHub;
  models: ModelInfo[];
  defaultModel: string;
  contextUsageBySession: Record<string, ContextUsageInfo>;
  workspace: WorkspaceInfo | null;
  onSelect(id: string): void;
  onSessionsChanged(): void;
  onModelChange(model: string): void;
  onModelConfigChange(model: string, thinkingVariant: string): Promise<void> | void;
  onOpenReview(): void;
  onOpenSubagent(childSessionId: string): void;
  onPlanUpdated(plan: PlanRef): void;
};

export function SubagentsPanel({
  parentSessionId,
  sessions,
  selectedId,
  hub,
  models,
  defaultModel,
  contextUsageBySession,
  workspace,
  onSelect,
  onSessionsChanged,
  onModelChange,
  onModelConfigChange,
  onOpenReview,
  onOpenSubagent,
  onPlanUpdated,
}: SubagentsPanelProps) {
  const [view, setView] = useState<PanelView>("overview");
  const [display, setDisplay] = useState<DisplayMode>("board");
  const [query, setQuery] = useState("");
  const [worktreeBusy, setWorktreeBusy] = useState<string | undefined>();
  const [worktreeError, setWorktreeError] = useState<string | undefined>();
  const [parentGitStatus, setParentGitStatus] = useState<GitStatusSummary | undefined>();
  const lastSelectedIdRef = useRef<string | undefined>(undefined);

  const subagents = useMemo(
    () => sessions.filter((session) => session.parentSessionId === parentSessionId),
    [sessions, parentSessionId],
  );
  const parentSession = sessions.find((session) => session.id === parentSessionId);
  const parentCwd = parentSession?.cwd;
  const selected = subagents.find((session) => session.id === selectedId);
  const filteredSubagents = useMemo(
    () => subagents.filter((session) => matchesSubagentQuery(session, query)),
    [subagents, query],
  );

  useEffect(() => {
    if (selectedId && selectedId !== lastSelectedIdRef.current) {
      setView("detail");
    }
    lastSelectedIdRef.current = selectedId;
  }, [selectedId]);

  const refreshParentGitStatus = useCallback(async (): Promise<void> => {
    if (!parentCwd) {
      setParentGitStatus(undefined);
      return;
    }
    setParentGitStatus(await window.modus.diff.status(parentCwd).catch(() => undefined));
  }, [parentCwd]);

  useEffect(() => {
    if (!parentCwd) {
      setParentGitStatus(undefined);
      return;
    }
    let disposed = false;
    void window.modus.git.watch(parentCwd);
    void refreshParentGitStatus();
    const off = window.modus.git.onChanged((event: GitChangeEvent) => {
      if (!disposed && event.cwd === parentCwd) {
        void refreshParentGitStatus();
      }
    });
    return () => {
      disposed = true;
      off();
      void window.modus.git.unwatch(parentCwd);
    };
  }, [parentCwd, refreshParentGitStatus]);

  const applyBlockedReason = parentGitStatus?.mergeInProgress
    ? "Commit or abort the pending worktree apply before applying another worktree."
    : (parentGitStatus?.stagedCount ?? 0) + (parentGitStatus?.unstagedCount ?? 0) > 0
      ? "Apply requires a clean main workspace."
      : undefined;

  async function applyWorktree(session: AgentSessionInfo): Promise<void> {
    setWorktreeBusy("apply");
    setWorktreeError(undefined);
    try {
      await window.modus.agent.applySubagentWorktree(session.id);
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorktreeBusy(undefined);
      await refreshParentGitStatus();
      onSessionsChanged();
    }
  }

  async function abortWorktreeApply(session: AgentSessionInfo): Promise<void> {
    setWorktreeBusy("abort");
    setWorktreeError(undefined);
    try {
      await window.modus.agent.abortSubagentWorktreeApply(session.id);
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorktreeBusy(undefined);
      await refreshParentGitStatus();
      onSessionsChanged();
    }
  }

  async function cleanupWorktree(session: AgentSessionInfo): Promise<void> {
    setWorktreeBusy("cleanup");
    setWorktreeError(undefined);
    try {
      await window.modus.agent.cleanupSubagentWorktree(session.id);
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorktreeBusy(undefined);
      await refreshParentGitStatus();
      onSessionsChanged();
    }
  }

  async function askRootToResolve(session: AgentSessionInfo): Promise<void> {
    if (!parentSessionId) return;
    setWorktreeBusy("resolve");
    setWorktreeError(undefined);
    try {
      await window.modus.agent.prompt({
        sessionId: parentSessionId,
        message: `Resolve the merge conflict from subagent "${session.subagentTask ?? session.title}". Conflict files: ${session.subagentWorktree?.conflictFiles?.join(", ") || "see git status"}. Keep both intents where possible, then run the relevant checks.`,
        context: [],
        delivery: "normal",
        model: parentSession?.model ?? defaultModel,
      });
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorktreeBusy(undefined);
      onSessionsChanged();
    }
  }

  function openDetail(session: AgentSessionInfo): void {
    onSelect(session.id);
    setView("detail");
  }

  if (!parentSessionId || subagents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-fg-faint text-sm">
        No subagents yet.
      </div>
    );
  }

  if (view === "detail" && selected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-hairline border-b px-3">
          <button
            aria-label="Back to subagents"
            className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
            onClick={() => setView("overview")}
            type="button"
          >
            <IconArrowLeft size={16} stroke={1.7} />
          </button>
          <ModusBot
            active={isSubagentLive(selected.status)}
            busy={isSubagentLive(selected.status)}
            className="size-5 shrink-0"
            color={subagentColor(selected.id)}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-fg text-sm">{subagentTitle(selected)}</div>
            <div className="truncate text-fg-faint text-xs">{subagentMeta(selected)}</div>
          </div>
          <StatusPill session={selected} />
        </div>
        {selected.subagentWorktree ? (
          <SubagentWorktreeBanner
            busy={worktreeBusy}
            error={worktreeError}
            applyBlockedReason={applyBlockedReason}
            mergeInProgress={Boolean(parentGitStatus?.mergeInProgress)}
            onApply={() => void applyWorktree(selected)}
            onAskRoot={() => void askRootToResolve(selected)}
            onAbort={() => void abortWorktreeApply(selected)}
            onCleanup={() => void cleanupWorktree(selected)}
            onOpen={() =>
              void window.modus.file.open({
                cwd: parentSession?.cwd ?? selected.cwd,
                path: selected.subagentWorktree?.path ?? selected.cwd,
              })
            }
            worktree={selected.subagentWorktree}
          />
        ) : null}
        <div className="min-h-0 flex-1">
          <ChatPane
            botColor={subagentColor(selected.id)}
            contextUsage={contextUsageBySession[selected.id]}
            defaultModel={defaultModel}
            hub={hub}
            key={selected.id}
            models={models}
            onModelChange={onModelChange}
            onModelConfigChange={onModelConfigChange}
            onOpenReview={onOpenReview}
            onOpenSubagent={onOpenSubagent}
            onPlanUpdated={onPlanUpdated}
            onSessionsChanged={onSessionsChanged}
            session={selected}
            workspace={workspace}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="shrink-0 px-4 pt-3 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md bg-fill p-0.5">
            <ViewButton active={display === "board"} onClick={() => setDisplay("board")}>
              <IconLayoutBoard size={14} stroke={1.7} />
              Board
            </ViewButton>
            <ViewButton active={display === "list"} onClick={() => setDisplay("list")}>
              <IconList size={14} stroke={1.7} />
              List
            </ViewButton>
          </div>
          <label className="relative ml-auto min-w-[180px] flex-1 sm:max-w-[320px]">
            <IconSearch
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-fg-faint"
              size={14}
              stroke={1.7}
            />
            <input
              className="h-8 w-full rounded-md bg-fill pr-3 pl-8 text-sm outline-none transition-colors placeholder:text-fg-faint focus:bg-canvas"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search subagents..."
              value={query}
            />
          </label>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {filteredSubagents.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-fg-faint text-sm">
            No matching subagents.
          </div>
        ) : display === "board" ? (
          <SubagentBoard sessions={filteredSubagents} onOpen={openDetail} />
        ) : (
          <SubagentList sessions={filteredSubagents} onOpen={openDetail} />
        )}
      </div>
    </div>
  );
}

function ViewButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors ${
        active ? "bg-canvas text-fg shadow-sm" : "text-fg-subtle hover:text-fg"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function SubagentBoard({
  sessions,
  onOpen,
}: {
  sessions: AgentSessionInfo[];
  onOpen(session: AgentSessionInfo): void;
}) {
  return (
    <div className="grid min-h-full content-start gap-4 bg-fill/30 px-5 py-6 sm:grid-cols-2 xl:grid-cols-3">
      {sessions.map((session) => (
        <SubagentCard key={session.id} onOpen={onOpen} session={session} />
      ))}
    </div>
  );
}

function SubagentCard({
  session,
  onOpen,
}: {
  session: AgentSessionInfo;
  onOpen(session: AgentSessionInfo): void;
}) {
  const worktreeStatus = session.subagentWorktree?.integrationStatus;
  return (
    <button
      className="flex min-h-20 w-full items-center gap-3 rounded-lg border border-hairline-soft bg-panel px-3 py-3 text-left shadow-composer transition-colors hover:bg-hover"
      onClick={() => onOpen(session)}
      title={subagentTitle(session)}
      type="button"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-fill">
        <ModusBot
          active={isSubagentLive(session.status)}
          busy={isSubagentLive(session.status)}
          className="size-5"
          color={subagentColor(session.id)}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 font-medium text-fg text-sm">{subagentTitle(session)}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-fg-faint text-xs">
          <span className="truncate">{relativeTime(session.updatedAt)}</span>
          {worktreeStatus ? (
            <span className="truncate text-fg-subtle">{worktreeStatus}</span>
          ) : null}
        </div>
      </div>
      <span className={`size-2 shrink-0 rounded-full ${groupColor(subagentGroup(session))}`} />
    </button>
  );
}

function SubagentList({
  sessions,
  onOpen,
}: {
  sessions: AgentSessionInfo[];
  onOpen(session: AgentSessionInfo): void;
}) {
  return (
    <div className="p-2">
      {sessions.map((session) => (
        <button
          className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-hover"
          key={session.id}
          onClick={() => onOpen(session)}
          title={subagentTitle(session)}
          type="button"
        >
          <ModusBot
            active={isSubagentLive(session.status)}
            busy={isSubagentLive(session.status)}
            className="size-5 shrink-0"
            color={subagentColor(session.id)}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-fg">{subagentTitle(session)}</div>
            <div className="truncate text-fg-faint text-xs">{subagentMeta(session)}</div>
          </div>
          <StatusPill session={session} />
        </button>
      ))}
    </div>
  );
}

function StatusPill({ session }: { session: AgentSessionInfo }) {
  const group = subagentGroup(session);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-fill px-2 py-1 text-fg-subtle text-xs">
      <span className={`size-1.5 rounded-full ${groupColor(group)}`} />
      {groupLabel(group)}
    </span>
  );
}

function SubagentWorktreeBanner({
  applyBlockedReason,
  busy,
  error,
  mergeInProgress,
  onApply,
  onAskRoot,
  onAbort,
  onCleanup,
  onOpen,
  worktree,
}: {
  applyBlockedReason: string | undefined;
  busy: string | undefined;
  error: string | undefined;
  mergeInProgress: boolean;
  onApply(): void;
  onAskRoot(): void;
  onAbort(): void;
  onCleanup(): void;
  onOpen(): void;
  worktree: NonNullable<AgentSessionInfo["subagentWorktree"]>;
}) {
  const files = worktree.conflictFiles?.length ? worktree.conflictFiles : worktree.changedFiles;
  const canApply = worktree.integrationStatus === "ready";
  const canAbort =
    worktree.integrationStatus === "conflict" ||
    (worktree.integrationStatus === "applied" && mergeInProgress);
  const canCleanup =
    worktree.integrationStatus === "no_changes" ||
    (worktree.integrationStatus === "applied" && !mergeInProgress);
  const canAskRoot = worktree.integrationStatus === "conflict";
  const message =
    worktree.integrationStatus === "applied"
      ? mergeInProgress
        ? "Applied. Commit or abort before applying another worktree."
        : "Applied. Cleanup is available after review."
      : worktree.integrationStatus === "conflict"
        ? "Merge conflict. Resolve it or abort this apply."
        : canApply
          ? applyBlockedReason
          : undefined;
  return (
    <div className="border-hairline border-b bg-elevated px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Worktree</span>
        <span className="rounded bg-fill px-1.5 py-0.5 text-fg-subtle">
          {worktree.integrationStatus}
        </span>
        <span className="truncate text-fg-faint">{worktree.branch}</span>
        <button
          className="rounded border-hairline px-2 py-1 hover:bg-hover"
          onClick={onOpen}
          type="button"
        >
          Open
        </button>
        {canApply ? (
          <button
            className="rounded border-hairline px-2 py-1 hover:bg-hover"
            disabled={Boolean(busy || applyBlockedReason)}
            onClick={onApply}
            title={applyBlockedReason}
            type="button"
          >
            {busy === "apply" ? "Applying..." : "Apply"}
          </button>
        ) : null}
        {canAbort ? (
          <button
            className="rounded border-hairline px-2 py-1 hover:bg-hover"
            disabled={Boolean(busy)}
            onClick={onAbort}
            type="button"
          >
            {busy === "abort" ? "Aborting..." : "Abort apply"}
          </button>
        ) : null}
        {canAskRoot ? (
          <button
            className="rounded border-hairline px-2 py-1 hover:bg-hover"
            disabled={Boolean(busy)}
            onClick={onAskRoot}
            type="button"
          >
            {busy === "resolve" ? "Asking..." : "Ask root"}
          </button>
        ) : null}
        {canCleanup ? (
          <button
            className="rounded border-hairline px-2 py-1 hover:bg-hover"
            disabled={Boolean(busy)}
            onClick={onCleanup}
            type="button"
          >
            {busy === "cleanup" ? "Cleaning..." : "Cleanup"}
          </button>
        ) : null}
      </div>
      {files?.length ? (
        <div className="mt-1 truncate text-fg-faint">
          {files.slice(0, 4).join(", ")}
          {files.length > 4 ? `, +${files.length - 4}` : ""}
        </div>
      ) : null}
      {message ? <div className="mt-1 text-fg-subtle">{message}</div> : null}
      {error ? <div className="mt-1 text-danger">{error}</div> : null}
    </div>
  );
}

function matchesSubagentQuery(session: AgentSessionInfo, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    session.subagentTask,
    session.title,
    session.model,
    session.status,
    session.subagentType,
    session.subagentWorktree?.integrationStatus,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function subagentTitle(session: AgentSessionInfo): string {
  return session.subagentTask ?? session.title;
}

function subagentMeta(session: AgentSessionInfo): string {
  return [session.status, session.model, relativeTime(session.updatedAt)]
    .filter(Boolean)
    .join(" · ");
}

function subagentGroup(session: AgentSessionInfo): SubagentGroup {
  if (isSubagentLive(session.status)) return "running";
  if (session.status === "blocked") return "blocked";
  return "ready";
}

function groupLabel(group: SubagentGroup): string {
  return group === "running" ? "Running" : group === "blocked" ? "Blocked" : "Ready";
}

function groupColor(group: SubagentGroup): string {
  return group === "running" ? "bg-accent" : group === "blocked" ? "bg-danger" : "bg-success";
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isSubagentLive(status: AgentSessionInfo["status"]): boolean {
  return status === "starting" || status === "running";
}

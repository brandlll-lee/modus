import { IconArrowLeft, IconLayoutBoard, IconList, IconSearch } from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSessionInfo,
  ContextUsageInfo,
  GitChangeEvent,
  GitStatusSummary,
  ModelInfo,
  PlanRef,
  WorkingChangeStats,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { ModusBot } from "../../components/ui/ModusBot";
import type { AgentEventHub } from "../agent/agentEventHub";
import { ChatPane } from "../agent/ChatPane";
import { LineDelta } from "../agent/changes/ChangeStats";
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
  onOpenReview(cwd?: string): void;
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
  const [conflictChoiceSessionId, setConflictChoiceSessionId] = useState<string | undefined>();
  const [parentGitStatus, setParentGitStatus] = useState<GitStatusSummary | undefined>();
  const [worktreeStatsBySession, setWorktreeStatsBySession] = useState<
    Record<string, WorkingChangeStats>
  >({});
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

  useEffect(() => {
    const targets = subagents.filter(
      (session) =>
        session.subagentWorktree?.path &&
        session.subagentWorktree.baseSha &&
        session.subagentWorktree.integrationStatus !== "cleaned",
    );
    let disposed = false;

    async function refreshWorktreeStats(): Promise<void> {
      const pairs = await Promise.all(
        targets.map(async (session) => {
          const worktree = session.subagentWorktree;
          if (!worktree) return [session.id, undefined] as const;
          const stats = await window.modus.diff
            .statsSince({ cwd: worktree.path, base: worktree.baseSha })
            .catch(() => undefined);
          return [session.id, stats] as const;
        }),
      );
      if (!disposed) {
        setWorktreeStatsBySession(
          Object.fromEntries(pairs.filter((entry) => entry[1])) as Record<
            string,
            WorkingChangeStats
          >,
        );
      }
    }

    void refreshWorktreeStats();
    const paths = Array.from(
      new Set(targets.map((session) => session.subagentWorktree?.path).filter(Boolean)),
    ) as string[];
    const normalizedPaths = new Set(paths.map(normalizePath));
    for (const path of paths) {
      void window.modus.git.watch(path).catch(() => undefined);
    }
    const off = window.modus.git.onChanged((event: GitChangeEvent) => {
      if (!disposed && normalizedPaths.has(normalizePath(event.cwd))) {
        void refreshWorktreeStats();
      }
    });
    return () => {
      disposed = true;
      off();
      for (const path of paths) {
        void window.modus.git.unwatch(path);
      }
    };
  }, [subagents]);

  const applyBlockedReason = parentGitStatus?.mergeInProgress
    ? "Commit or abort the pending worktree apply before applying another worktree."
    : (parentGitStatus?.stagedCount ?? 0) + (parentGitStatus?.unstagedCount ?? 0) > 0
      ? "Apply requires a clean main workspace."
      : undefined;

  async function applyWorktree(session: AgentSessionInfo): Promise<void> {
    setWorktreeBusy("apply");
    setWorktreeError(undefined);
    try {
      const updated = await window.modus.agent.applySubagentWorktree(session.id);
      setConflictChoiceSessionId(
        updated.subagentWorktree?.integrationStatus === "conflict" ? session.id : undefined,
      );
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
      setConflictChoiceSessionId(undefined);
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
      setConflictChoiceSessionId(undefined);
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
        message: formatConflictResolutionPrompt(session, parentCwd),
        context: [],
        delivery: "normal",
        model: parentSession?.model ?? defaultModel,
      });
      setConflictChoiceSessionId(undefined);
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
        <div className="min-h-0 flex-1">
          <ChatPane
            composerReplacement={
              selected.subagentWorktree &&
              conflictChoiceSessionId === selected.id &&
              selected.subagentWorktree.integrationStatus === "conflict" ? (
                <SubagentConflictChoiceCard
                  busy={worktreeBusy}
                  error={worktreeError}
                  onAbort={() => void abortWorktreeApply(selected)}
                  onAskRoot={() => void askRootToResolve(selected)}
                  onResolveMyself={() => setConflictChoiceSessionId(undefined)}
                  worktree={selected.subagentWorktree}
                />
              ) : selected.subagentWorktree ? (
                <SubagentWorktreeReviewCard
                  applyBlockedReason={applyBlockedReason}
                  busy={worktreeBusy}
                  error={worktreeError}
                  mergeInProgress={Boolean(parentGitStatus?.mergeInProgress)}
                  onAbort={() => void abortWorktreeApply(selected)}
                  onApply={() => void applyWorktree(selected)}
                  onCleanup={() => void cleanupWorktree(selected)}
                  onOpen={() =>
                    void window.modus.file.open({
                      cwd: parentSession?.cwd ?? selected.cwd,
                      path: selected.subagentWorktree?.path ?? selected.cwd,
                    })
                  }
                  onReview={() => onOpenReview(selected.subagentWorktree?.path ?? selected.cwd)}
                  onResolveConflict={() => setConflictChoiceSessionId(selected.id)}
                  stats={worktreeStatsBySession[selected.id]}
                  worktree={selected.subagentWorktree}
                />
              ) : undefined
            }
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
          <SubagentBoard
            sessions={filteredSubagents}
            statsBySession={worktreeStatsBySession}
            onOpen={openDetail}
          />
        ) : (
          <SubagentList
            sessions={filteredSubagents}
            statsBySession={worktreeStatsBySession}
            onOpen={openDetail}
          />
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
  statsBySession,
  onOpen,
}: {
  sessions: AgentSessionInfo[];
  statsBySession: Record<string, WorkingChangeStats>;
  onOpen(session: AgentSessionInfo): void;
}) {
  return (
    <div className="grid min-h-full content-start gap-4 bg-fill/30 px-5 py-6 sm:grid-cols-2 xl:grid-cols-3">
      {sessions.map((session) => (
        <SubagentCard
          key={session.id}
          onOpen={onOpen}
          session={session}
          stats={statsBySession[session.id]}
        />
      ))}
    </div>
  );
}

function SubagentCard({
  session,
  stats,
  onOpen,
}: {
  session: AgentSessionInfo;
  stats?: WorkingChangeStats | undefined;
  onOpen(session: AgentSessionInfo): void;
}) {
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
        <div className="flex min-w-0 items-start gap-2">
          <div className="line-clamp-2 flex-1 font-medium text-fg text-sm">
            {subagentTitle(session)}
          </div>
          {stats && stats.fileCount > 0 ? (
            <LineDelta added={stats.added} removed={stats.removed} />
          ) : null}
        </div>
        <div className="mt-1 truncate text-fg-faint text-xs">{relativeTime(session.updatedAt)}</div>
      </div>
      <span className={`size-2 shrink-0 rounded-full ${groupColor(subagentGroup(session))}`} />
    </button>
  );
}

function SubagentList({
  sessions,
  statsBySession,
  onOpen,
}: {
  sessions: AgentSessionInfo[];
  statsBySession: Record<string, WorkingChangeStats>;
  onOpen(session: AgentSessionInfo): void;
}) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {sessions.map((session) => {
        const stats = statsBySession[session.id];
        return (
          <button
            className="flex min-h-[58px] w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-hover"
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
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate font-medium text-fg">{subagentTitle(session)}</div>
                {stats && stats.fileCount > 0 ? (
                  <LineDelta added={stats.added} removed={stats.removed} />
                ) : null}
              </div>
              <div className="truncate text-fg-faint text-xs">{subagentMeta(session)}</div>
            </div>
            <StatusPill session={session} />
          </button>
        );
      })}
    </div>
  );
}

function StatusPill({ session }: { session: AgentSessionInfo }) {
  const group = subagentGroup(session);
  return (
    <span
      aria-label={groupLabel(group)}
      className={`size-2 shrink-0 rounded-full ${groupColor(group)}`}
      role="img"
      title={groupLabel(group)}
    />
  );
}

function SubagentWorktreeReviewCard({
  applyBlockedReason,
  busy,
  error,
  mergeInProgress,
  onApply,
  onAbort,
  onCleanup,
  onOpen,
  onReview,
  onResolveConflict,
  stats,
  worktree,
}: {
  applyBlockedReason: string | undefined;
  busy: string | undefined;
  error: string | undefined;
  mergeInProgress: boolean;
  onApply(): void;
  onAbort(): void;
  onCleanup(): void;
  onOpen(): void;
  onReview(): void;
  onResolveConflict(): void;
  stats?: WorkingChangeStats | undefined;
  worktree: NonNullable<AgentSessionInfo["subagentWorktree"]>;
}) {
  const canApply = worktree.integrationStatus === "ready";
  const canAbort = worktree.integrationStatus === "applied" && mergeInProgress;
  const canCleanup =
    worktree.integrationStatus === "no_changes" ||
    (worktree.integrationStatus === "applied" && !mergeInProgress);
  const title =
    worktree.integrationStatus === "applied"
      ? "Worktree applied"
      : worktree.integrationStatus === "conflict"
        ? "Resolve this paused apply?"
        : worktree.integrationStatus === "no_changes"
          ? "No changes to apply"
          : "Apply this subagent worktree?";
  const detail =
    worktree.integrationStatus === "applied"
      ? mergeInProgress
        ? "Commit or abort before applying another worktree."
        : "Review is complete; cleanup is available."
      : worktree.integrationStatus === "conflict"
        ? "Choose how to handle the merge conflicts in the main workspace."
        : worktree.integrationStatus === "no_changes"
          ? "This worktree does not have changes against its base."
          : (applyBlockedReason ?? "Review the diff, then apply it to the main workspace.");
  return (
    <div className="mb-2 rounded-xl border border-composer-border bg-elevated px-3.5 py-3 shadow-composer-edge">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[14px] text-fg leading-snug">{title}</div>
          <div className="mt-1 text-fg-subtle text-xs leading-relaxed">{detail}</div>
          <div className="mt-2 truncate font-mono text-2xs text-fg-faint">{worktree.branch}</div>
        </div>
        {stats && stats.fileCount > 0 ? (
          <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-chip px-2 py-1 text-fg-muted text-xs">
            <span>
              {stats.fileCount} {stats.fileCount === 1 ? "file" : "files"}
            </span>
            <LineDelta added={stats.added} removed={stats.removed} />
          </div>
        ) : null}
      </div>
      {error ? <div className="mt-2 text-danger text-xs">{error}</div> : null}
      <div className="mt-2.5 grid gap-1">
        <WorktreeActionButton
          description="Open this worktree diff in the Changes panel."
          index={1}
          label="Review diff"
          onClick={onReview}
        />
        {canApply ? (
          <WorktreeActionButton
            description={
              applyBlockedReason ?? "Merge this worktree into the main workspace for review."
            }
            disabled={Boolean(busy || applyBlockedReason)}
            index={2}
            label={busy === "apply" ? "Applying..." : "Apply worktree"}
            onClick={onApply}
            recommended
          />
        ) : null}
        <WorktreeActionButton
          description="Open the isolated worktree folder."
          disabled={Boolean(busy)}
          index={canApply ? 3 : 2}
          label="Open worktree"
          onClick={onOpen}
        />
        {canAbort ? (
          <WorktreeActionButton
            description="Run git merge --abort and return this worktree to ready."
            disabled={Boolean(busy)}
            index={3}
            label={busy === "abort" ? "Aborting..." : "Abort apply"}
            onClick={onAbort}
          />
        ) : null}
        {worktree.integrationStatus === "conflict" ? (
          <WorktreeActionButton
            description="Choose whether root, you, or git merge --abort handles this conflict."
            disabled={Boolean(busy)}
            index={3}
            label="Resolve conflict"
            onClick={onResolveConflict}
            recommended
          />
        ) : null}
        {canCleanup ? (
          <WorktreeActionButton
            description="Remove the completed worktree."
            disabled={Boolean(busy)}
            index={3}
            label={busy === "cleanup" ? "Cleaning..." : "Cleanup"}
            onClick={onCleanup}
          />
        ) : null}
      </div>
    </div>
  );
}

function WorktreeActionButton({
  description,
  disabled,
  index,
  label,
  onClick,
  recommended,
}: {
  description: string;
  disabled?: boolean | undefined;
  index: number;
  label: string;
  onClick(): void;
  recommended?: boolean | undefined;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 ${
        recommended ? "bg-build/12 hover:bg-build/16" : "hover:bg-hover"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        className={`flex size-[18px] shrink-0 items-center justify-center rounded-full font-semibold text-[11px] ${
          recommended ? "bg-build text-build-fg" : "border border-hairline text-fg-faint"
        }`}
      >
        {index}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-[13px] text-fg">{label}</span>
        <span className="block truncate text-fg-faint text-xs">{description}</span>
      </span>
    </button>
  );
}

function SubagentConflictChoiceCard({
  busy,
  error,
  onAbort,
  onAskRoot,
  onResolveMyself,
  worktree,
}: {
  busy: string | undefined;
  error: string | undefined;
  onAbort(): void;
  onAskRoot(): void;
  onResolveMyself(): void;
  worktree: NonNullable<AgentSessionInfo["subagentWorktree"]>;
}) {
  const files = worktree.conflictFiles ?? [];
  return (
    <div className="mb-2 rounded-xl border border-composer-border bg-elevated px-3.5 py-3 shadow-composer-edge">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14px] text-fg leading-snug">
            Apply paused with merge conflicts
          </div>
          <div className="mt-1 text-fg-subtle text-xs leading-relaxed">
            Choose how to handle this worktree apply. The merge is still open in the main workspace.
          </div>
          <div className="mt-2 truncate font-mono text-2xs text-fg-faint">{worktree.branch}</div>
        </div>
      </div>
      {files.length > 0 ? (
        <div className="mt-2 rounded-md bg-code-bg px-2.5 py-2 text-fg-muted text-xs">
          {files.slice(0, 4).join(", ")}
          {files.length > 4 ? `, +${files.length - 4}` : ""}
        </div>
      ) : null}
      {error ? <div className="mt-2 text-danger text-xs">{error}</div> : null}
      <div className="mt-3 grid gap-1">
        <button
          className="rounded-lg bg-build/12 px-2.5 py-2 text-left text-sm text-fg transition-colors hover:bg-build/16 disabled:opacity-50"
          disabled={Boolean(busy)}
          onClick={onAskRoot}
          type="button"
        >
          {busy === "resolve" ? "Asking root..." : "Ask root to resolve"}
          <span className="mt-0.5 block text-fg-faint text-xs">
            Send the conflict context to the root agent.
          </span>
        </button>
        <button
          className="rounded-lg px-2.5 py-2 text-left text-fg-muted text-sm transition-colors hover:bg-hover hover:text-fg disabled:opacity-50"
          disabled={Boolean(busy)}
          onClick={onAbort}
          type="button"
        >
          {busy === "abort" ? "Aborting..." : "Abort apply"}
          <span className="mt-0.5 block text-fg-faint text-xs">
            Run git merge --abort and return this worktree to ready.
          </span>
        </button>
        <button
          className="rounded-lg px-2.5 py-2 text-left text-fg-muted text-sm transition-colors hover:bg-hover hover:text-fg disabled:opacity-50"
          disabled={Boolean(busy)}
          onClick={onResolveMyself}
          type="button"
        >
          Resolve myself
          <span className="mt-0.5 block text-fg-faint text-xs">
            Close this panel without changing Git state.
          </span>
        </button>
      </div>
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

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function formatConflictResolutionPrompt(
  session: AgentSessionInfo,
  parentCwd: string | undefined,
) {
  const worktree = session.subagentWorktree;
  const conflictFiles = worktree?.conflictFiles?.length
    ? worktree.conflictFiles.join(", ")
    : "run git status to inspect unresolved files";
  const changedFiles = worktree?.changedFiles?.length
    ? worktree.changedFiles.join(", ")
    : "unknown";
  return [
    `Resolve the merge conflicts from subagent "${subagentTitle(session)}".`,
    "",
    "Context:",
    `- Main workspace: ${parentCwd ?? session.cwd}`,
    `- Subagent branch: ${worktree?.branch ?? "unknown"}`,
    `- Subagent worktree: ${worktree?.path ?? session.cwd}`,
    `- Base SHA: ${worktree?.baseSha ?? "unknown"}`,
    `- Changed files: ${changedFiles}`,
    `- Conflict files: ${conflictFiles}`,
    "",
    "The merge is already open in the main workspace. Inspect git status, conflict markers, and the relevant diffs. Preserve both intents where correct, resolve the files, run the relevant checks, and summarize what you changed. Do not commit.",
  ].join("\n");
}

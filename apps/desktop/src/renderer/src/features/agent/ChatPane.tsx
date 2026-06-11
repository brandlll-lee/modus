import { Popover } from "@base-ui/react/popover";
import {
  IconArrowMergeAltLeft,
  IconCheck,
  IconGitBranch,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { type UIEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentEvent,
  AgentSessionInfo,
  ContextItem,
  ContextUsageInfo,
  ModelInfo,
  PermissionDecision,
  PermissionRequest,
  PromptDelivery,
  PromptImageAttachment,
  ThinkingLevel,
  WorkingChangeStats,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { cn } from "../../lib/cn";
import { Composer } from "../composer/Composer";
import {
  type AgentEventHub,
  type AgentEventItem,
  appendAgentEvents,
  type SessionActivity,
} from "./agentEventHub";
import { ChangeFileList, changeSummaryLabel, LineDelta } from "./changes/ChangeStats";
import { ChangesStrip } from "./changes/ChangesStrip";
import { SessionStatusDot } from "./SessionStatusDot";
import { Timeline } from "./Timeline";

/**
 * One parallel-agent column: a full conversation surface (timeline + composer
 * + per-session errors) bound to a single session. Every pane owns its own
 * event stream (seeded from the store, then fed live through the
 * AgentEventHub), so any number of sessions can stream side by side without
 * sharing state — the Agents-Window model.
 */

/** Coalesce streamed events into ~25fps of React commits (AI SDK guidance). */
const AGENT_EVENT_FLUSH_MS = 40;

type WorktreeApplyState =
  | { phase: "idle" }
  | { phase: "applying" }
  | { phase: "done"; message: string; conflicted: boolean }
  | { phase: "error"; message: string };

type ChatPaneProps = {
  session: AgentSessionInfo;
  hub: AgentEventHub;
  activity: SessionActivity | undefined;
  focused: boolean;
  /** Pane chrome (header w/ title, close, apply) is shown in split layouts. */
  showHeader: boolean;
  models: ModelInfo[];
  /** App-level default model id — fallback when the session has none. */
  defaultModel: string;
  contextUsage?: ContextUsageInfo | undefined;
  workspace: WorkspaceInfo | null;
  onFocus(): void;
  onClose?: (() => void) | undefined;
  /** Refresh the session list after operations that mutate session rows. */
  onSessionsChanged(): void;
  onModelChange(model: string): void;
  onModelConfigChange(model: string, thinkingLevel: ThinkingLevel): Promise<void> | void;
  /** "Review" on the changes strip: focus this pane and open the diff panel. */
  onOpenReview(): void;
};

export function ChatPane({
  session,
  hub,
  activity,
  focused,
  showHeader,
  models,
  defaultModel,
  contextUsage,
  workspace,
  onFocus,
  onClose,
  onSessionsChanged,
  onModelChange,
  onModelConfigChange,
  onOpenReview,
}: ChatPaneProps) {
  const sessionId = session.id;
  const [agentEvents, setAgentEvents] = useState<AgentEventItem[]>([]);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [promptError, setPromptError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [applyState, setApplyState] = useState<WorktreeApplyState>({ phase: "idle" });
  const [applyReviewOpen, setApplyReviewOpen] = useState(false);
  const [workingStats, setWorkingStats] = useState<WorkingChangeStats | undefined>();

  const queuedRef = useRef<AgentEventItem[]>([]);
  const flushTimerRef = useRef<number | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);
  const statsTimerRef = useRef<number | undefined>(undefined);
  const statsCwdRef = useRef(session.worktreePath ?? session.cwd);
  statsCwdRef.current = session.worktreePath ?? session.cwd;

  /** Refresh the working-tree change summary (strip + apply review payload). */
  const refreshStats = useCallback((): void => {
    const cwd = statsCwdRef.current;
    void window.modus.diff
      .stats(cwd)
      .then((stats: WorkingChangeStats) => {
        if (statsCwdRef.current === cwd) {
          setWorkingStats(stats);
        }
      })
      .catch(() => {});
  }, []);

  /** Debounced refresh for mid-run updates (file-edit tools landing). */
  const scheduleStatsRefresh = useCallback((): void => {
    if (statsTimerRef.current !== undefined) {
      return;
    }
    statsTimerRef.current = window.setTimeout(() => {
      statsTimerRef.current = undefined;
      refreshStats();
    }, 1200);
  }, [refreshStats]);

  useEffect(() => () => window.clearTimeout(statsTimerRef.current), []);

  const flushQueued = useCallback((): void => {
    flushTimerRef.current = undefined;
    const queued = queuedRef.current;
    if (queued.length === 0) {
      return;
    }
    queuedRef.current = [];
    setAgentEvents((events) => appendAgentEvents(events, queued));
  }, []);

  const clearQueued = useCallback((): void => {
    queuedRef.current = [];
    if (flushTimerRef.current !== undefined) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = undefined;
    }
  }, []);

  // Seed history + subscribe to the live stream. Re-runs only when the pane is
  // pointed at a different session; onSessionsChanged is intentionally not a
  // dependency (a stable "refresh the list" signal must not re-seed the pane).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    let cancelled = false;
    shouldFollowRef.current = true;
    setAgentEvents([]);
    setPromptError(undefined);
    setPendingPrompt(false);
    setAborting(false);
    setApplyState({ phase: "idle" });
    setApplyReviewOpen(false);
    setWorkingStats(undefined);
    refreshStats();

    const unsubscribe = hub.subscribe(sessionId, (item) => {
      const event = item.event;
      if (event.type === "context.updated") {
        return;
      }
      queuedRef.current.push(item);
      if (flushTimerRef.current === undefined) {
        flushTimerRef.current = window.setTimeout(flushQueued, AGENT_EVENT_FLUSH_MS);
      }
      // Keep the changes strip live while the agent edits files mid-run.
      if (event.type === "tool.ended") {
        scheduleStatsRefresh();
      }
      if (
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled" ||
        event.type === "run.blocked" ||
        event.type === "runtime.error"
      ) {
        setPendingPrompt(false);
        setAborting(false);
        scheduleStatsRefresh();
      }
    });

    // Seed from the store. Events recorded to the DB are sent to the renderer
    // afterwards, so anything that streamed in while the fetch was in flight is
    // already part of a SECOND fetch — re-pull once and drop the live queue to
    // avoid double-applying deltas that exist in both.
    void (async () => {
      let items = await window.modus.agent.listEvents(sessionId);
      if (queuedRef.current.length > 0) {
        queuedRef.current = [];
        items = await window.modus.agent.listEvents(sessionId);
        queuedRef.current = [];
      }
      if (!cancelled) {
        setAgentEvents(items);
      }
    })();
    void window.modus.agent
      .ensure(sessionId)
      .then(() => onSessionsChanged())
      .catch((error: unknown) => {
        if (!cancelled) {
          setPromptError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
      clearQueued();
    };
  }, [sessionId, hub, flushQueued, clearQueued]);

  /* ── Scroll follow ─────────────────────────────────────────────────── */

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const container = event.currentTarget;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldFollowRef.current = distanceFromBottom < 96;
  }

  useEffect(() => {
    const container = viewportRef.current;
    if (!container || !shouldFollowRef.current) {
      return;
    }
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  });

  useEffect(() => {
    const container = viewportRef.current;
    const content = container?.firstElementChild;
    if (!container || !content) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (shouldFollowRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  /* ── Conversation actions ──────────────────────────────────────────── */

  const paneModel = session.model ?? defaultModel;
  const activeCwd = session.worktreePath ?? session.cwd;
  const activeRunStatus = latestRunStatus(agentEvents);
  const isRunning =
    !aborting && (pendingPrompt || activeRunStatus === "running" || activeRunStatus === "blocked");

  function submitPrompt(
    message: string,
    context: ContextItem[],
    delivery: PromptDelivery = "normal",
    attachments?: PromptImageAttachment[],
    skills?: string[],
  ): void {
    if (!message.trim()) {
      return;
    }
    shouldFollowRef.current = true;
    setPromptError(undefined);
    setPendingPrompt(true);
    void window.modus.agent
      .prompt({
        context,
        delivery,
        sessionId,
        message,
        userMessageId: `local-user:${crypto.randomUUID()}`,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
      })
      .then(() => onSessionsChanged())
      .catch((error: unknown) => {
        setPendingPrompt(false);
        setPromptError(error instanceof Error ? error.message : String(error));
      });
  }

  async function abortPrompt(): Promise<void> {
    if (aborting) {
      return;
    }
    setPromptError(undefined);
    setPendingPrompt(false);
    setAborting(true);
    try {
      await window.modus.agent.abort(sessionId);
      onSessionsChanged();
    } catch (error) {
      setAborting(false);
      setPromptError(error instanceof Error ? error.message : String(error));
    }
  }

  async function decidePermission(
    request: PermissionRequest,
    decision: PermissionDecision["decision"],
  ): Promise<void> {
    await window.modus.permission.decide({
      requestId: request.id,
      sessionId: request.sessionId,
      action: request.action,
      target: request.target,
      decision,
    });
  }

  async function editAndResend(
    messageId: string,
    message: string,
    attachments?: PromptImageAttachment[],
  ): Promise<void> {
    if (!paneModel) {
      throw new Error("No model is configured. Connect a provider in Settings first.");
    }
    await window.modus.agent.rollback({ sessionId, userMessageId: messageId });
    clearQueued();
    setAgentEvents(await window.modus.agent.listEvents(sessionId));
    onSessionsChanged();
    refreshStats();
    submitPrompt(message, [], "normal", attachments);
  }

  async function changeModel(nextModel: string): Promise<void> {
    if (!nextModel) {
      return;
    }
    onModelChange(nextModel);
    await window.modus.model.setDefault(nextModel);
    await window.modus.agent.setModel({ sessionId, model: nextModel });
    onSessionsChanged();
  }

  async function applyWorktree(): Promise<void> {
    const rootPath = workspace?.rootPath;
    const worktreePath = session.worktreePath;
    if (!rootPath || !worktreePath || applyState.phase === "applying") {
      return;
    }
    setApplyReviewOpen(false);
    setApplyState({ phase: "applying" });
    try {
      const result = await window.modus.worktree.apply({ cwd: rootPath, path: worktreePath });
      if (result.applied) {
        setApplyState({
          phase: "done",
          message: result.conflicted
            ? `Applied ${result.fileCount} file(s) with conflicts — resolve the markers in the main checkout.`
            : `Applied ${result.fileCount} file(s) to the main checkout.`,
          conflicted: result.conflicted,
        });
      } else if (result.fileCount === 0) {
        setApplyState({ phase: "done", message: "No changes to apply.", conflicted: false });
      } else {
        setApplyState({ phase: "error", message: result.output });
      }
      refreshStats();
    } catch (error) {
      setApplyState({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <section
      className={cn(
        "flex h-full min-w-0 flex-1 flex-col border-hairline-strong border-l first:border-l-0",
        showHeader && !focused && "opacity-[0.97]",
      )}
      onFocusCapture={onFocus}
      onMouseDownCapture={onFocus}
    >
      {showHeader ? (
        <header
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 border-hairline-soft border-b px-3",
            focused ? "bg-transparent" : "bg-panel/40",
          )}
        >
          <SessionStatusDot activity={activity} />
          <span
            className={cn("min-w-0 truncate text-sm", focused ? "text-fg" : "text-fg-muted")}
            title={session.title}
          >
            {session.title}
          </span>
          {session.worktreePath ? (
            <span
              className="flex shrink-0 items-center gap-1 rounded bg-chip px-1.5 py-0.5 text-2xs text-fg-faint"
              title={session.worktreePath}
            >
              <IconGitBranch size={10} stroke={1.8} />
              worktree
            </span>
          ) : null}
          <div className="min-w-0 flex-1" />
          {applyState.phase === "done" || applyState.phase === "error" ? (
            <span
              className={cn(
                "min-w-0 truncate text-2xs",
                applyState.phase === "error" || applyState.conflicted
                  ? "text-danger"
                  : "text-success",
              )}
              title={applyState.message}
            >
              {applyState.message}
            </span>
          ) : null}
          {session.worktreePath && workspace ? (
            <Popover.Root onOpenChange={setApplyReviewOpen} open={applyReviewOpen}>
              <Popover.Trigger
                className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:cursor-wait data-popup-open:bg-active data-popup-open:text-fg"
                disabled={applyState.phase === "applying"}
                onClick={() => refreshStats()}
                title="Review & apply this worktree's changes to the main checkout"
              >
                {applyState.phase === "applying" ? (
                  <IconLoader2 className="animate-spin" size={12} stroke={1.8} />
                ) : applyState.phase === "done" && !applyState.conflicted ? (
                  <IconCheck size={12} stroke={1.9} />
                ) : (
                  <IconArrowMergeAltLeft size={12} stroke={1.8} />
                )}
                Apply
              </Popover.Trigger>
              <AnimatePresence>
                {applyReviewOpen ? (
                  <Popover.Portal keepMounted>
                    <Popover.Positioner align="end" side="bottom" sideOffset={8}>
                      <Popover.Popup render={<m.div />}>
                        <m.div
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          className="w-[360px] rounded-xl border border-hairline bg-elevated p-3 shadow-popup outline-none"
                          exit={{ opacity: 0, scale: 0.98, y: -4 }}
                          initial={{ opacity: 0, scale: 0.98, y: -4 }}
                          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <div className="flex items-center gap-2 px-1 pb-2">
                            <span className="text-sm text-fg">Apply to main workspace</span>
                            <div className="flex-1" />
                            {workingStats && workingStats.fileCount > 0 ? (
                              <LineDelta
                                added={workingStats.added}
                                removed={workingStats.removed}
                              />
                            ) : null}
                          </div>
                          {workingStats && workingStats.fileCount > 0 ? (
                            <>
                              <p className="px-1 pb-2 text-xs leading-5 text-fg-faint">
                                {changeSummaryLabel(workingStats)} in this worktree will be merged
                                into the main checkout. Conflicting lines land as markers.
                              </p>
                              <div className="rounded-lg border border-hairline-soft bg-canvas/40 px-1 py-1">
                                <ChangeFileList className="max-h-48" stats={workingStats} />
                              </div>
                            </>
                          ) : (
                            <p className="px-1 pb-1 text-xs leading-5 text-fg-faint">
                              This worktree has no changes to apply.
                            </p>
                          )}
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              className="h-7 rounded-md px-2.5 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
                              onClick={() => setApplyReviewOpen(false)}
                              type="button"
                            >
                              Cancel
                            </button>
                            <button
                              className="flex h-7 items-center gap-1.5 rounded-md bg-fg px-3 text-xs font-medium text-canvas transition-colors hover:bg-fg-muted disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!workingStats || workingStats.fileCount === 0}
                              onClick={() => void applyWorktree()}
                              type="button"
                            >
                              <IconArrowMergeAltLeft size={12} stroke={1.9} />
                              Apply{" "}
                              {workingStats && workingStats.fileCount > 0
                                ? `${workingStats.fileCount} file${workingStats.fileCount === 1 ? "" : "s"}`
                                : ""}
                            </button>
                          </div>
                        </m.div>
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                ) : null}
              </AnimatePresence>
            </Popover.Root>
          ) : null}
          {onClose ? (
            <button
              aria-label={`Close ${session.title}`}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
              onClick={onClose}
              type="button"
            >
              <IconX size={13} stroke={1.8} />
            </button>
          ) : null}
        </header>
      ) : null}

      {promptError ? (
        <div className="mx-4 mt-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
          {promptError}
        </div>
      ) : null}

      <div
        className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable_both-edges]"
        onScroll={handleScroll}
        ref={viewportRef}
      >
        <Timeline
          agentEvents={agentEvents}
          cwd={activeCwd}
          onEditResend={editAndResend}
          onPermissionDecision={(request, decision) => void decidePermission(request, decision)}
          onRestoreCheckpoint={async (checkpointId) => {
            await window.modus.checkpoint.restore({ checkpointId });
            refreshStats();
          }}
        />
      </div>

      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto max-w-5xl">
          {workingStats ? (
            <ChangesStrip
              onOpenFile={(path) =>
                void window.modus.file.open({ cwd: activeCwd, path }).catch(() => {})
              }
              onReview={onOpenReview}
              stats={workingStats}
            />
          ) : null}
          <Composer
            canSubmit={Boolean(workspace) && Boolean(paneModel)}
            contextItems={contextItems}
            cwd={activeCwd}
            hasSession
            isRunning={isRunning}
            model={paneModel}
            models={models}
            {...(contextUsage ? { contextUsage } : {})}
            onAbort={() => void abortPrompt()}
            onContextChange={setContextItems}
            onModelChange={(next) => void changeModel(next)}
            onModelConfigChange={onModelConfigChange}
            onSubmit={(message, context, delivery, attachments, skills) =>
              submitPrompt(message, context, delivery, attachments, skills)
            }
            workspaceId={workspace?.id}
          />
        </div>
      </div>
    </section>
  );
}

function latestRunStatus(events: Array<{ event: AgentEvent }>): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]?.event;
    if (event?.type.startsWith("run.")) {
      return event.type.replace("run.", "");
    }
  }
  return undefined;
}

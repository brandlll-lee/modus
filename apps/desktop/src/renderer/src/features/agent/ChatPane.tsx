import { IconArrowDown } from "@tabler/icons-react";
import { m } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMode,
  AgentSessionInfo,
  BrowserEvent,
  ContextItem,
  ContextUsageInfo,
  ModelInfo,
  PermissionDecision,
  PermissionRequest,
  PlanRef,
  PromptDelivery,
  PromptImageAttachment,
  QuestionAnswer,
  SkillSelection,
  WorkingChangeStats,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { Composer } from "../composer/Composer";
import { ComposerDock } from "../composer/ComposerDock";
import {
  addDesignAnnotationToDraft,
  addDesignElementToDraft,
  type ChatComposerDraft,
  type ChatComposerDraftUpdate,
  createEmptyChatComposerDraft,
  designEventToPromptInput,
} from "../composer/chatComposerDraft";
import { type ComposerDraftUpdate, resolveDraftUpdate } from "../composer/composerDraft";
import { buildPlanMessage, effectiveBuildStatus, normalizePlan } from "../plan/planState";
import { QuestionsCard } from "../plan/QuestionsCard";
import { ReviewPlanCard } from "../plan/ReviewPlanCard";
import { RunningProcessBar } from "../process/RunningProcessBar";
import { useManagedProcesses } from "../process/useManagedProcesses";
import { ApprovalPanel } from "./ApprovalPanel";
import {
  type AgentEventHub,
  type AgentEventItem,
  appendAgentEvents,
  foldAgentEvents,
  optimisticUserPromptEvents,
} from "./agentEventHub";
import { ConversationTimeline } from "./ConversationTimeline";
import { ChangesStrip } from "./changes/ChangesStrip";
import { latestPendingPermissionRequest } from "./permissionRequests";
import { latestInlineQuestion } from "./questionRequests";
import { RetryStatusBar } from "./RetryStatusBar";
import { latestSessionStatus } from "./runState";
import { buildVisibleTimelineBlocks, Timeline } from "./Timeline";
import { useAutoScroll } from "./useAutoScroll";

/**
 * Full conversation surface bound to one active session.
 */

type ChatPaneProps = {
  session: AgentSessionInfo;
  hub: AgentEventHub;
  models: ModelInfo[];
  /** App-level default model id — fallback when the session has none. */
  defaultModel: string;
  contextUsage?: ContextUsageInfo | undefined;
  workspace: WorkspaceInfo | null;
  initialEvents?: AgentEventItem[] | undefined;
  onInitialEventsConsumed?(sessionId: string): void;
  /** Refresh the session list after operations that mutate session rows. */
  onSessionsChanged(): void;
  onModelChange(model: string): void;
  onModelConfigChange(model: string, thinkingVariant: string): Promise<void> | void;
  /** "Review" on the changes strip: focus this pane and open the diff panel. */
  onOpenReview(cwd?: string): void;
  composerReplacement?: ReactNode;
  composerDraft?: ChatComposerDraft | undefined;
  onComposerDraftChange?(update: ChatComposerDraftUpdate): void;
  /** A plan was (re)written in Plan Mode: keep the inspector's plan data current. */
  onPlanUpdated(plan: PlanRef): void;
  /** Explicitly open a completed timeline plan in the inspector. */
  onOpenPlan?(plan: PlanRef): void;
  /** Open a workspace file in the Files inspector panel. */
  onOpenFile?(path: string): void;
  /** Open a background terminal in the Terminal inspector panel. */
  onOpenTerminal?(terminalId: string): void;
};

export function ChatPane({
  session,
  hub,
  models,
  defaultModel,
  contextUsage,
  workspace,
  initialEvents,
  onInitialEventsConsumed,
  onSessionsChanged,
  onModelChange,
  onModelConfigChange,
  onOpenReview,
  composerReplacement,
  composerDraft,
  onComposerDraftChange,
  onPlanUpdated,
  onOpenPlan,
  onOpenFile,
  onOpenTerminal,
}: ChatPaneProps) {
  const sessionId = session.id;
  const [agentEvents, setAgentEvents] = useState<AgentEventItem[]>([]);
  const loadedSessionRef = useRef<string | undefined>(undefined);
  const [localComposerDraft, setLocalComposerDraft] = useState<ChatComposerDraft>(
    createEmptyChatComposerDraft,
  );
  const [promptError, setPromptError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [workingStats, setWorkingStats] = useState<WorkingChangeStats | undefined>();
  const [dismissedPlanHash, setDismissedPlanHash] = useState<string | undefined>(undefined);
  const managedProcesses = useManagedProcesses({
    workspaceId: workspace?.id,
    sessionId,
    origin: "agent",
  });
  const runningProcesses = useMemo(
    () => managedProcesses.processes.filter((process) => process.status === "running"),
    [managedProcesses.processes],
  );
  const showChangesRail = Boolean(workingStats && workingStats.fileCount > 0);
  const hasComposerRails = runningProcesses.length > 0 || showChangesRail;
  const activeComposerDraft = composerDraft ?? localComposerDraft;
  const contextItems = activeComposerDraft.contextItems;
  const composerMode = activeComposerDraft.mode;
  const setComposerDraft = useCallback(
    (update: ChatComposerDraftUpdate): void => {
      if (onComposerDraftChange) {
        onComposerDraftChange(update);
      } else {
        setLocalComposerDraft(update);
      }
    },
    [onComposerDraftChange],
  );
  const setContextItems = useCallback(
    (update: ContextItem[] | ((current: ContextItem[]) => ContextItem[])): void => {
      setComposerDraft((draft) => ({
        ...draft,
        contextItems: resolveDraftUpdate(update, draft.contextItems),
      }));
    },
    [setComposerDraft],
  );
  const setComposerMode = useCallback(
    (mode: AgentMode): void => {
      setComposerDraft((draft) => ({ ...draft, mode }));
    },
    [setComposerDraft],
  );
  const setComposerFields = useCallback(
    (update: ComposerDraftUpdate): void => {
      setComposerDraft((draft) => ({
        ...draft,
        ...resolveDraftUpdate(update, {
          value: draft.value,
          images: draft.images,
          parts: draft.parts,
          selectedSkills: draft.selectedSkills,
        }),
      }));
    },
    [setComposerDraft],
  );
  const addDesignElement = useCallback(
    (event: Extract<BrowserEvent, { type: "browser.design-select" }>): void => {
      setComposerDraft((draft) => addDesignElementToDraft(draft, event));
    },
    [setComposerDraft],
  );
  const addDesignAnnotation = useCallback(
    (event: Extract<BrowserEvent, { type: "browser.design-annotate" }>): void => {
      setComposerDraft((draft) => addDesignAnnotationToDraft(draft, event));
    },
    [setComposerDraft],
  );

  const queuedRef = useRef<AgentEventItem[]>([]);
  /** Pending frame-clock flush handle (requestAnimationFrame id). */
  const flushFrameRef = useRef<number | undefined>(undefined);
  const statsTimerRef = useRef<number | undefined>(undefined);
  const statsCwdRef = useRef(session.cwd);
  statsCwdRef.current = session.cwd;

  // The session's authoritative run-status (busy/retry/idle), read from the
  // runtime's `session.status` events. The composer locks while the session is
  // working (anything but idle), so a transient error never unlocks input
  // mid-turn. `pendingPrompt` is the optimistic bridge until the first status.
  const sessionStatus = useMemo(() => latestSessionStatus(agentEvents), [agentEvents]);
  const isRunning = !aborting && (sessionStatus.type !== "idle" || pendingPrompt);

  // Stick-to-bottom follows the bottom only while the session is working; idle
  // viewing/scrolling never snaps back (opencode's createAutoScroll model).
  const autoScroll = useAutoScroll(isRunning);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const setChatScrollRef = useCallback(
    (el: HTMLDivElement | null): void => {
      setScrollContainer(el);
      autoScroll.scrollRef(el);
    },
    [autoScroll.scrollRef],
  );
  const visibleBlocks = useMemo(() => buildVisibleTimelineBlocks(agentEvents), [agentEvents]);

  // The latest plan written/updated in this session. Keep the inspector's data
  // current without opening it; only the timeline card's expand action opens it.
  const latestPlan = useMemo<PlanRef | undefined>(() => {
    let latest: PlanRef | undefined;
    for (const item of agentEvents) {
      if (item.event.type === "plan.updated") {
        latest = item.event.plan;
      }
    }
    // Old sessions recorded plan.updated before todos/overview/buildStatus
    // existed; normalize so the Plan panel and Review card can trust the shape.
    return latest ? normalizePlan(latest) : undefined;
  }, [agentEvents]);

  useEffect(() => {
    if (latestPlan) {
      onPlanUpdated(latestPlan);
    }
  }, [latestPlan, onPlanUpdated]);

  /**
   * Build Locally: the user's explicit authorization to execute the approved
   * plan. Sends a CONCISE build message — the plan title, its to-dos, and a
   * pointer to the full plan.md — not the whole plan pasted inline. The agent
   * reads the file for full detail. Passing the plan id binds this turn's run
   * lifecycle to the plan's build status (building → built/not_built).
   */
  function buildPlanLocally(plan: PlanRef): void {
    setComposerMode("build");
    submitPrompt(buildPlanMessage(plan), [], "normal", undefined, undefined, "build", plan.id);
  }

  /** Refresh the working-tree change summary shown above the composer. */
  const refreshStats = useCallback((): void => {
    void window.modus.diff
      .sessionStats(sessionId)
      .then((stats: WorkingChangeStats) => {
        if (statsCwdRef.current === session.cwd) {
          setWorkingStats(stats);
        }
      })
      .catch(() => {});
  }, [sessionId, session.cwd]);

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

  useEffect(
    () => () => {
      window.clearTimeout(statsTimerRef.current);
    },
    [],
  );

  const flushQueued = useCallback((): void => {
    flushFrameRef.current = undefined;
    const queued = queuedRef.current;
    if (queued.length === 0) {
      return;
    }
    queuedRef.current = [];
    setAgentEvents((events) => appendAgentEvents(events, queued));
  }, []);

  const clearQueued = useCallback((): void => {
    queuedRef.current = [];
    if (flushFrameRef.current !== undefined) {
      cancelAnimationFrame(flushFrameRef.current);
      flushFrameRef.current = undefined;
    }
  }, []);

  // Seed history + subscribe to the live stream. Re-runs only when the pane is
  // pointed at a different session; onSessionsChanged is intentionally not a
  // dependency (a stable "refresh the list" signal must not re-seed the pane).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    let cancelled = false;
    if (loadedSessionRef.current !== sessionId) setAgentEvents(initialEvents ?? []);
    if (initialEvents && initialEvents.length > 0) {
      onInitialEventsConsumed?.(sessionId);
    }
    setPromptError(undefined);
    setPendingPrompt(false);
    setAborting(false);
    setWorkingStats(undefined);
    refreshStats();

    const unsubscribe = hub.subscribe(sessionId, (item) => {
      const event = item.event;
      if (event.type === "context.updated") {
        return;
      }
      queuedRef.current.push(item);
      if (flushFrameRef.current === undefined) {
        flushFrameRef.current = requestAnimationFrame(flushQueued);
      }
      // Keep the changes strip live while the agent edits files mid-run.
      if (event.type === "tool.ended") {
        scheduleStatsRefresh();
      }
      // Authoritative run-status drives the composer. Once the runtime reports
      // real status, the optimistic pre-turn flag has done its job; on idle the
      // turn is fully over, so also clear any abort-in-flight and refresh stats.
      if (event.type === "session.status") {
        setPendingPrompt(false);
        if (event.status.type === "idle") {
          setAborting(false);
          scheduleStatsRefresh();
        }
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
        setAgentEvents(foldAgentEvents([...(initialEvents ?? []), ...items]));
        // Land at the latest message when opening a session. Idle sessions
        // never auto-follow, so this initial pin is explicit.
        if (loadedSessionRef.current !== sessionId) {
          requestAnimationFrame(() => autoScroll.resume());
          loadedSessionRef.current = sessionId;
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      clearQueued();
    };
  }, [sessionId, hub, flushQueued, clearQueued]);

  /* ── Conversation actions ──────────────────────────────────────────── */

  const paneModel = session.model ?? defaultModel;
  const activeCwd = session.cwd;
  const retryStatus = sessionStatus.type === "retry" ? sessionStatus : undefined;
  // The decision card shows only while the plan is unbuilt and not dismissed.
  // Reading the plan's authoritative build status (not a remembered hash) is
  // what stops the card from re-appearing after a build on session re-open.
  const reviewPlan =
    latestPlan &&
    !isRunning &&
    latestPlan.hash !== dismissedPlanHash &&
    effectiveBuildStatus(latestPlan, sessionStatus.type !== "idle") === "not_built"
      ? latestPlan
      : undefined;
  const pendingPermission = useMemo(
    () => latestPendingPermissionRequest(agentEvents),
    [agentEvents],
  );
  const pendingQuestion = useMemo(() => latestInlineQuestion(agentEvents), [agentEvents]);

  function submitPrompt(
    message: string,
    context: ContextItem[],
    delivery: PromptDelivery = "normal",
    attachments?: PromptImageAttachment[],
    skills?: SkillSelection[],
    mode?: AgentMode,
    planId?: string,
  ): void {
    if (!message.trim()) {
      return;
    }
    autoScroll.resume();
    setPromptError(undefined);
    setPendingPrompt(true);
    const mergedAttachments = attachments ?? [];
    const leanContext = context.map((item): ContextItem => {
      if (item.type === "design-element") {
        const { screenshotDataUrl: _drop, ...element } = item.element;
        return { ...item, element };
      }
      if (item.type === "design-annotation") {
        const { screenshotDataUrl: _drop, ...annotation } = item.annotation;
        return { ...item, annotation };
      }
      return item;
    });
    // Bind THIS turn's execution params to the prompt: the model the composer
    // currently shows + its provider-facing thinking variant. The runtime applies them at turn
    // start, so the turn is self-describing — no stale model/thinking/mode after
    // a mid-session switch, edit-and-resend, or resume.
    const turnModel = models.find((item) => item.id === paneModel);
    const turnThinking = turnModel?.thinkingVariant ?? turnModel?.thinkingLevel;
    const userMessageId = `local-user:${crypto.randomUUID()}`;
    setAgentEvents((events) =>
      appendAgentEvents(
        events,
        optimisticUserPromptEvents({
          sessionId,
          userMessageId,
          message,
          ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
          ...(skills && skills.length > 0 ? { skills } : {}),
          ...(leanContext.length > 0 ? { contextItems: leanContext } : {}),
        }),
      ),
    );
    void window.modus.agent
      .prompt({
        context: leanContext,
        delivery,
        sessionId,
        message,
        userMessageId,
        ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
        ...(mode ? { mode } : {}),
        ...(paneModel ? { model: paneModel } : {}),
        ...(turnThinking ? { thinkingVariant: turnThinking } : {}),
        ...(planId ? { planId } : {}),
      })
      .then(() => onSessionsChanged())
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setPendingPrompt(false);
        setAgentEvents((events) =>
          appendAgentEvents(events, [
            {
              id: `local:${Date.now()}:${crypto.randomUUID()}:error`,
              event: { type: "runtime.error", sessionId, message: errorMessage },
              createdAt: new Date().toISOString(),
            },
            {
              id: `local:${Date.now()}:${crypto.randomUUID()}:idle`,
              event: { type: "session.status", sessionId, status: { type: "idle" } },
              createdAt: new Date().toISOString(),
            },
          ]),
        );
        setPromptError(errorMessage);
      });
  }

  // Design Mode (in-app browser) routes into this open session: Ctrl+L adds to
  // the composer, Enter sends immediately.
  useEffect(() => {
    const wsId = workspace?.id;
    if (!wsId) {
      return undefined;
    }
    return window.modus.browser.onEvent((event: BrowserEvent) => {
      if (event.type !== "browser.design-select" && event.type !== "browser.design-annotate") {
        return;
      }
      if (event.workspaceId !== wsId) {
        return;
      }
      if (event.intent === "submit") {
        const input = designEventToPromptInput(event);
        submitPrompt(
          input.message,
          input.context,
          isRunning ? "follow-up" : "normal",
          input.attachments,
          undefined,
          input.mode,
        );
        return;
      }
      if (event.type === "browser.design-select") {
        addDesignElement(event);
      }
      if (event.type === "browser.design-annotate") {
        addDesignAnnotation(event);
      }
    });
  });

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
    setPromptError(undefined);
    await window.modus.permission.decide({
      requestId: request.id,
      sessionId: request.sessionId,
      action: request.action,
      target: request.target,
      decision,
    });
  }

  async function respondQuestion(answers: QuestionAnswer[], skipped: boolean): Promise<void> {
    if (!pendingQuestion) {
      return;
    }
    setPromptError(undefined);
    await window.modus.questions.respond({ requestId: pendingQuestion.id, answers, skipped });
  }

  async function editAndResend(
    messageId: string,
    message: string,
    attachments?: PromptImageAttachment[],
    contextItems?: ContextItem[],
    skills?: SkillSelection[],
  ): Promise<void> {
    if (!paneModel) {
      throw new Error("No model is configured. Connect a provider in Settings first.");
    }
    await window.modus.agent.rollback({ sessionId, userMessageId: messageId });
    clearQueued();
    setAgentEvents(await window.modus.agent.listEvents(sessionId));
    onSessionsChanged();
    refreshStats();
    // Resend under the composer's CURRENT mode (plan/build); submitPrompt also
    // attaches the current model+thinking. Dropping mode here was why an edited
    // resend silently fell back to build mode.
    submitPrompt(message, contextItems ?? [], "normal", attachments, skills, composerMode);
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

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      {promptError ? (
        <div className="mx-4 mt-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger">
          {promptError}
        </div>
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1">
        <ConversationTimeline blocks={visibleBlocks} scrollContainer={scrollContainer} />

        <ChatViewport
          contentRef={autoScroll.contentRef}
          onScroll={autoScroll.handleScroll}
          scrollRef={setChatScrollRef}
        >
          <Timeline
            sessionId={sessionId}
            blocks={visibleBlocks}
            cwd={activeCwd}
            model={paneModel}
            models={models}
            onEditResend={editAndResend}
            {...(onOpenFile ? { onOpenFile } : {})}
            {...(onOpenPlan ? { onOpenPlan } : {})}
            onRestoreCheckpoint={async (checkpointId) => {
              await window.modus.checkpoint.restore({ checkpointId });
              refreshStats();
            }}
            workspaceId={workspace?.id}
          />
        </ChatViewport>
      </div>

      <div className="min-w-0 max-w-full shrink-0 px-4 pb-4">
        {/* Same .chat-column token as Timeline's content wrapper — one width authority. */}
        <div className="chat-column relative">
          {autoScroll.showScrollToLatest ? (
            <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2">
              <button
                aria-label="Scroll to latest"
                className="pointer-events-auto flex size-10 items-center justify-center rounded-full border border-popup-border bg-elevated text-fg-muted shadow-popup outline-none transition-colors duration-100 hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus-ring/35"
                onClick={autoScroll.scrollToLatest}
                title="Scroll to latest"
                type="button"
              >
                <IconArrowDown aria-hidden size={21} stroke={1.9} />
              </button>
            </div>
          ) : null}
          {pendingPermission ? (
            <ApprovalPanel
              key={pendingPermission.id}
              onDecide={(request, decision) => decidePermission(request, decision)}
              request={pendingPermission}
            />
          ) : (
            <>
              {pendingQuestion ? (
                <QuestionsCard
                  key={pendingQuestion.id}
                  onSkip={() => void respondQuestion([], true)}
                  onSubmit={(answers) => void respondQuestion(answers, false)}
                  request={pendingQuestion}
                />
              ) : null}
              {composerReplacement ? (
                composerReplacement
              ) : reviewPlan ? (
                <ReviewPlanCard
                  onBuildLocally={() => buildPlanLocally(reviewPlan)}
                  onContinuePlanning={() => {
                    setComposerMode("plan");
                    setDismissedPlanHash(reviewPlan.hash);
                  }}
                />
              ) : (
                <>
                  {retryStatus ? <RetryStatusBar status={retryStatus} /> : null}
                  <ComposerDock
                    rails={
                      hasComposerRails ? (
                        <>
                          {runningProcesses.length > 0 ? (
                            <RunningProcessBar
                              nowMs={managedProcesses.nowMs}
                              onStop={managedProcesses.kill}
                              processes={runningProcesses}
                              {...(onOpenTerminal ? { onOpenTerminal } : {})}
                            />
                          ) : null}

                          {showChangesRail && workingStats ? (
                            <ChangesStrip
                              onOpenFile={(path) =>
                                void window.modus.file
                                  .open({ cwd: activeCwd, path })
                                  .catch(() => {})
                              }
                              onReview={() => onOpenReview(activeCwd)}
                              stats={workingStats}
                            />
                          ) : null}
                        </>
                      ) : undefined
                    }
                  >
                    <Composer
                      sessionId={sessionId}
                      canSubmit={Boolean(workspace) && Boolean(paneModel)}
                      contextItems={contextItems}
                      cwd={activeCwd}
                      draft={{
                        images: activeComposerDraft.images,
                        parts: activeComposerDraft.parts,
                        selectedSkills: activeComposerDraft.selectedSkills,
                        value: activeComposerDraft.value,
                      }}
                      isRunning={isRunning}
                      mode={composerMode}
                      model={paneModel}
                      models={models}
                      {...(contextUsage ? { contextUsage } : {})}
                      onAbort={() => void abortPrompt()}
                      onCompact={() => window.modus.agent.compact(sessionId)}
                      onContextChange={setContextItems}
                      onDraftChange={setComposerFields}
                      onModeChange={setComposerMode}
                      onModelChange={(next) => void changeModel(next)}
                      onModelConfigChange={onModelConfigChange}
                      onSubmit={(message, context, delivery, attachments, skills, mode) =>
                        submitPrompt(message, context, delivery, attachments, skills, mode)
                      }
                      workspaceId={workspace?.id}
                    />
                  </ComposerDock>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ChatViewport({
  children,
  onScroll,
  scrollRef,
  contentRef,
}: {
  children: ReactNode;
  onScroll(): void;
  scrollRef: (el: HTMLDivElement | null) => void;
  contentRef: (el: HTMLElement | null) => void;
}) {
  return (
    <m.div
      className="scroll-thin min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-clip overscroll-contain [scrollbar-gutter:stable_both-edges]"
      layoutScroll
      onScroll={onScroll}
      ref={scrollRef}
    >
      <div className="flex min-h-full min-w-0 w-full max-w-full flex-col" ref={contentRef}>
        {children}
      </div>
    </m.div>
  );
}

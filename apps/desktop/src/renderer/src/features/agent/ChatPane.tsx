import {
  type ReactNode,
  type RefObject,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  ThinkingLevel,
  WorkingChangeStats,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { CollapsibleMotionProvider } from "../../components/ui/CollapsibleMotion";
import { Composer } from "../composer/Composer";
import { QuestionsCard } from "../plan/QuestionsCard";
import { ReviewPlanCard } from "../plan/ReviewPlanCard";
import { ApprovalPanel } from "./ApprovalPanel";
import { type AgentEventHub, type AgentEventItem, appendAgentEvents } from "./agentEventHub";
import { ChangesStrip } from "./changes/ChangesStrip";
import { latestPendingPermissionRequest } from "./permissionRequests";
import { latestPendingQuestionRequest } from "./questionRequests";
import { isRunActive, isTerminalRunEvent } from "./runState";
import { Timeline } from "./Timeline";

/**
 * Full conversation surface bound to one active session.
 */

/** Coalesce streamed events into ~25fps of React commits (AI SDK guidance). */
const AGENT_EVENT_FLUSH_MS = 40;

type ChatPaneProps = {
  session: AgentSessionInfo;
  hub: AgentEventHub;
  models: ModelInfo[];
  /** App-level default model id — fallback when the session has none. */
  defaultModel: string;
  contextUsage?: ContextUsageInfo | undefined;
  workspace: WorkspaceInfo | null;
  /** Refresh the session list after operations that mutate session rows. */
  onSessionsChanged(): void;
  onModelChange(model: string): void;
  onModelConfigChange(model: string, thinkingLevel: ThinkingLevel): Promise<void> | void;
  /** "Review" on the changes strip: focus this pane and open the diff panel. */
  onOpenReview(): void;
  /** A plan was (re)written in Plan Mode: open it in the file panel. */
  onPlanUpdated(plan: PlanRef): void;
};

export function ChatPane({
  session,
  hub,
  models,
  defaultModel,
  contextUsage,
  workspace,
  onSessionsChanged,
  onModelChange,
  onModelConfigChange,
  onOpenReview,
  onPlanUpdated,
}: ChatPaneProps) {
  const sessionId = session.id;
  const [agentEvents, setAgentEvents] = useState<AgentEventItem[]>([]);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [promptError, setPromptError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [workingStats, setWorkingStats] = useState<WorkingChangeStats | undefined>();
  const [reviewPlan, setReviewPlan] = useState<PlanRef | undefined>();
  const lastPlanHashRef = useRef<string | undefined>(undefined);
  const [composerMode, setComposerMode] = useState<AgentMode>("build");

  const queuedRef = useRef<AgentEventItem[]>([]);
  const flushTimerRef = useRef<number | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);
  const scrollFollowPauseTimerRef = useRef<number | undefined>(undefined);
  const statsTimerRef = useRef<number | undefined>(undefined);
  const statsCwdRef = useRef(session.cwd);
  statsCwdRef.current = session.cwd;

  // When Plan Mode writes/updates a plan, surface a Review card and open it in
  // the file panel. Keyed by content hash so we react once per distinct plan.
  useEffect(() => {
    let latest: PlanRef | undefined;
    for (const item of agentEvents) {
      if (item.event.type === "plan.updated") {
        latest = item.event.plan;
      }
    }
    if (latest && latest.hash !== lastPlanHashRef.current) {
      lastPlanHashRef.current = latest.hash;
      setReviewPlan(latest);
      onPlanUpdated(latest);
    }
  }, [agentEvents, onPlanUpdated]);

  /**
   * Build Locally: the user's explicit authorization to execute an approved
   * plan with a single agent. Switches the composer to build mode and sends a
   * self-contained build prompt anchored on the plan (the plan, not the
   * planning chatter, is the source of truth — concise-history by construction).
   * Capability is build mode's full tool set; the plan's Acceptance Criteria are
   * the verification contract the agent is told to check before finishing.
   */
  function buildPlanLocally(plan: PlanRef): void {
    setComposerMode("build");
    setReviewPlan(undefined);
    const message = [
      "Implement the following approved plan. Treat it as the single source of truth:",
      "work through its Tasks, satisfy every Acceptance Criterion, and verify the result",
      "against those criteria (build/tests where applicable) before reporting done.",
      "",
      `<plan title="${plan.title}">`,
      plan.content,
      "</plan>",
    ].join("\n");
    submitPrompt(message, [], "normal", undefined, undefined, "build");
  }

  /** Refresh the working-tree change summary shown above the composer. */
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

  useEffect(
    () => () => {
      window.clearTimeout(statsTimerRef.current);
      window.clearTimeout(scrollFollowPauseTimerRef.current);
    },
    [],
  );

  // Design Mode (in-app browser) → the selected element lands in the composer
  // context as a removable thumbnail + chip, de-duplicated by its id.
  useEffect(() => {
    const wsId = workspace?.id;
    if (!wsId) {
      return undefined;
    }
    return window.modus.browser.onEvent((event: BrowserEvent) => {
      if (event.type === "browser.design-select" && event.workspaceId === wsId) {
        setContextItems((items) =>
          items.some(
            (item) => item.type === "design-element" && item.element.id === event.element.id,
          )
            ? items
            : [...items, { type: "design-element", element: event.element }],
        );
      }
    });
  }, [workspace?.id]);

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
      if (isTerminalRunEvent(event)) {
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

  const pauseScrollFollow = useCallback((durationMs: number): void => {
    const container = viewportRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom >= 96) {
      return;
    }
    shouldFollowRef.current = false;
    window.clearTimeout(scrollFollowPauseTimerRef.current);
    scrollFollowPauseTimerRef.current = window.setTimeout(() => {
      const latest = viewportRef.current;
      if (!latest) {
        return;
      }
      const latestDistance = latest.scrollHeight - latest.scrollTop - latest.clientHeight;
      shouldFollowRef.current = latestDistance < 96;
    }, durationMs);
  }, []);

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
  const activeCwd = session.cwd;
  const isRunning = !aborting && (isRunActive(agentEvents) || pendingPrompt);
  const pendingPermission = useMemo(
    () => latestPendingPermissionRequest(agentEvents),
    [agentEvents],
  );
  const pendingQuestion = useMemo(() => latestPendingQuestionRequest(agentEvents), [agentEvents]);

  function submitPrompt(
    message: string,
    context: ContextItem[],
    delivery: PromptDelivery = "normal",
    attachments?: PromptImageAttachment[],
    skills?: string[],
    mode?: AgentMode,
  ): void {
    if (!message.trim()) {
      return;
    }
    shouldFollowRef.current = true;
    setPromptError(undefined);
    setPendingPrompt(true);
    // Design-element context carries an element screenshot. Send it to the model
    // as an image attachment (so it can see the element), and strip the heavy
    // base64 out of the text context payload so it only travels once.
    const designAttachments: PromptImageAttachment[] = [];
    for (const item of context) {
      if (item.type !== "design-element" || !item.element.screenshotDataUrl) {
        continue;
      }
      const match = /^data:(.+?);base64,(.*)$/.exec(item.element.screenshotDataUrl);
      const mimeType = match?.[1];
      const data = match?.[2];
      if (mimeType && data) {
        designAttachments.push({
          type: "image",
          data,
          mimeType,
          name: `${item.element.label}.png`,
        });
      }
    }
    const mergedAttachments = [...(attachments ?? []), ...designAttachments];
    const leanContext = context.map((item) =>
      item.type === "design-element"
        ? { ...item, element: { ...item.element, screenshotDataUrl: undefined } }
        : item,
    );
    // Bind THIS turn's execution params to the prompt: the model the composer
    // currently shows + its thinking level. The runtime applies them at turn
    // start, so the turn is self-describing — no stale model/thinking/mode after
    // a mid-session switch, edit-and-resend, or resume.
    const turnThinking = models.find((item) => item.id === paneModel)?.thinkingLevel;
    void window.modus.agent
      .prompt({
        context: leanContext,
        delivery,
        sessionId,
        message,
        userMessageId: `local-user:${crypto.randomUUID()}`,
        ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
        ...(mode ? { mode } : {}),
        ...(paneModel ? { model: paneModel } : {}),
        ...(turnThinking ? { thinkingLevel: turnThinking } : {}),
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
    submitPrompt(message, [], "normal", attachments, undefined, composerMode);
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

      <CollapsibleMotionProvider onLayoutAnimationStart={pauseScrollFollow}>
        <ChatViewport onScroll={handleScroll} viewportRef={viewportRef}>
          <Timeline
            agentEvents={agentEvents}
            cwd={activeCwd}
            onEditResend={editAndResend}
            onRestoreCheckpoint={async (checkpointId) => {
              await window.modus.checkpoint.restore({ checkpointId });
              refreshStats();
            }}
          />
        </ChatViewport>
      </CollapsibleMotionProvider>

      <div className="min-w-0 max-w-full shrink-0 px-4 pb-4">
        <div className="mx-auto min-w-0 w-full max-w-5xl">
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
              ) : reviewPlan ? (
                <ReviewPlanCard
                  onBuildLocally={() => buildPlanLocally(reviewPlan)}
                  onDismiss={() => setReviewPlan(undefined)}
                  onOpen={() => onPlanUpdated(reviewPlan)}
                  plan={reviewPlan}
                />
              ) : null}
              {workingStats && workingStats.fileCount > 0 ? (
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
                mode={composerMode}
                model={paneModel}
                models={models}
                {...(contextUsage ? { contextUsage } : {})}
                onAbort={() => void abortPrompt()}
                onContextChange={setContextItems}
                onModeChange={setComposerMode}
                onModelChange={(next) => void changeModel(next)}
                onModelConfigChange={onModelConfigChange}
                onSubmit={(message, context, delivery, attachments, skills, mode) =>
                  submitPrompt(message, context, delivery, attachments, skills, mode)
                }
                sessionId={sessionId}
                workspaceId={workspace?.id}
              />
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
  viewportRef,
}: {
  children: ReactNode;
  onScroll(event: UIEvent<HTMLDivElement>): void;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className="scroll-thin min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-clip overscroll-contain [scrollbar-gutter:stable_both-edges]"
      onScroll={onScroll}
      ref={viewportRef}
    >
      <div className="flex min-h-full min-w-0 w-full max-w-full flex-col">{children}</div>
    </div>
  );
}

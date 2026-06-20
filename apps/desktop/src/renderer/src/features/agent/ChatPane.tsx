import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  SkillSelection,
  WorkingChangeStats,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { CollapsibleMotionProvider } from "../../components/ui/CollapsibleMotion";
import { Composer } from "../composer/Composer";
import { buildPlanMessage, effectiveBuildStatus, normalizePlan } from "../plan/planState";
import { QuestionsCard } from "../plan/QuestionsCard";
import { ReviewPlanCard } from "../plan/ReviewPlanCard";
import { ApprovalPanel } from "./ApprovalPanel";
import {
  type AgentEventHub,
  type AgentEventItem,
  appendAgentEvents,
  foldAgentEvents,
} from "./agentEventHub";
import { ChangesStrip } from "./changes/ChangesStrip";
import { latestPendingPermissionRequest } from "./permissionRequests";
import { latestPendingQuestionRequest } from "./questionRequests";
import { RetryStatusBar } from "./RetryStatusBar";
import { latestSessionStatus } from "./runState";
import { Timeline } from "./Timeline";
import { useAutoScroll } from "./useAutoScroll";

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
  onModelConfigChange(model: string, thinkingVariant: string): Promise<void> | void;
  /** "Review" on the changes strip: focus this pane and open the diff panel. */
  onOpenReview(): void;
  /** A plan was (re)written in Plan Mode: open it in the file panel. */
  onPlanUpdated(plan: PlanRef): void;
};

export type ChatPaneHandle = { buildActivePlan(): void };

export const ChatPane = forwardRef<ChatPaneHandle, ChatPaneProps>(function ChatPane(
  {
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
  },
  ref,
) {
  const sessionId = session.id;
  const [agentEvents, setAgentEvents] = useState<AgentEventItem[]>([]);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [promptError, setPromptError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [workingStats, setWorkingStats] = useState<WorkingChangeStats | undefined>();
  const [dismissedPlanHash, setDismissedPlanHash] = useState<string | undefined>(undefined);
  const [composerMode, setComposerMode] = useState<AgentMode>("build");

  const queuedRef = useRef<AgentEventItem[]>([]);
  const flushTimerRef = useRef<number | undefined>(undefined);
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

  // The latest plan written/updated in this session. Surfaced to the Plan panel
  // (data) on every change; the panel auto-opens only on a new plan (App gates
  // on hash). Build-status transitions re-emit plan.updated with the same hash.
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

  // The Plan panel (rendered in the Inspector, outside this pane) triggers a
  // build through this handle, so it runs the SAME path as the Review card.
  // No dep array: the handle stays fresh (always builds the current latestPlan
  // with the current model/mode) without stale-closure risk.
  useImperativeHandle(ref, () => ({
    buildActivePlan() {
      if (latestPlan) {
        buildPlanLocally(latestPlan);
      }
    },
  }));

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
        setAgentEvents(foldAgentEvents(items));
        // Land at the latest message when opening a session. Idle sessions
        // never auto-follow, so this initial pin is explicit.
        requestAnimationFrame(() => autoScroll.resume());
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

  /* ── Conversation actions ──────────────────────────────────────────── */

  const paneModel = session.model ?? defaultModel;
  const activeCwd = session.cwd;
  const retryStatus = sessionStatus.type === "retry" ? sessionStatus : undefined;
  // The Review card shows only while the plan is unbuilt and not dismissed.
  // Reading the plan's authoritative build status (not a remembered hash) is
  // what stops the card from re-appearing after a build on session re-open.
  const reviewPlan =
    latestPlan &&
    latestPlan.hash !== dismissedPlanHash &&
    effectiveBuildStatus(latestPlan, sessionStatus.type !== "idle") === "not_built"
      ? latestPlan
      : undefined;
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
    // currently shows + its provider-facing thinking variant. The runtime applies them at turn
    // start, so the turn is self-describing — no stale model/thinking/mode after
    // a mid-session switch, edit-and-resend, or resume.
    const turnModel = models.find((item) => item.id === paneModel);
    const turnThinking = turnModel?.thinkingVariant ?? turnModel?.thinkingLevel;
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
        ...(turnThinking ? { thinkingVariant: turnThinking } : {}),
        ...(planId ? { planId } : {}),
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

      <CollapsibleMotionProvider>
        <ChatViewport
          contentRef={autoScroll.contentRef}
          onScroll={autoScroll.handleScroll}
          scrollRef={autoScroll.scrollRef}
        >
          <Timeline
            agentEvents={agentEvents}
            cwd={activeCwd}
            onEditResend={editAndResend}
            onRestoreCheckpoint={async (checkpointId) => {
              await window.modus.checkpoint.restore({ checkpointId });
              refreshStats();
            }}
            workspaceId={workspace?.id}
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
                  onDismiss={() => setDismissedPlanHash(reviewPlan.hash)}
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
              {retryStatus ? <RetryStatusBar status={retryStatus} /> : null}
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
});

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
    <div
      className="scroll-thin min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-clip overscroll-contain [scrollbar-gutter:stable_both-edges]"
      onScroll={onScroll}
      ref={scrollRef}
    >
      <div className="flex min-h-full min-w-0 w-full max-w-full flex-col" ref={contentRef}>
        {children}
      </div>
    </div>
  );
}

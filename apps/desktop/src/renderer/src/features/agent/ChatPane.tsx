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
  AgentSessionInfo,
  BrowserEvent,
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
import { CollapsibleMotionProvider } from "../../components/ui/CollapsibleMotion";
import { Composer } from "../composer/Composer";
import { ApprovalPanel } from "./ApprovalPanel";
import { type AgentEventHub, type AgentEventItem, appendAgentEvents } from "./agentEventHub";
import { ChangesStrip } from "./changes/ChangesStrip";
import { latestPendingPermissionRequest } from "./permissionRequests";
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
}: ChatPaneProps) {
  const sessionId = session.id;
  const [agentEvents, setAgentEvents] = useState<AgentEventItem[]>([]);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [promptError, setPromptError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [workingStats, setWorkingStats] = useState<WorkingChangeStats | undefined>();

  const queuedRef = useRef<AgentEventItem[]>([]);
  const flushTimerRef = useRef<number | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);
  const scrollFollowPauseTimerRef = useRef<number | undefined>(undefined);
  const statsTimerRef = useRef<number | undefined>(undefined);
  const statsCwdRef = useRef(session.cwd);
  statsCwdRef.current = session.cwd;

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
    void window.modus.agent
      .prompt({
        context: leanContext,
        delivery,
        sessionId,
        message,
        userMessageId: `local-user:${crypto.randomUUID()}`,
        ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
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
    setPromptError(undefined);
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
          {workingStats ? (
            <ChangesStrip
              onOpenFile={(path) =>
                void window.modus.file.open({ cwd: activeCwd, path }).catch(() => {})
              }
              onReview={onOpenReview}
              stats={workingStats}
            />
          ) : null}
          {pendingPermission ? (
            <ApprovalPanel
              key={pendingPermission.id}
              onDecide={(request, decision) => decidePermission(request, decision)}
              request={pendingPermission}
            />
          ) : (
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
              sessionId={sessionId}
              workspaceId={workspace?.id}
            />
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

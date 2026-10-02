import { IconArrowDown } from "@tabler/icons-react";
import { m } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSessionInfo,
  ContextItem,
  ContextUsageInfo,
  ModelInfo,
  PromptDelivery,
  PromptImageAttachment,
  SkillSelection,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { Composer } from "../composer/Composer";
import {
  type ChatComposerDraft,
  type ChatComposerDraftUpdate,
  createEmptyChatComposerDraft,
} from "../composer/chatComposerDraft";
import {
  type ComposerDraftUpdate,
  resolveDraftUpdate,
  restoreQueuedDraft,
} from "../composer/composerDraft";
import {
  type AgentEventHub,
  type AgentEventItem,
  appendAgentEvents,
  foldAgentEvents,
  optimisticUserPromptEvents,
} from "./agentEventHub";
import { ConversationTimeline } from "./ConversationTimeline";
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
  onSessionsChanged(): void;
  onModelChange(model: string): void;
  onModelConfigChange(model: string, thinkingVariant: string): Promise<void> | void;

  composerReplacement?: ReactNode;
  composerDraft?: ChatComposerDraft | undefined;
  onComposerDraftChange?(update: ChatComposerDraftUpdate): void;

  /** Open a workspace file in the Files inspector panel. */
  onOpenFile?(path: string): void;
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
  composerReplacement,
  composerDraft,
  onComposerDraftChange,
  onOpenFile,
}: ChatPaneProps) {
  const sessionId = session.id;
  const [agentEvents, setAgentEvents] = useState<AgentEventItem[]>(initialEvents ?? []);
  const initialPrompt = initialEvents?.find(
    (item) =>
      item.optimistic && item.event.type === "message.started" && item.event.role === "user",
  );
  const [enteringMessageId, setEnteringMessageId] = useState<string | undefined>(
    initialPrompt?.event.type === "message.started" ? initialPrompt.event.messageId : undefined,
  );
  const completeMessageEntry = useCallback((messageId: string): void => {
    setEnteringMessageId((current) => (current === messageId ? undefined : current));
  }, []);
  const historyInput = useRef({ initialEvents, onInitialEventsConsumed });
  historyInput.current = { initialEvents, onInitialEventsConsumed };
  const loadedSessionRef = useRef<string | undefined>(undefined);
  const [localComposerDraft, setLocalComposerDraft] = useState<ChatComposerDraft>(
    createEmptyChatComposerDraft,
  );
  const [promptError, setPromptError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState(Boolean(initialPrompt));
  const [aborting, setAborting] = useState(false);

  const activeComposerDraft = composerDraft ?? localComposerDraft;
  const contextItems = activeComposerDraft.contextItems;
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

  const queuedRef = useRef<AgentEventItem[]>([]);
  /** Pending frame-clock flush handle (requestAnimationFrame id). */
  const flushFrameRef = useRef<number | undefined>(undefined);
  const sessionStatus = useMemo(() => latestSessionStatus(agentEvents), [agentEvents]);
  const isRunning = aborting || sessionStatus.type !== "idle" || pendingPrompt;
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

  const resumeScroll = autoScroll.resume;
  useEffect(() => {
    const { initialEvents, onInitialEventsConsumed } = historyInput.current;
    const initialPrompt = initialEvents?.find(
      (item) =>
        item.optimistic && item.event.type === "message.started" && item.event.role === "user",
    );
    let cancelled = false;
    if (loadedSessionRef.current !== sessionId) {
      setAgentEvents(initialEvents ?? []);
      setEnteringMessageId(
        initialPrompt?.event.type === "message.started" ? initialPrompt.event.messageId : undefined,
      );
    }
    if (initialEvents?.length) onInitialEventsConsumed?.(sessionId);
    setPromptError(undefined);
    setPendingPrompt(Boolean(initialPrompt));
    setAborting(false);
    const unsubscribe = hub.subscribe(sessionId, (item) => {
      const event = item.event;
      if (event.type === "context.updated") return;
      queuedRef.current.push(item);
      if (flushFrameRef.current === undefined) {
        flushFrameRef.current = requestAnimationFrame(flushQueued);
      }
      if (event.type === "session.status") {
        setPendingPrompt(false);
        if (event.status.type === "idle") setAborting(false);
      }
    });
    void (async () => {
      try {
        let items = await window.modus.agent.listEvents(sessionId);
        if (queuedRef.current.length > 0) {
          queuedRef.current = [];
          items = await window.modus.agent.listEvents(sessionId);
          queuedRef.current = [];
        }
        if (!cancelled) {
          setAgentEvents(foldAgentEvents([...(initialEvents ?? []), ...items]));
          if (loadedSessionRef.current !== sessionId) {
            requestAnimationFrame(() => resumeScroll());
            loadedSessionRef.current = sessionId;
          }
        }
      } catch (error) {
        if (!cancelled) {
          setPendingPrompt(false);
          setPromptError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
      clearQueued();
    };
  }, [sessionId, hub, flushQueued, clearQueued, resumeScroll]);

  /* ── Conversation actions ──────────────────────────────────────────── */

  const paneModel = session.model ?? defaultModel;
  const activeCwd = session.cwd;

  function submitPrompt(
    message: string,
    context: ContextItem[],
    delivery: PromptDelivery = "normal",
    attachments?: PromptImageAttachment[],
    skills?: SkillSelection[],
  ): void {
    if (!message.trim() && !attachments?.length) {
      return;
    }
    autoScroll.resume();
    setPromptError(undefined);
    setPendingPrompt(true);
    const mergedAttachments = attachments ?? [];
    const paths = context.map((item) => item.path);
    const turnModel = models.find((item) => item.id === paneModel);
    const turnThinking = turnModel?.thinkingVariant ?? turnModel?.thinkingLevel;
    const userMessageId = `local-user:${crypto.randomUUID()}`;
    setEnteringMessageId(userMessageId);
    setAgentEvents((events) =>
      appendAgentEvents(
        events,
        optimisticUserPromptEvents({
          sessionId,
          userMessageId,
          message,
          ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
          ...(skills && skills.length > 0 ? { skills } : {}),
          ...(context.length > 0 ? { contextItems: context } : {}),
        }),
      ),
    );
    void window.modus.agent
      .prompt({
        paths,
        delivery,
        sessionId,
        message,
        userMessageId,
        ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
        ...(paneModel ? { model: paneModel } : {}),
        ...(turnThinking ? { thinkingVariant: turnThinking } : {}),
      })
      .then(() => onSessionsChanged())
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setPendingPrompt(false);
        setAgentEvents((events) => {
          const anchor = events.findIndex(
            (item) =>
              item.event.type === "message.started" && item.event.messageId === userMessageId,
          );
          if (
            events
              .slice(anchor)
              .some(
                (item) => item.event.type === "run.failed" || item.event.type === "runtime.error",
              )
          )
            return events;
          return appendAgentEvents(events, [
            {
              id: `local:${Date.now()}:${crypto.randomUUID()}:error`,
              event: { type: "runtime.error", sessionId, message: errorMessage },
              createdAt: new Date().toISOString(),
            },
          ]);
        });
      });
  }

  async function abortPrompt(): Promise<void> {
    if (aborting) {
      return;
    }
    setPromptError(undefined);
    setAborting(true);
    try {
      const queued = await window.modus.agent.abort(sessionId);
      if (queued.length > 0) setComposerFields((draft) => restoreQueuedDraft(draft, queued));
      onSessionsChanged();
    } catch (error) {
      setAborting(false);
      setPromptError(error instanceof Error ? error.message : String(error));
    }
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
    await window.modus.agent.navigate({ sessionId, userMessageId: messageId });
    clearQueued();
    setAgentEvents(await window.modus.agent.listEvents(sessionId));
    onSessionsChanged();
    submitPrompt(message, contextItems ?? [], "normal", attachments, skills);
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
            enteringMessageId={enteringMessageId}
            onMessageEntered={completeMessageEntry}
            preparing={
              isRunning &&
              !visibleBlocks.some(
                (block) => block.type === "work-fold" && block.run.status === "running",
              )
            }
            cwd={activeCwd}
            model={paneModel}
            models={models}
            onEditResend={editAndResend}
            {...(onOpenFile ? { onOpenFile } : {})}
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
          {composerReplacement ?? (
            <Composer
              sessionId={sessionId}
              canSubmit={Boolean(workspace) && Boolean(paneModel)}
              contextItems={contextItems}
              cwd={activeCwd}
              draft={activeComposerDraft}
              isRunning={isRunning}
              model={paneModel}
              models={models}
              {...(contextUsage ? { contextUsage } : {})}
              onAbort={() => void abortPrompt()}
              stopping={aborting}
              onCompact={() => window.modus.agent.compact(sessionId)}
              onContextChange={setContextItems}
              onDraftChange={setComposerFields}
              onModelChange={(next) => void changeModel(next)}
              onModelConfigChange={onModelConfigChange}
              onSubmit={submitPrompt}
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

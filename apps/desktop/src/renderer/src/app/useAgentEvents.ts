import { useEffect, useRef, useState } from "react";
import type { AgentEvent, ContextUsageInfo, QuestionRequest } from "../../../shared/contracts";
import {
  AgentEventHub,
  affectsActivity,
  reduceActivity,
  type SessionActivity,
} from "../features/agent/agentEventHub";

export function useAgentEvents(
  watchedSessionId: string | undefined,
  refreshSessions: () => Promise<void>,
  setActiveSessionId: (id: string) => void,
  updateSessionTitle: (sessionId: string, title: string) => void,
  watching = true,
) {
  const [notice, setNotice] = useState<Extract<AgentEvent, { type: "extension.notice" }>>();
  const [restoreError, setRestoreError] = useState<string>();
  const [extensionQuestions, setExtensionQuestions] = useState<QuestionRequest[]>([]);
  const [activityBySession, setActivityBySession] = useState<Record<string, SessionActivity>>({});
  const [contextUsageBySession, setContextUsageBySession] = useState<
    Record<string, ContextUsageInfo>
  >({});
  const hubRef = useRef(new AgentEventHub());
  const activeSessionIdRef = useRef(watchedSessionId);
  const activeSessionId = watchedSessionId;
  useEffect(() => {
    activeSessionIdRef.current = watchedSessionId;
  }, [watchedSessionId]);
  function publishLocalAgentEvent(event: AgentEvent): void {
    hubRef.current.publish({
      id: `local:${Date.now()}:${crypto.randomUUID()}`,
      event,
      createdAt: new Date().toISOString(),
    });
  }

  /* ── Global event intake: one IPC listener feeds the active chat + sidebar ── */
  useEffect(() => {
    if (!window.modus) {
      return;
    }

    const unsubscribe = window.modus.agent.onEvent((event: AgentEvent) => {
      if (event.type === "extension.notice") {
        setNotice(event);
        return;
      }
      if (event.type === "question.requested" && event.request.presentation === "dialog") {
        setExtensionQuestions((current) => [...current, event.request]);
      } else if (event.type === "question.resolved") {
        setExtensionQuestions((current) =>
          current.filter((request) => request.id !== event.requestId),
        );
      }
      if (event.type === "context.updated") {
        setContextUsageBySession((current) => ({
          ...current,
          [event.sessionId]: event.usage,
        }));
        return;
      }
      if (
        event.type === "session.status" &&
        event.status.type === "idle" &&
        activeSessionIdRef.current !== event.sessionId
      ) {
        void window.modus.agent.releaseRuntime(event.sessionId).catch(console.error);
      }

      hubRef.current.publish({
        id: `${Date.now()}:${crypto.randomUUID()}`,
        event,
        createdAt: new Date().toISOString(),
      });

      if (affectsActivity(event)) {
        const watched = activeSessionIdRef.current === event.sessionId;
        setActivityBySession((current) => {
          const next = reduceActivity(current[event.sessionId], event, watched);
          if (next === current[event.sessionId]) {
            return current;
          }
          return { ...current, [event.sessionId]: next };
        });
      }

      if (
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled" ||
        event.type === "run.blocked" ||
        event.type === "session.updated"
      ) {
        if (event.type === "session.updated") updateSessionTitle(event.sessionId, event.title);
        void refreshSessions();
      }
    });

    // System notification click → surface that session in the chat view.
    const unsubscribeFocus = window.modus.agent.onFocusSession((sessionId: string) => {
      setActiveSessionId(sessionId);
    });

    return () => {
      unsubscribe();
      unsubscribeFocus();
    };
  }, [refreshSessions, setActiveSessionId, updateSessionTitle]);

  useEffect(() => {
    if (!activeSessionId) return;
    let active = true;
    setRestoreError(undefined);
    void window.modus.agent
      .ensure(activeSessionId)
      .then((snapshot) => {
        if (active && snapshot.contextUsage) {
          const usage = snapshot.contextUsage;
          setContextUsageBySession((current) => ({ ...current, [activeSessionId]: usage }));
        }
      })
      .catch((cause: unknown) => {
        if (active) setRestoreError(String(cause));
      });
    return () => {
      active = false;
      void window.modus.agent.releaseRuntime(activeSessionId).catch(console.error);
    };
  }, [activeSessionId]);

  // The open session is "watched": its unread flag clears.
  useEffect(() => {
    if (!activeSessionId || !watching) {
      return;
    }
    setActivityBySession((current) => {
      const activity = current[activeSessionId];
      if (!activity?.unread) {
        return current;
      }
      return { ...current, [activeSessionId]: { ...activity, unread: false } };
    });
  }, [activeSessionId, watching]);

  return {
    notice: notice?.sessionId === activeSessionId ? notice : undefined,
    dismissNotice: () => setNotice(undefined),
    restoreError,
    hubRef,
    extensionQuestions,
    activityBySession,
    contextUsageBySession,
    publishLocalAgentEvent,
  };
}

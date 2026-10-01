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
) {
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
        event.type === "agent.started" ||
        event.type === "agent.ended" ||
        event.type === "message.completed" ||
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled" ||
        event.type === "run.blocked" ||
        event.type === "session.updated" ||
        event.type === "subagent.started" ||
        // Activity-only subagent.updated (writing/thinking/tool) must NOT list
        // sessions — that re-rendered the whole app on every child token.
        (event.type === "subagent.updated" &&
          (event.status === "completed" ||
            event.status === "failed" ||
            event.status === "cancelled" ||
            event.status === "blocked"))
      ) {
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
  }, [refreshSessions, setActiveSessionId]);

  // The open session is "watched": its unread flag clears.
  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    setActivityBySession((current) => {
      const activity = current[activeSessionId];
      if (!activity?.unread) {
        return current;
      }
      return { ...current, [activeSessionId]: { ...activity, unread: false } };
    });
  }, [activeSessionId]);

  return {
    hubRef,
    extensionQuestions,
    activityBySession,
    contextUsageBySession,
    publishLocalAgentEvent,
  };
}

import {
  type AgentEventItem,
  appendAgentEvents,
  foldAgentEvents,
  optimisticUserPromptEvents,
} from "../../../../shared/agent-events";
import type { AgentEvent } from "../../../../shared/contracts";

/**
 * Multi-session event plumbing.
 *
 * The app keeps ONE `agent.onEvent` IPC listener; every event is pushed
 * through this hub, which (a) fans the full stream out to the ChatPane for the
 * active session and (b) folds a tiny per-session activity
 * summary (running / needs-input / unread / failed) that powers the sidebar
 * status indicators.
 *
 * Delta accumulation lives in `shared/agent-events` (re-exported here) so the
 * renderer and the main-process event store fold identically.
 */

export { type AgentEventItem, appendAgentEvents, foldAgentEvents, optimisticUserPromptEvents };

export type SessionActivity = {
  /** A run is currently executing. */
  running: boolean;
  /** A permission request is waiting for the user. */
  needsInput: boolean;
  /** A run finished while the session had no open pane. */
  unread: boolean;
  /** The most recent run ended in failure. */
  failed: boolean;
};

export const IDLE_ACTIVITY: SessionActivity = {
  running: false,
  needsInput: false,
  unread: false,
  failed: false,
};

/**
 * Fold one event into a session's activity summary. `watched` marks sessions
 * that are visible in an open pane — their completions never count as unread.
 * Returns the SAME reference when nothing changed so React state updates can
 * bail out cheaply during token streams.
 */
export function reduceActivity(
  current: SessionActivity | undefined,
  event: AgentEvent,
  watched: boolean,
): SessionActivity {
  const activity = current ?? IDLE_ACTIVITY;
  switch (event.type) {
    case "run.started":
      return { running: true, needsInput: false, unread: false, failed: false };
    case "permission.requested":
      return { ...activity, needsInput: true, unread: watched ? activity.unread : true };
    case "permission.resolved":
      return activity.needsInput ? { ...activity, needsInput: false } : activity;
    case "run.completed":
      return {
        running: false,
        needsInput: false,
        unread: !watched,
        failed: false,
      };
    case "run.failed":
      return {
        running: false,
        needsInput: false,
        unread: !watched,
        failed: true,
      };
    case "run.cancelled":
    case "run.blocked":
      return { ...activity, running: false, needsInput: false };
    default:
      return activity;
  }
}

/** True when the event should trigger an activity re-render at all. */
export function affectsActivity(event: AgentEvent): boolean {
  switch (event.type) {
    case "run.started":
    case "run.completed":
    case "run.failed":
    case "run.cancelled":
    case "run.blocked":
    case "permission.requested":
    case "permission.resolved":
      return true;
    default:
      return false;
  }
}

type Subscriber = (item: AgentEventItem) => void;

/**
 * Per-session fanout. Multiple panes may subscribe to the same session (the
 * same conversation opened twice stays in sync because both receive the
 * stream); sessions without subscribers cost a single Map lookup per event.
 */
export class AgentEventHub {
  private subscribers = new Map<string, Set<Subscriber>>();
  private prepared = new Map<string, AgentEventItem[]>();

  prepare(sessionId: string): void {
    if (!this.subscribers.has(sessionId) && !this.prepared.has(sessionId)) {
      this.prepared.set(sessionId, []);
    }
  }

  cancelPrepare(sessionId: string): void {
    this.prepared.delete(sessionId);
  }

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    const set = this.subscribers.get(sessionId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(sessionId, set);
    const prepared = this.prepared.get(sessionId);
    this.prepared.delete(sessionId);
    for (const item of prepared ?? []) {
      subscriber(item);
    }
    return () => {
      set.delete(subscriber);
      if (set.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  publish(item: AgentEventItem): void {
    const set = this.subscribers.get(item.event.sessionId);
    if (!set) {
      this.prepared.get(item.event.sessionId)?.push(item);
      return;
    }
    for (const subscriber of set) {
      subscriber(item);
    }
  }

  hasSubscribers(sessionId: string): boolean {
    return (this.subscribers.get(sessionId)?.size ?? 0) > 0;
  }
}

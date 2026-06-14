import type { AgentEvent } from "../../../../shared/contracts";

/**
 * Run-lifecycle is the single source of truth for "is this run active". These
 * helpers are pure so the composer's running state (border + input lock) and
 * any list/refresh logic derive from one tested definition instead of ad-hoc,
 * drift-prone inline checks.
 *
 * Crucially, `runtime.error` is NOT terminal. It is an informational, often
 * recoverable notice — a transient request error, an auto-retry, or a mid-run
 * model error — emitted while the run keeps going (pi retries internally). The
 * run only ends when a settling event below is emitted (the backend always
 * emits exactly one). Treating `runtime.error` as terminal is what unlocked the
 * composer and dropped the streaming border while the agent was still working.
 */
export const TERMINAL_RUN_EVENT_TYPES = [
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const satisfies readonly AgentEvent["type"][];

type TerminalRunEventType = (typeof TERMINAL_RUN_EVENT_TYPES)[number];

/** A run-lifecycle event that ends the run (so the optimistic flags clear). */
export function isTerminalRunEvent(event: AgentEvent): boolean {
  return (TERMINAL_RUN_EVENT_TYPES as readonly string[]).includes(event.type);
}

/**
 * Whether the most recent run is still active, derived purely from the run
 * lifecycle. A run becomes active at `run.started` and stays active (including
 * while `run.blocked`, i.e. awaiting permission) until a settling event. Scans
 * newest-first and returns at the first lifecycle event it meets; anything
 * else (messages, tools, `runtime.error`) is ignored.
 */
export function isRunActive(events: Array<{ event: AgentEvent }>): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = events[index]?.event.type;
    if (type === undefined) {
      continue;
    }
    if (type === "run.started" || type === "run.blocked") {
      return true;
    }
    if ((TERMINAL_RUN_EVENT_TYPES as readonly string[]).includes(type)) {
      return false;
    }
  }
  return false;
}

export type { TerminalRunEventType };

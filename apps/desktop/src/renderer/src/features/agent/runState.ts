import type { AgentEvent, SessionRunStatus } from "../../../../shared/contracts";

/**
 * The composer's lock + streaming border follow ONE authoritative fact: the
 * session's run-status, which the runtime publishes as `session.status` events
 * derived from pi's real streaming turn and its internal auto-retry.
 *
 * This deliberately replaces the old "scan the run-event log to guess if a run
 * is active" approach. That guess was fragile: a queued steer/follow-up message
 * used to open its own run and immediately settle it, dropping a phantom
 * terminal event into the log that unlocked the composer while the real turn
 * kept streaming. Reading the runtime's explicit status removes the guess
 * entirely — there is nothing to re-derive.
 */

export const IDLE_STATUS: SessionRunStatus = { type: "idle" };

/**
 * The latest run-status for the session, read newest-first from the recorded
 * `session.status` events. Defaults to idle when none has been seen yet. The
 * composer is locked whenever this is not idle (busy OR auto-retrying), so a
 * transient error never unlocks input mid-turn.
 */
export function latestSessionStatus(events: Array<{ event: AgentEvent }>): SessionRunStatus {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]?.event;
    if (event?.type === "session.status") {
      return event.status;
    }
  }
  return IDLE_STATUS;
}

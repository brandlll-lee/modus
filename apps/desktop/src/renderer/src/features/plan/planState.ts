import type { PlanBuildStatus, PlanRef } from "../../../../shared/contracts";

/**
 * The concise build instruction sent when the user authorizes building a plan
 * (from the Review card or the Plan panel). Points the agent at the full
 * plan.md as the source of truth + lists the to-dos — never pastes the whole
 * body. Shared so both build entry points stay byte-identical.
 */
export function buildPlanMessage(plan: PlanRef): string {
  const todoLines = plan.todos.map((todo, index) => `${index + 1}. ${todo.content}`).join("\n");
  return [
    `Build the approved plan "${plan.title}". Read the full plan at ${plan.path} as the single`,
    "source of truth, then implement it end-to-end and verify against its acceptance criteria",
    "before reporting done.",
    "",
    "To-dos:",
    todoLines,
  ].join("\n");
}

/**
 * Fill fields that plans/events written before `overview`/`todos`/`buildStatus`
 * existed are missing, so the rest of the UI can rely on the current PlanRef
 * contract. Mirrors the store's defaults; returns the same reference when the
 * plan is already complete (the common, new-plan case) so memo identity holds.
 */
export function normalizePlan(plan: PlanRef): PlanRef {
  if (plan.todos !== undefined && plan.buildStatus !== undefined && plan.overview !== undefined) {
    return plan;
  }
  return {
    ...plan,
    overview: plan.overview ?? "",
    todos: plan.todos ?? [],
    buildStatus: plan.buildStatus ?? "not_built",
  };
}

/**
 * The build status to act on, reconciling the plan's PERSISTED status against
 * the session's LIVE working state. A persisted `building` only makes sense
 * while the build turn is actually running; if the session is idle (the turn
 * was interrupted by a crash/disconnect that never emitted a terminal event),
 * `building` is stale and resolves to `not_built` so the plan can be built
 * again. Both inputs are authoritative facts, so this is reconciliation, not a
 * guess.
 */
export function effectiveBuildStatus(plan: PlanRef, sessionWorking: boolean): PlanBuildStatus {
  if (plan.buildStatus === "building" && !sessionWorking) {
    return "not_built";
  }
  return plan.buildStatus;
}

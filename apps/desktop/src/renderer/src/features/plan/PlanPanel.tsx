import { IconCircleCheck, IconCircleDashed, IconLayoutList } from "@tabler/icons-react";
import type { PlanBuildStatus, PlanRef } from "../../../../shared/contracts";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";
import { MarkdownMessage } from "../agent/MarkdownMessage";
import { effectiveBuildStatus } from "./planState";

/**
 * Dedicated Plan panel (Cursor parity). Renders the plan's rich Markdown body,
 * its to-do checklist, and — top-right — a live build-status badge driven by the
 * plan's authoritative `buildStatus` reconciled against the session's live
 * working state. Lives in its own Inspector tab, not the file tree.
 */
export function PlanPanel({
  plan,
  sessionWorking,
  onBuild,
}: {
  plan: PlanRef | undefined;
  sessionWorking: boolean;
  onBuild: () => void;
}) {
  if (!plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <IconLayoutList className="text-fg-faint/55" size={30} stroke={1.4} />
        <div className="font-medium text-fg-subtle text-sm">No plan yet</div>
        <div className="text-fg-faint text-xs">Plan Mode writes a plan here for you to review.</div>
      </div>
    );
  }

  const status = effectiveBuildStatus(plan, sessionWorking);
  const done = plan.todos.filter((todo) => todo.status === "completed").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-hairline border-b pr-2 pl-3">
        <span className="min-w-0 flex-1 truncate font-medium text-fg text-sm" title={plan.title}>
          {plan.title}
        </span>
        {status === "not_built" ? (
          <button
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-build px-2.5 font-medium text-[12px] text-build-fg transition-colors hover:bg-build-hover"
            onClick={onBuild}
            type="button"
          >
            Build
          </button>
        ) : (
          <BuildStatusBadge status={status} />
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MarkdownMessage content={plan.content} />

        {plan.todos.length > 0 ? (
          <section className="mt-4 overflow-hidden rounded-lg border border-hairline-soft bg-panel">
            <div className="flex h-9 items-center gap-2 border-hairline-soft border-b px-3 text-fg-muted text-sm">
              <IconLayoutList className="shrink-0 text-fg-subtle" size={14} stroke={1.7} />
              {done > 0
                ? `${done} of ${plan.todos.length} To-dos Completed`
                : `${plan.todos.length} To-dos`}
            </div>
            <ul className="px-3 py-2">
              {plan.todos.map((todo) => {
                const completed = todo.status === "completed";
                const Glyph = completed ? IconCircleCheck : IconCircleDashed;
                return (
                  <li className="flex items-start gap-2.5 py-1.5" key={todo.id}>
                    <Glyph
                      className={cn(
                        "mt-0.5 shrink-0",
                        completed ? "text-fg-faint" : "text-fg-subtle",
                      )}
                      size={15}
                      stroke={1.7}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-sm leading-snug",
                        completed ? "text-fg-subtle line-through decoration-fg-faint" : "text-fg",
                      )}
                    >
                      {todo.content}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Top-right pill mirroring Cursor's "Not built / Building… / Built" state. */
function BuildStatusBadge({ status }: { status: PlanBuildStatus }) {
  if (status === "building") {
    return (
      <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-chip px-2 text-fg-muted text-xs">
        <IconCircleDashed size={13} stroke={2} />
        <ShinyText>Building…</ShinyText>
      </span>
    );
  }
  if (status === "built") {
    return (
      <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-success/15 px-2 text-success text-xs">
        <IconCircleCheck size={13} stroke={1.9} />
        Built
      </span>
    );
  }
  return (
    <span className="flex h-6 shrink-0 items-center rounded-md bg-chip px-2 text-fg-subtle text-xs">
      Not built
    </span>
  );
}

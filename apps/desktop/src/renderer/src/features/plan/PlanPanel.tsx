import { IconLayoutList } from "@tabler/icons-react";
import { memo } from "react";
import type { PlanRef } from "../../../../shared/contracts";
import { EmptyState } from "../../components/ui/Panel";
import { MarkdownMessage } from "../agent/MarkdownMessage";
import { VisualToolCard } from "../agent/VisualToolCard";

/** Read-only Plan document shown in the Inspector. */
export const PlanPanel = memo(function PlanPanel({ plan }: { plan: PlanRef | undefined }) {
  if (!plan) {
    return (
      <EmptyState
        description="Plan Mode writes a plan here for you to review."
        hint="No plan yet"
        icon={<IconLayoutList size={22} stroke={1.4} />}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center border-hairline border-b px-[clamp(1.5rem,6%,4rem)]">
        <div className="mx-auto flex w-full max-w-[920px] items-center">
          <span className="min-w-0 flex-1 truncate font-medium text-fg text-sm" title={plan.title}>
            {plan.title}
          </span>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[clamp(1.5rem,6%,4rem)] py-7">
        <div className="mx-auto w-full max-w-[920px] space-y-8">
          <h1 className="mx-auto w-full max-w-[760px] font-bold text-[2rem] text-fg leading-tight tracking-[-0.03em]">
            {plan.title}
          </h1>
          {plan.blocks.map((block) =>
            block.type === "markdown" ? (
              <div
                className="mx-auto w-full max-w-[760px]"
                key={`${plan.hash}:markdown:${block.content}`}
              >
                <MarkdownMessage className="modus-plan-markdown" content={block.content} />
              </div>
            ) : (
              <div className="w-full" key={`${plan.hash}:visual:${block.title}:${block.content}`}>
                <VisualToolCard args={block} isComplete />
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
});

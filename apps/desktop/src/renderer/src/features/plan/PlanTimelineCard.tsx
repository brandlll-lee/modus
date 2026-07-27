import { IconArrowsMaximize, IconListCheck } from "@tabler/icons-react";
import type { PlanRef } from "../../../../shared/contracts";
import { CopyButton } from "../../components/ui/CopyButton";
import { ShinyText } from "../../components/ui/ShinyText";
import { MarkdownMessage } from "../agent/MarkdownMessage";

function textArg(args: unknown, key: string): string {
  if (!args || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function previewArg(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const blocks = (args as Record<string, unknown>).blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const value = block as Record<string, unknown>;
      if (value.type === "markdown") return typeof value.content === "string" ? value.content : "";
      if (value.type !== "visual") return "";
      const title = typeof value.title === "string" ? `### ${value.title}` : "";
      const fallback = typeof value.fallback === "string" ? value.fallback : "";
      return [title, fallback].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function PlanTimelineCard({
  args,
  isComplete,
  isError,
  onOpen,
  plan,
}: {
  args?: unknown;
  isComplete: boolean;
  isError: boolean;
  onOpen?: (plan: PlanRef) => void;
  plan?: PlanRef;
}) {
  const title = plan?.title ?? textArg(args, "title");
  const overview = plan?.overview ?? textArg(args, "overview");
  const content = plan?.content ?? previewArg(args);
  const preview = content || overview;
  const ready = isComplete && !isError && plan !== undefined;

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-hairline-soft bg-card px-4 py-3.5">
      <header className="flex min-h-6 items-center gap-2 text-xs">
        <IconListCheck className="shrink-0 text-fg-faint" size={14} stroke={1.7} />
        {isComplete ? (
          <span className={isError ? "text-danger" : "text-fg-subtle"}>
            {isError ? "Plan failed" : "Plan"}
          </span>
        ) : (
          <ShinyText>Writing the plan</ShinyText>
        )}
        <span className="flex-1" />
        {ready ? (
          <div className="flex items-center gap-1">
            <CopyButton label="Copy plan" text={plan.content} />
            {onOpen ? (
              <button
                aria-label="Open plan"
                className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-muted"
                onClick={() => onOpen(plan)}
                title="Open plan"
                type="button"
              >
                <IconArrowsMaximize size={13} stroke={1.75} />
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <div
        className="mt-4 max-h-48 overflow-hidden"
        style={{
          WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)",
        }}
      >
        {title ? (
          <h2 className="mb-4 font-bold text-[1.75rem] text-fg leading-tight tracking-[-0.025em]">
            {title}
          </h2>
        ) : null}
        {preview ? (
          <MarkdownMessage
            className="modus-plan-markdown"
            content={preview}
            streaming={!isComplete}
          />
        ) : title ? null : (
          <div className="h-20" />
        )}
      </div>
    </article>
  );
}

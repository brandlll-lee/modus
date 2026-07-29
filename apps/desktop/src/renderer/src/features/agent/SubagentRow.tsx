import type { ModelInfo, SubagentStatus } from "../../../../shared/contracts";
import { VortexMark } from "../../components/ui/VortexMark";
import { cn } from "../../lib/cn";
import { lookupModel } from "../../lib/modelIdentity";
import { selectedThinkingLabel } from "../../lib/modelThinking";
import { ProviderLogo } from "../settings/ProviderLogo";

/**
 * Flat subagent row: Vortex while running, soft status dot when settled;
 * upper = task + model identity (inline, same line), lower = activity.
 * No card chrome.
 *
 * Model identity comes from the ModelInfo catalog (same source as the composer
 * picker) — never from string-massaging `provider/id`. The chip sits right after
 * the title (Cursor-style), not at the far edge of the row.
 */
export function SubagentRow({
  task,
  modelId,
  models,
  status,
  activityLabel,
  onClick,
  className,
}: {
  task: string;
  /** Catalog model id when known. Prefer this over dumping a raw provider/id. */
  modelId?: string | undefined;
  models?: ModelInfo[] | undefined;
  status: SubagentStatus;
  activityLabel: string;
  onClick?(): void;
  className?: string;
}) {
  const running = status === "running";
  const model = lookupModel(models, modelId);
  const thinking =
    model?.supportsThinking && model.thinkingLevel !== "off"
      ? selectedThinkingLabel(model)
      : undefined;

  return (
    <button
      className={cn(
        "flex min-w-0 w-full items-start gap-2.5 py-2.5 text-left transition-colors",
        className,
      )}
      onClick={onClick}
      type="button"
    >
      <span
        aria-label={running ? "Subagent running" : undefined}
        className="mt-1 flex size-5 shrink-0 items-center justify-center"
      >
        {running ? (
          <VortexMark className="size-4.5" />
        ) : (
          <SubagentSettledDot status={status} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="min-w-0 truncate text-sm text-fg leading-snug">{task}</span>
          {model ? (
            <span className="inline-flex min-w-0 shrink-0 items-center gap-1 text-xs text-fg-faint">
              <ProviderLogo
                framed={false}
                name={model.providerName ?? model.provider}
                provider={model.provider}
                size="sm"
              />
              <span className="max-w-[14rem] truncate">{model.name}</span>
              {thinking ? <span className="shrink-0">{thinking}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-2xs text-fg-faint leading-snug">
          {activityLabel}
        </span>
      </span>
    </button>
  );
}

/** Same soft indicators as the sidebar idle/failed dots — no ThinkingOrb / ModusBot. */
function SubagentSettledDot({ status }: { status: SubagentStatus }) {
  if (status === "failed") {
    return (
      <span
        className="size-2 shrink-0 rounded-full border border-danger bg-transparent"
        title="Subagent failed"
      />
    );
  }
  if (status === "blocked") {
    return (
      <span className="relative flex size-2 shrink-0" title="Needs input">
        <span className="absolute inset-0 animate-ping rounded-full bg-danger/50" />
        <span className="relative size-2 rounded-full bg-danger" />
      </span>
    );
  }
  return (
    <span
      className="size-2 shrink-0 rounded-full bg-fg-faint/35"
      title={status === "cancelled" ? "Stopped" : "Completed"}
    />
  );
}

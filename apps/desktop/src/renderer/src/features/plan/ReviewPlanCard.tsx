import { IconArrowRight, IconPencil, IconX } from "@tabler/icons-react";
import { useEffect } from "react";

export function ReviewPlanCard({
  onBuildLocally,
  onContinuePlanning,
}: {
  onBuildLocally: () => void;
  onContinuePlanning: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        onBuildLocally();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onBuildLocally]);

  return (
    <div className="rounded-xl border border-composer-border bg-elevated p-3 shadow-composer-edge">
      <div className="flex h-7 items-center gap-2 px-1">
        <span className="font-medium text-fg text-sm">Implement this plan?</span>
        <span className="flex-1" />
        <button
          aria-label="Dismiss plan"
          className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
          onClick={onContinuePlanning}
          type="button"
        >
          <IconX size={15} stroke={1.7} />
        </button>
      </div>

      <button
        className="group mt-2 flex h-11 w-full items-center gap-3 rounded-lg bg-hover px-2.5 text-left transition-colors hover:bg-active"
        onClick={onBuildLocally}
        type="button"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline text-fg-muted text-xs">
          1
        </span>
        <span className="min-w-0 flex-1 font-medium text-fg text-sm">Yes, implement this plan</span>
        <IconArrowRight
          className="shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5"
          size={17}
          stroke={1.7}
        />
      </button>

      <button
        className="mt-1 flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors hover:bg-hover"
        onClick={onContinuePlanning}
        type="button"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline text-fg-faint">
          <IconPencil size={14} stroke={1.65} />
        </span>
        <span className="truncate text-fg-subtle text-sm">No, tell Modus what to change</span>
      </button>
    </div>
  );
}

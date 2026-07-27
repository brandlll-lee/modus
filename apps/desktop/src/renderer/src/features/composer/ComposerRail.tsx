import { IconChevronRight } from "@tabler/icons-react";
import { type MouseEvent, type ReactNode, useCallback } from "react";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { cn } from "../../lib/cn";

/**
 * One homogeneous row in the composer status card (Cursor-style): chevron +
 * label + optional trailing actions + optional expand body. Terminals and file
 * changes share this chrome — no per-kind pill/popup forks.
 */
export function ComposerRail({
  label,
  expanded,
  onExpandedChange,
  trailing,
  children,
}: {
  label: ReactNode;
  expanded: boolean;
  onExpandedChange(next: boolean): void;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const noFocus = useCallback((event: MouseEvent) => {
    // Keep the textarea focused: rail clicks must not steal the caret.
    event.preventDefault();
  }, []);

  return (
    <div className="select-none">
      <div className="flex h-8 items-center gap-1 px-2.5">
        <button
          aria-expanded={expanded}
          className="group/rail flex h-full min-w-0 flex-1 items-center gap-1.5 px-1 text-left transition-colors"
          onClick={() => onExpandedChange(!expanded)}
          onMouseDown={noFocus}
          tabIndex={-1}
          type="button"
        >
          <IconChevronRight
            className={cn(
              "shrink-0 text-fg-faint transition-[color,transform] duration-150 group-hover/rail:text-fg-muted",
              expanded && "rotate-90",
            )}
            size={13}
            stroke={1.8}
          />
          <span className="min-w-0 truncate text-sm text-fg-muted transition-colors group-hover/rail:text-fg">
            {label}
          </span>
        </button>
        {trailing ? <div className="flex shrink-0 items-center gap-1">{trailing}</div> : null}
      </div>
      {children !== undefined ? (
        <CollapsibleMotion open={expanded} preset="compact">
          <div className="border-hairline-soft border-t px-1 pt-1 pb-1.5">{children}</div>
        </CollapsibleMotion>
      ) : null}
    </div>
  );
}

export function ComposerRailReviewButton({ onClick }: { onClick(): void }) {
  return (
    <button
      className="flex h-6 shrink-0 items-center rounded-md bg-chip px-2 text-xs text-fg-muted transition-colors hover:text-fg"
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      tabIndex={-1}
      title="Review the diff in the inspector"
      type="button"
    >
      Review
    </button>
  );
}

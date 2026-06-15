import { Menu } from "@base-ui/react/menu";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import { useEffect } from "react";
import type { PlanRef } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

/**
 * Cursor-style "Review Plan" card shown above the composer once Plan Mode has
 * written a plan. Clicking the body opens the plan in the file panel.
 *
 * The Build split-button is the user's explicit authorization to execute:
 * - "Build Locally" runs a single agent against the plan (M3, active; also the
 *   primary button + Ctrl/Cmd+Enter shortcut).
 * - "Build in Parallel" runs the fusion pipeline (M4, disabled until built —
 *   shown disabled, never faked).
 */

/** First meaningful non-heading line of the plan, for a one-line summary. */
function planSummary(content: string): string {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith("#") && !line.startsWith("```")) {
      return line.replace(/^[-*]\s+/, "");
    }
  }
  return "Plan ready to review.";
}

export function ReviewPlanCard({
  plan,
  onOpen,
  onDismiss,
  onBuildLocally,
}: {
  plan: PlanRef;
  onOpen: () => void;
  onDismiss: () => void;
  onBuildLocally: () => void;
}) {
  // Ctrl/Cmd+Enter approves & builds — the shortcut the button advertises.
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
    <div className="mb-2 rounded-xl border border-composer-border bg-elevated px-3.5 py-3 shadow-composer-edge">
      <div className="flex items-start gap-2">
        <button className="min-w-0 flex-1 text-left" onClick={onOpen} type="button">
          <div className="text-fg-faint text-xs">Review Plan</div>
          <div className="mt-1 truncate font-semibold text-fg text-[15px]">{plan.title}</div>
          <div className="mt-1 line-clamp-2 text-fg-subtle text-xs leading-relaxed">
            {planSummary(plan.content)}
          </div>
        </button>
        <button
          aria-label="Dismiss plan"
          className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
          onClick={onDismiss}
          type="button"
        >
          <IconX size={15} stroke={1.7} />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-end">
        <span className="inline-flex items-center overflow-hidden rounded-md text-build-fg">
          <button
            className="flex h-[28px] items-center gap-2 bg-build pr-2.5 pl-3 font-medium text-[13px] transition-colors hover:bg-build-hover"
            onClick={onBuildLocally}
            type="button"
          >
            Build
            <span className="font-normal text-[11px] text-build-fg/55">Ctrl+⏎</span>
          </button>
          <span className="h-[28px] w-px bg-build-fg/15" />
          <Menu.Root>
            <Menu.Trigger
              aria-label="Build options"
              className="flex h-[28px] items-center bg-build px-1 transition-colors hover:bg-build-hover data-popup-open:bg-build-hover"
            >
              <IconChevronDown size={14} stroke={2} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner align="end" side="top" sideOffset={6}>
                <Menu.Popup className="origin-(--transform-origin) min-w-[190px] rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
                  <Menu.Item
                    className="flex cursor-default items-center rounded-md px-2.5 py-1.5 text-fg text-sm outline-none select-none data-highlighted:bg-hover"
                    onClick={onBuildLocally}
                  >
                    Build Locally
                  </Menu.Item>
                  <Menu.Item
                    className={cn(
                      "flex cursor-default items-center rounded-md px-2.5 py-1.5 text-sm outline-none select-none",
                      "text-fg-faint data-disabled:opacity-100",
                    )}
                    disabled
                  >
                    Build in Parallel
                    <span className="ml-auto text-2xs text-fg-faint">soon</span>
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </span>
      </div>
    </div>
  );
}

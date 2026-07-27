import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Cursor-style layered dock: a narrower, rectangular status plate sits behind
 * the composer (same surface fill as the prompt). The prompt overlaps its
 * bottom edge — not a full-width grey peer card, not a merged shell.
 */
export function ComposerDock({
  rails,
  children,
}: {
  /** Homogeneous {@link ComposerRail} nodes; omit empties before passing. */
  rails?: ReactNode;
  children: ReactNode;
}) {
  const hasRails = Boolean(rails);

  return (
    <div className="relative flex flex-col">
      {hasRails ? (
        <div
          className={cn(
            // Inset + modest radius → reads as a rectangle behind a wider prompt.
            "relative z-0 mx-3 overflow-hidden rounded-md border border-composer-border bg-surface pb-2.5",
          )}
        >
          <div className="divide-y divide-hairline-soft">{rails}</div>
        </div>
      ) : null}
      <div className={cn("relative z-10", hasRails && "-mt-2.5")}>{children}</div>
    </div>
  );
}

import { cn } from "../../lib/cn";
import type { SessionActivity } from "./agentEventHub";

/**
 * Tiny shared status glyph for parallel sessions (sidebar rows + pane
 * headers): pulsing brand dot while running, danger dot when input is needed
 * or the last run failed, soft accent dot for unread completions.
 */
export function SessionStatusDot({
  activity,
  className,
}: {
  activity: SessionActivity | undefined;
  className?: string;
}) {
  if (!activity) {
    return null;
  }
  if (activity.needsInput) {
    return (
      <span className={cn("relative flex size-2 shrink-0", className)} title="Needs your input">
        <span className="absolute inset-0 animate-ping rounded-full bg-danger/50" />
        <span className="relative size-2 rounded-full bg-danger" />
      </span>
    );
  }
  if (activity.running) {
    return (
      <span className={cn("relative flex size-2 shrink-0", className)} title="Agent running">
        <span className="absolute inset-0 animate-ping rounded-full bg-focus-ring-soft/40" />
        <span className="relative size-2 rounded-full bg-focus-ring-soft" />
      </span>
    );
  }
  if (activity.failed) {
    return (
      <span
        className={cn(
          "size-2 shrink-0 rounded-full border border-danger bg-transparent",
          className,
        )}
        title="Last run failed"
      />
    );
  }
  if (activity.unread) {
    return (
      <span
        className={cn("size-2 shrink-0 rounded-full bg-success", className)}
        title="Finished while in the background"
      />
    );
  }
  return null;
}

import { IconLoader2 } from "@tabler/icons-react";
import { cn } from "../../lib/cn";
import type { SessionActivity } from "./agentEventHub";

export function SessionStatusDot({
  activity,
  className,
}: {
  activity: SessionActivity | undefined;
  className?: string;
}) {
  if (activity?.needsInput) {
    return (
      <span className={cn("relative flex size-1.5 shrink-0", className)} title="Needs your input">
        <span className="absolute inset-0 animate-ping rounded-full bg-danger/50" />
        <span className="relative size-1.5 rounded-full bg-danger" />
      </span>
    );
  }
  if (activity?.running) {
    return (
      <span
        className={cn("flex size-5 shrink-0 items-center justify-center text-fg-muted", className)}
        title="Agent running"
      >
        <span className="animate-spin motion-reduce:animate-none" aria-hidden>
          <IconLoader2 size={16} stroke={1.5} />
        </span>
        <span className="sr-only">Agent running</span>
      </span>
    );
  }
  if (activity?.failed) {
    return (
      <span
        className={cn("size-1.5 shrink-0 rounded-full bg-danger", className)}
        title="Last run failed"
      />
    );
  }
  if (activity?.unread) {
    return (
      <span
        className={cn("size-1.5 shrink-0 rounded-full bg-success", className)}
        title="Finished while in the background"
      />
    );
  }
  return null;
}

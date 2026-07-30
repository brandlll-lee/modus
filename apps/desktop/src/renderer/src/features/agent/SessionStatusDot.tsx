import { ThinkingOrb } from "thinking-orbs";
import { cn } from "../../lib/cn";
import { useTheme } from "../../lib/theme";
import type { SessionActivity } from "./agentEventHub";

/**
 * Sidebar session glyph: ThinkingOrb while running (same package/preset as
 * WorkFold — only size 20|64 are valid), solid danger for needs-input /
 * failed, success for unread, soft secondary idle dot otherwise.
 */
export function SessionStatusDot({
  activity,
  className,
}: {
  activity: SessionActivity | undefined;
  className?: string;
}) {
  const [mode] = useTheme();

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
        className={cn("flex size-5 shrink-0 items-center justify-center", className)}
        title="Agent running"
      >
        <ThinkingOrb
          aria-label="Working"
          className="shrink-0"
          size={20}
          state="solving"
          theme={mode === "light" ? "light" : "dark"}
        />
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
  return (
    <span
      className={cn("size-1 shrink-0 rounded-full bg-fg-faint/40", className)}
      title="Idle"
    />
  );
}

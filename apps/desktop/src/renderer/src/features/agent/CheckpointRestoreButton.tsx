import { IconCheck, IconLoader2, IconRestore } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

type CheckpointRestoreButtonProps = {
  checkpointId: string;
  /** Performs the restore; resolves when files are back. */
  onRestore(checkpointId: string): Promise<void> | void;
};

type Phase = "idle" | "confirming" | "restoring" | "done";

/**
 * The timeline's rollback affordance, shown on hover next to user messages
 * that have a pre-run snapshot. Destructive, so it uses a two-step inline
 * confirm (no modal): first click arms it, second click restores. Arms
 * auto-disarm after a few seconds.
 */
export function CheckpointRestoreButton({ checkpointId, onRestore }: CheckpointRestoreButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const disarmTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(disarmTimer.current), []);

  async function handleClick(): Promise<void> {
    if (phase === "restoring") {
      return;
    }
    if (phase !== "confirming") {
      setPhase("confirming");
      window.clearTimeout(disarmTimer.current);
      disarmTimer.current = window.setTimeout(() => {
        setPhase((current) => (current === "confirming" ? "idle" : current));
      }, 4000);
      return;
    }

    window.clearTimeout(disarmTimer.current);
    setPhase("restoring");
    try {
      await onRestore(checkpointId);
      setPhase("done");
      disarmTimer.current = window.setTimeout(() => setPhase("idle"), 1600);
    } catch {
      setPhase("idle");
    }
  }

  if (phase === "confirming") {
    return (
      <button
        className="flex h-6 items-center gap-1 rounded-md bg-danger/10 px-1.5 text-2xs text-danger transition-colors hover:bg-danger/20"
        onClick={() => void handleClick()}
        type="button"
      >
        <IconRestore size={12} stroke={1.9} />
        Restore files to this point?
      </button>
    );
  }

  return (
    <button
      aria-label="Restore checkpoint"
      className={cn(
        "flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-muted",
        phase === "restoring" && "cursor-wait text-fg-muted",
      )}
      disabled={phase === "restoring"}
      onClick={() => void handleClick()}
      title="Restore files to before this message"
      type="button"
    >
      {phase === "restoring" ? (
        <IconLoader2 className="animate-spin" size={13} stroke={1.8} />
      ) : phase === "done" ? (
        <IconCheck size={13} stroke={1.9} />
      ) : (
        <IconRestore size={13} stroke={1.8} />
      )}
    </button>
  );
}

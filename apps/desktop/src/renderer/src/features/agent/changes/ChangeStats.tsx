import { IconArrowBackUp, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { FileChangeStat, WorkingChangeStats } from "../../../../../shared/contracts";
import { cn } from "../../../lib/cn";

/**
 * Shared change-summary primitives (Codex-style): green/red ± line counters,
 * per-file rows that open the file on click, and the per-turn "N files
 * changed" card with an undoable footer. All colors come from Modus tokens so
 * light/dark themes just work.
 */

export function LineDelta({
  added,
  removed,
  muted = false,
}: {
  added: number;
  removed: number;
  muted?: boolean;
}) {
  return (
    <span className={cn("shrink-0 font-mono text-xs tabular-nums", muted && "opacity-80")}>
      <span className="text-success">+{added.toLocaleString()}</span>{" "}
      <span className="text-danger">-{removed.toLocaleString()}</span>
    </span>
  );
}

function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) {
    return { dir: "", name: normalized };
  }
  return { dir: normalized.slice(0, index + 1), name: normalized.slice(index + 1) };
}

export function ChangeFileRow({
  file,
  onOpen,
}: {
  file: FileChangeStat;
  onOpen?: ((path: string) => void) | undefined;
}) {
  const { dir, name } = splitPath(file.path);
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">
        {dir ? <span className="text-fg-faint">{dir}</span> : null}
        <span className="text-fg-muted">{name}</span>
      </span>
      {file.binary ? (
        <span className="shrink-0 font-mono text-2xs text-fg-faint">binary</span>
      ) : (
        <LineDelta added={file.added} removed={file.removed} />
      )}
    </>
  );

  if (!onOpen) {
    return <div className="flex h-7 items-center gap-3 rounded-md px-2">{body}</div>;
  }
  return (
    <button
      className="flex h-7 w-full items-center gap-3 rounded-md px-2 transition-colors hover:bg-hover"
      onClick={() => onOpen(file.path)}
      title={`Open ${file.path}`}
      type="button"
    >
      {body}
    </button>
  );
}

export function ChangeFileList({
  stats,
  onOpenFile,
  className,
}: {
  stats: WorkingChangeStats;
  onOpenFile?: ((path: string) => void) | undefined;
  className?: string;
}) {
  return (
    <div className={cn("scroll-thin overflow-y-auto", className)}>
      {stats.files.map((file) => (
        <ChangeFileRow file={file} key={file.path} onOpen={onOpenFile} />
      ))}
      {stats.truncated ? (
        <div className="px-2 py-1 text-2xs text-fg-faint">
          …and {stats.fileCount - stats.files.length} more file(s)
        </div>
      ) : null}
    </div>
  );
}

export function changeSummaryLabel(stats: WorkingChangeStats): string {
  return `${stats.fileCount} file${stats.fileCount === 1 ? "" : "s"} changed`;
}

type UndoPhase = "idle" | "confirming" | "working" | "done";

/**
 * Codex-style end-of-turn card: "N files changed" header with an inline-confirm
 * Undo (restores the pre-run snapshot), then one row per touched file.
 */
export function TurnChangesCard({
  stats,
  checkpointId,
  onUndo,
  onOpenFile,
}: {
  stats: WorkingChangeStats;
  /** Pre-run snapshot to restore when Undo is pressed (absent → no Undo). */
  checkpointId?: string | undefined;
  onUndo?: ((checkpointId: string) => Promise<void> | void) | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
}) {
  const [phase, setPhase] = useState<UndoPhase>("idle");
  const disarmTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(disarmTimer.current), []);

  async function handleUndo(): Promise<void> {
    if (!checkpointId || !onUndo || phase === "working") {
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
    setPhase("working");
    try {
      await onUndo(checkpointId);
      setPhase("done");
      disarmTimer.current = window.setTimeout(() => setPhase("idle"), 1800);
    } catch {
      setPhase("idle");
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-hairline-soft bg-panel">
      <div className="flex h-9 items-center gap-2 border-hairline-soft border-b px-3">
        <span className="min-w-0 truncate text-sm text-fg-muted">{changeSummaryLabel(stats)}</span>
        <LineDelta added={stats.added} muted removed={stats.removed} />
        <div className="min-w-0 flex-1" />
        {checkpointId && onUndo ? (
          <button
            className={cn(
              "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs transition-colors",
              phase === "confirming"
                ? "bg-danger/10 text-danger hover:bg-danger/20"
                : "text-fg-subtle hover:bg-hover hover:text-fg",
              phase === "working" && "cursor-wait",
            )}
            disabled={phase === "working"}
            onClick={() => void handleUndo()}
            title="Restore files to before this turn"
            type="button"
          >
            {phase === "working" ? (
              <IconLoader2 className="animate-spin" size={12} stroke={1.8} />
            ) : phase === "done" ? (
              <IconCheck size={12} stroke={1.9} />
            ) : (
              <IconArrowBackUp size={12} stroke={1.8} />
            )}
            {phase === "confirming" ? "Restore this turn?" : phase === "done" ? "Restored" : "Undo"}
          </button>
        ) : null}
      </div>
      <div className="px-1.5 py-1.5">
        <ChangeFileList className="max-h-56" onOpenFile={onOpenFile} stats={stats} />
      </div>
    </section>
  );
}

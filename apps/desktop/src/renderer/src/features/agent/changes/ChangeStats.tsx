import type { FileChangeStat, WorkingChangeStats } from "../../../../../shared/contracts";
import { cn } from "../../../lib/cn";

/**
 * Shared change-summary primitives: green/red ± line counters and per-file
 * rows that open the file on click. Used by the composer ChangesStrip (Review).
 * All colors come from Modus tokens so light/dark themes just work.
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
        {dir ? (
          <span className="text-fg-faint transition-colors group-hover/file:text-fg-muted">{dir}</span>
        ) : null}
        <span className="text-fg-muted transition-colors group-hover/file:text-fg">{name}</span>
      </span>
      {file.binary ? (
        <span className="shrink-0 font-mono text-2xs text-fg-faint">binary</span>
      ) : (
        <LineDelta added={file.added} removed={file.removed} />
      )}
    </>
  );

  if (!onOpen) {
    return <div className="flex h-7 items-center gap-3 px-2">{body}</div>;
  }
  return (
    <button
      className="group/file flex h-7 w-full items-center gap-3 px-2 text-left"
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

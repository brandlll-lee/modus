import { IconChevronRight } from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import type { WorkingChangeStats } from "../../../../../shared/contracts";
import { cn } from "../../../lib/cn";
import { ChangeFileList, LineDelta } from "./ChangeStats";

/**
 * Cursor-style strip above the composer: a one-line "N files +A -R" summary
 * of the session's working tree that expands into the per-file list, with a
 * Review action that opens the diff panel. Hidden while the tree is clean.
 */
export function ChangesStrip({
  stats,
  onReview,
  onOpenFile,
}: {
  stats: WorkingChangeStats;
  onReview(): void;
  onOpenFile?: ((path: string) => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  if (stats.fileCount === 0) {
    return null;
  }

  return (
    <div className="mb-1.5 overflow-hidden rounded-[10px] border border-hairline-soft bg-panel/70">
      <div className="flex h-8 items-center gap-1 pr-1.5 pl-1">
        <button
          aria-expanded={expanded}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left transition-colors hover:bg-hover"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <IconChevronRight
            className={cn(
              "shrink-0 text-fg-faint transition-transform duration-150",
              expanded && "rotate-90",
            )}
            size={13}
            stroke={1.8}
          />
          <span className="shrink-0 text-sm text-fg-muted">
            {stats.fileCount} {stats.fileCount === 1 ? "file" : "files"}
          </span>
          <LineDelta added={stats.added} removed={stats.removed} />
        </button>
        <button
          className="flex h-6 shrink-0 items-center rounded-md bg-chip px-2 text-xs text-fg-muted transition-colors hover:bg-chip-strong hover:text-fg"
          onClick={onReview}
          title="Review the diff in the inspector"
          type="button"
        >
          Review
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded ? (
          <m.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="border-hairline-soft border-t px-1.5 py-1.5">
              <ChangeFileList className="max-h-44" onOpenFile={onOpenFile} stats={stats} />
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

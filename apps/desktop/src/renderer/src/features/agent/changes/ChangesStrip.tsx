import { useState } from "react";
import type { WorkingChangeStats } from "../../../../../shared/contracts";
import { ComposerRail, ComposerRailReviewButton } from "../../composer/ComposerRail";
import { ChangeFileList } from "./ChangeStats";

/**
 * File-changes rail in the independent status card above the composer:
 * "N Files" + Review. Expand shows the per-file list. Keep All / Undo All are
 * intentionally absent (phase 2).
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

  const label = `${stats.fileCount} ${stats.fileCount === 1 ? "File" : "Files"}`;

  return (
    <ComposerRail
      expanded={expanded}
      label={label}
      onExpandedChange={setExpanded}
      trailing={<ComposerRailReviewButton onClick={onReview} />}
    >
      <ChangeFileList className="max-h-44" onOpenFile={onOpenFile} stats={stats} />
    </ComposerRail>
  );
}

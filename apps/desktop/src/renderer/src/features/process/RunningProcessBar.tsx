import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { ManagedProcessInfo } from "../../../../shared/contracts";
import { formatElapsed } from "../../../../shared/managed-process";
import { cn } from "../../lib/cn";
import { ComposerRail } from "../composer/ComposerRail";

/**
 * Background-terminal rail in the independent status card above the composer
 * (Cursor: "N background terminal(s)"). Pure view over a running-process list —
 * scope/filtering stays with the caller.
 */
export function RunningProcessBar({
  processes,
  nowMs,
  onStop,
}: {
  processes: ManagedProcessInfo[];
  nowMs: number;
  onStop(id: string): void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!processes || processes.length === 0) {
    return null;
  }

  const label = `${processes.length} background ${
    processes.length === 1 ? "terminal" : "terminals"
  }`;

  return (
    <ComposerRail expanded={expanded} label={label} onExpandedChange={setExpanded}>
      <ul className="flex flex-col">
        {processes.map((process) => (
          <ProcessRow key={process.id} nowMs={nowMs} onStop={onStop} process={process} />
        ))}
      </ul>
    </ComposerRail>
  );
}

function ProcessRow({
  process,
  nowMs,
  onStop,
}: {
  process: ManagedProcessInfo;
  nowMs: number;
  onStop: (id: string) => void;
}) {
  const elapsed = formatElapsed(nowMs - Date.parse(process.startedAt));
  return (
    <li className="group/row flex items-center gap-2 rounded-md px-2 py-1.5">
      <span
        className="min-w-0 flex-1 truncate text-sm text-fg-subtle transition-colors group-hover/row:text-fg"
        title={process.label}
      >
        {process.label}
      </span>
      <span className="shrink-0 font-mono text-xs text-fg-faint tabular-nums transition-colors group-hover/row:text-fg-muted">
        {elapsed}
      </span>
      <button
        aria-label={`Stop ${process.label}`}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 transition-[opacity,color]",
          "hover:text-danger group-hover/row:opacity-100",
        )}
        onClick={() => onStop(process.id)}
        onMouseDown={(event) => event.preventDefault()}
        tabIndex={-1}
        type="button"
      >
        <IconTrash size={13} stroke={1.8} />
      </button>
    </li>
  );
}

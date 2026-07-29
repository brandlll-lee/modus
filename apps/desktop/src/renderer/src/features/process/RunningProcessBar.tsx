import { IconAppWindow, IconTerminal2, IconTrash } from "@tabler/icons-react";
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
  onOpenTerminal,
}: {
  processes: ManagedProcessInfo[];
  nowMs: number;
  onStop(id: string): void;
  /** Open the inspector Terminal tab and select this process (terminal ids only). */
  onOpenTerminal?(terminalId: string): void;
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
          <ProcessRow
            key={process.id}
            nowMs={nowMs}
            onOpenTerminal={onOpenTerminal}
            onStop={onStop}
            process={process}
          />
        ))}
      </ul>
    </ComposerRail>
  );
}

function ProcessRow({
  process,
  nowMs,
  onStop,
  onOpenTerminal,
}: {
  process: ManagedProcessInfo;
  nowMs: number;
  onStop: (id: string) => void;
  onOpenTerminal?: ((terminalId: string) => void) | undefined;
}) {
  const elapsed = formatElapsed(nowMs - Date.parse(process.startedAt));
  const isTerminal = process.kind === "terminal";
  const canOpen = isTerminal && Boolean(onOpenTerminal);
  const Icon = isTerminal ? IconTerminal2 : IconAppWindow;

  return (
    <li
      className={cn(
        "group/row flex items-center gap-2 rounded-md px-2 py-1.5",
        canOpen && "cursor-pointer hover:bg-hover",
      )}
      onClick={canOpen ? () => onOpenTerminal?.(process.id) : undefined}
      onKeyDown={
        canOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenTerminal?.(process.id);
              }
            }
          : undefined
      }
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
    >
      <Icon className="shrink-0 text-fg-faint" size={15} stroke={1.7} />
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
        onClick={(event) => {
          event.stopPropagation();
          onStop(process.id);
        }}
        onMouseDown={(event) => event.preventDefault()}
        tabIndex={-1}
        type="button"
      >
        <IconTrash size={13} stroke={1.8} />
      </button>
    </li>
  );
}

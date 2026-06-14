import { IconChevronRight, IconTerminal2, IconTrash, IconX } from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { type MouseEvent, useState } from "react";
import type { ManagedProcessInfo } from "../../../../shared/contracts";
import { formatElapsed } from "../../../../shared/managed-process";
import { cn } from "../../lib/cn";
import { useManagedProcesses } from "./useManagedProcesses";

/**
 * The "running processes" marker that sits just above the composer (Cursor's
 * terminal pill). Collapsed it shows a count pill; expanded it lists each live
 * process with a live elapsed timer and a stop button. It is a pure view over
 * `useManagedProcesses(scope)` — per-session isolation comes entirely from the
 * scope, so switching session/project re-filters and the bar empties on its own.
 *
 * It never takes keyboard focus: rows use `onMouseDown` preventDefault so a click
 * acts without blurring the textarea, keeping the composer the input owner.
 */

type RunningProcessBarProps = {
  workspaceId: string | undefined;
  sessionId: string | undefined;
};

export function RunningProcessBar({ workspaceId, sessionId }: RunningProcessBarProps) {
  // The pill represents what the *agent* is running for this session (Cursor's
  // terminal pill) — never the user's own interactive shell. Origin is a
  // first-class query predicate, so this is a declared slice, not a UI filter.
  const { processes, nowMs, kill } = useManagedProcesses({
    workspaceId,
    sessionId,
    origin: "agent",
  });
  const [expanded, setExpanded] = useState(false);

  const running = processes.filter((process) => process.status === "running");
  if (running.length === 0) {
    return null;
  }

  const noFocus = (event: MouseEvent): void => {
    // Keep the textarea focused: don't let the bar grab focus on click.
    event.preventDefault();
  };

  return (
    <div className="mb-2 select-none">
      <AnimatePresence initial={false} mode="wait">
        {expanded ? (
          <m.div
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-[12px] border border-hairline bg-elevated shadow-popup"
            exit={{ opacity: 0, y: 4 }}
            initial={{ opacity: 0, y: 4 }}
            key="expanded"
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between border-hairline-soft border-b px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <IconTerminal2 size={13} stroke={1.8} />
                {running.length} {running.length === 1 ? "Terminal" : "Terminals"} Running
              </span>
              <button
                aria-label="Collapse"
                className="flex size-5 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-muted"
                onClick={() => setExpanded(false)}
                onMouseDown={noFocus}
                tabIndex={-1}
                type="button"
              >
                <IconX size={12} stroke={2} />
              </button>
            </div>
            <ul className="flex flex-col py-1">
              {running.map((process) => (
                <ProcessRow key={process.id} nowMs={nowMs} onStop={kill} process={process} />
              ))}
            </ul>
          </m.div>
        ) : (
          <m.button
            animate={{ opacity: 1 }}
            className="flex items-center gap-1.5 rounded-full border border-hairline bg-elevated py-1 pr-2.5 pl-2 text-xs text-fg-muted shadow-composer transition-colors hover:bg-hover"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="collapsed"
            onClick={() => setExpanded(true)}
            onMouseDown={noFocus}
            tabIndex={-1}
            transition={{ duration: 0.12 }}
            type="button"
          >
            <IconTerminal2 size={13} stroke={1.8} />
            <span className="font-medium">
              {running.length} {running.length === 1 ? "Terminal" : "Terminals"}
            </span>
            <span className="flex items-center gap-1 text-fg-faint">
              <span className="size-1.5 rounded-full bg-success" />
              Running
            </span>
            <IconChevronRight className="text-fg-faint" size={12} stroke={2} />
          </m.button>
        )}
      </AnimatePresence>
    </div>
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
    <li className="group/row flex items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-hover">
      <IconChevronRight className="shrink-0 text-fg-faint" size={12} stroke={2} />
      <span className="min-w-0 flex-1 truncate text-sm text-fg-subtle" title={process.label}>
        {process.label}
      </span>
      <span className="shrink-0 font-mono text-xs text-fg-faint tabular-nums">{elapsed}</span>
      <button
        aria-label={`Stop ${process.label}`}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 transition-[opacity,color,background-color]",
          "hover:bg-active hover:text-danger group-hover/row:opacity-100",
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

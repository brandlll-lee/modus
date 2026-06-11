import { IconAlertTriangle, IconChevronRight, IconCopy, IconLoader2 } from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { memo, useMemo, useState } from "react";
import { getToolUiMeta } from "../../../../../shared/tools";
import { Tooltip } from "../../../components/ui/Tooltip";
import { cn } from "../../../lib/cn";
import { toolIcon } from "../toolIcons";
import { type InlineDiff, inlineDiffFromToolArgs, toolTargetPath } from "./computeInlineDiff";
import { InlineDiffView } from "./InlineDiff";

type DiffToolCardProps = {
  name: string;
  args?: unknown;
  isError?: boolean;
  isComplete?: boolean;
  /** Session cwd, used to resolve the target path when opening the file. */
  cwd?: string | undefined;
};

/** Keep the tail (filename) visible when a path is long, instead of clipping. */
function shortenPath(path: string, max = 52): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.length <= max) return normalized;
  return `…${normalized.slice(-(max - 1))}`;
}

/** Reconstruct a unified-ish text blob for the clipboard from the diff lines. */
function diffToClipboardText(diff: InlineDiff): string {
  return diff.lines
    .map((line) => {
      if (line.kind === "add") return `+${line.text}`;
      if (line.kind === "del") return `-${line.text}`;
      if (line.kind === "gap") return "…";
      return ` ${line.text}`;
    })
    .join("\n");
}

/**
 * Diff card for the `edit` / `write` tools (Cursor-style). The header reads
 * `[file icon] filename  +N -N` with a copy control; clicking the body toggles
 * a lightweight inline diff (red/green washes, line numbers, 3-line context).
 *
 * The diff is computed entirely from the tool's arguments (zero IPC), so it
 * renders the instant `tool.started` fires — even while the write is still
 * pending permission — mirroring Cursor's pre-apply preview.
 */
export const DiffToolCard = memo(
  function DiffToolCard({
    name,
    args,
    isError = false,
    isComplete = false,
    cwd,
  }: DiffToolCardProps) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const diff = useMemo(() => inlineDiffFromToolArgs(name, args), [name, args]);
    const path = toolTargetPath(args);
    const meta = getToolUiMeta(name);
    const verb = meta?.verb ?? name;
    const fileName = path ? shortenPath(path) : verb;

    function openFile(): void {
      if (cwd && path) {
        void window.modus.file.open({ cwd, path }).catch(() => {});
      }
    }

    async function copyDiff(): Promise<void> {
      if (!diff) return;
      try {
        await navigator.clipboard.writeText(diffToClipboardText(diff));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        // Clipboard denied — silently ignore; the diff is still visible.
      }
    }

    return (
      <div
        className={cn(
          "group/diff min-w-0 overflow-hidden rounded-lg border bg-code-bg",
          isError ? "border-danger/30" : "border-hairline",
        )}
      >
        {/* Header row: status glyph · filename · +N -N · copy · chevron */}
        <div className="flex h-9 min-w-0 items-center gap-2 px-2.5">
          <span className="flex shrink-0 items-center text-fg-faint">
            {isError ? (
              <IconAlertTriangle className="text-danger" size={14} stroke={1.7} />
            ) : isComplete ? (
              toolIcon(meta?.iconName ?? "pencil")
            ) : (
              <IconLoader2
                className="animate-spin text-fg-subtle will-change-transform"
                size={14}
                stroke={1.7}
              />
            )}
          </span>

          <button
            className={cn(
              "min-w-0 flex-1 truncate text-left text-sm transition-colors",
              cwd && path ? "text-fg-muted hover:text-fg hover:underline" : "text-fg-muted",
            )}
            disabled={!(cwd && path)}
            onClick={openFile}
            title={cwd && path ? `Open ${path}` : path}
            type="button"
          >
            {fileName}
          </button>

          {diff ? (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
              <span className="text-success">+{diff.added}</span>
              <span className="text-danger">-{diff.removed}</span>
            </span>
          ) : null}

          {isError ? <span className="shrink-0 text-2xs text-danger">failed</span> : null}

          {diff ? (
            <Tooltip content={copied ? "Copied" : "Copy diff"} side="bottom" sideOffset={6}>
              <button
                aria-label="Copy diff"
                className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg-subtle group-hover/diff:opacity-100"
                onClick={() => void copyDiff()}
                type="button"
              >
                <IconCopy size={13} stroke={1.7} />
              </button>
            </Tooltip>
          ) : null}

          {diff ? (
            <button
              aria-expanded={open}
              aria-label={open ? "Collapse diff" : "Expand diff"}
              className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              <IconChevronRight
                className={cn("transition-transform duration-150", open && "rotate-90")}
                size={14}
                stroke={1.7}
              />
            </button>
          ) : null}
        </div>

        {/* Body: lightweight inline diff, collapsed by default. */}
        <AnimatePresence initial={false}>
          {open && diff ? (
            <m.div
              animate={{ height: "auto", opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="scroll-thin max-h-96 overflow-auto border-hairline-soft border-t">
                <InlineDiffView diff={diff} />
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  },
  (prev, next) =>
    prev.name === next.name &&
    prev.isComplete === next.isComplete &&
    prev.isError === next.isError &&
    prev.cwd === next.cwd &&
    prev.args === next.args,
);

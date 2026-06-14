import { IconAlertCircle, IconChevronRight, IconCopy, IconLoader2 } from "@tabler/icons-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getToolUiMeta } from "../../../../../shared/tools";
import { CollapsibleMotion } from "../../../components/ui/CollapsibleMotion";
import { NumberTicker } from "../../../components/ui/NumberTicker";
import { Tooltip } from "../../../components/ui/Tooltip";
import { cn } from "../../../lib/cn";
import { ShinyText } from "../TextEffects";
import { toolIcon } from "../toolIcons";
import { type InlineDiff, inlineDiffFromToolArgs, toolTargetPath } from "./computeInlineDiff";
import { InlineDiffView } from "./InlineDiff";

/**
 * How many trailing diff lines the live (streaming) viewport renders. Bounds the
 * per-update cost (DOM rows + Shiki highlighting) to the window the user is
 * actually watching, keeping the follow smooth on large files. ~3x the visible
 * rows so there's scroll buffer above the newest line.
 */
const STREAM_TAIL_LINES = 60;

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
    const scrollRef = useRef<HTMLDivElement>(null);

    const diff = useMemo(() => inlineDiffFromToolArgs(name, args), [name, args]);
    const path = toolTargetPath(args);
    const meta = getToolUiMeta(name);
    const verb = meta?.verb ?? name;
    const fileName = path ? shortenPath(path) : verb;
    const running = !isComplete && !isError;
    // While streaming, the live code viewport is always shown (Cursor-style);
    // once settled it collapses to the header and is toggled by the chevron.
    const bodyOpen = running || open;

    // Live performance: while streaming we only render the TAIL of the diff (the
    // window the user is actually watching at the bottom). This caps the work
    // per token — DOM rows + Shiki highlighting — at O(window) instead of
    // O(file), so following a 1000-line write stays smooth. The header keeps the
    // full +/- counts; once settled the full diff renders in the collapsible.
    const liveDiff = useMemo(() => {
      if (!running || !diff || diff.lines.length <= STREAM_TAIL_LINES) {
        return diff;
      }
      return {
        ...diff,
        lines: diff.lines.slice(-STREAM_TAIL_LINES),
        truncated: false,
        hiddenLineCount: 0,
      };
    }, [running, diff]);

    // Buttery follow: a single rAF loop eases scrollTop toward the bottom every
    // frame while streaming, instead of hard-jumping on each batch (which read
    // as stutter). Stops following only if the user scrolls well up to read.
    useEffect(() => {
      if (!running) {
        return;
      }
      let raf = 0;
      const tick = (): void => {
        const el = scrollRef.current;
        if (el) {
          const target = el.scrollHeight - el.clientHeight;
          if (target - el.scrollTop < 240) {
            const next = el.scrollTop + (target - el.scrollTop) * 0.22;
            el.scrollTop = target - next < 0.5 ? target : next;
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [running]);

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
              <IconAlertCircle className="text-danger" size={14} stroke={1.7} />
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
            {running ? <ShinyText>{fileName}</ShinyText> : fileName}
          </button>

          {diff ? (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
              <span className="text-success">
                +<NumberTicker value={diff.added} />
              </span>
              <span className="text-danger">
                -<NumberTicker value={diff.removed} />
              </span>
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
              aria-expanded={bodyOpen}
              aria-label={bodyOpen ? "Collapse diff" : "Expand diff"}
              className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-40"
              disabled={running}
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              <IconChevronRight
                className={cn("transition-transform duration-150", bodyOpen && "rotate-90")}
                size={14}
                stroke={1.7}
              />
            </button>
          ) : null}
        </div>

        {/* Body: while streaming, a fixed-height live viewport that auto-follows
            the newest written code (Cursor-style); once settled, a collapsible
            full diff toggled from the header. Syntax-highlighted + red/green. */}
        {running && liveDiff ? (
          <div
            className="scroll-thin h-[168px] overflow-auto border-hairline-soft border-t"
            ref={scrollRef}
          >
            <InlineDiffView diff={liveDiff} path={path} />
          </div>
        ) : (
          <CollapsibleMotion open={open && Boolean(diff)} preset="timeline">
            <div className="scroll-thin max-h-96 overflow-auto border-hairline-soft border-t">
              {diff ? <InlineDiffView diff={diff} path={path} /> : null}
            </div>
          </CollapsibleMotion>
        )}
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

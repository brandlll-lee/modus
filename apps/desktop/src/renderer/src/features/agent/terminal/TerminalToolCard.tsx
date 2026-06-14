import {
  IconAlertCircle,
  IconChevronRight,
  IconLoader2,
  IconTerminal2,
} from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";
import { CollapsibleMotion } from "../../../components/ui/CollapsibleMotion";
import { cn } from "../../../lib/cn";
import { ShinyText } from "../TextEffects";
import { parseTerminalOutput, tailLines } from "./parseTerminal";

type TerminalToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  isComplete?: boolean;
};

/** Lines of trailing output shown in the collapsed preview (Cursor-like). */
const PREVIEW_LINES = 3;
/** Hard cap on rendered rows when expanded, so a huge log can't freeze chat. */
const MAX_BODY_CHARS = 60_000;

/**
 * Cursor-style terminal card for `bash` / `terminal_run` / `terminal_read`.
 *
 * Collapsed, it's a bordered box: a header with the command + status, and the
 * latest few lines of output as a live preview. Clicking expands the full
 * scrollable output. This replaces the old single flat row that hid everything
 * behind a chevron and showed no preview.
 */
export const TerminalToolCard = memo(
  function TerminalToolCard({
    name,
    args,
    output,
    isError = false,
    isComplete = false,
  }: TerminalToolCardProps) {
    const [open, setOpen] = useState(false);
    const parsed = useMemo(() => parseTerminalOutput(name, args, output), [name, args, output]);

    const running = !isComplete && !isError;
    const preview = useMemo(() => tailLines(parsed.body, PREVIEW_LINES), [parsed.body]);
    const hasBody = parsed.body.trim().length > 0;
    const hasMore = preview.hidden > 0 || parsed.truncated;
    const expandable = hasBody;
    const cappedBody = useMemo(
      () =>
        parsed.body.length > MAX_BODY_CHARS ? `${parsed.body.slice(-MAX_BODY_CHARS)}` : parsed.body,
      [parsed.body],
    );

    const statusLabel = isError
      ? "failed"
      : (parsed.status ?? (running ? "running" : isComplete ? "done" : ""));

    return (
      <div
        className={cn(
          "min-w-0 overflow-hidden rounded-lg border bg-code-bg",
          isError ? "border-danger/30" : "border-hairline",
        )}
      >
        {/* Header: glyph · command · status · chevron */}
        <button
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full min-w-0 items-center gap-2 px-2.5 text-left transition-colors",
            expandable ? "hover:bg-hover" : "cursor-default",
          )}
          disabled={!expandable}
          onClick={() => expandable && setOpen((value) => !value)}
          type="button"
        >
          <span className="flex shrink-0 items-center text-fg-faint">
            {isError ? (
              <IconAlertCircle className="text-danger" size={14} stroke={1.7} />
            ) : running ? (
              <IconLoader2
                className="animate-spin text-fg-subtle will-change-transform"
                size={14}
                stroke={1.7}
              />
            ) : (
              <IconTerminal2 size={14} stroke={1.7} />
            )}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[12px]",
              isError ? "text-danger" : "text-fg-muted",
            )}
            title={parsed.command}
          >
            {running ? (
              <ShinyText>{parsed.command ?? "terminal"}</ShinyText>
            ) : (
              (parsed.command ?? "terminal")
            )}
          </span>
          {statusLabel ? (
            <span
              className={cn(
                "shrink-0 text-2xs",
                isError ? "text-danger" : running ? "text-fg-subtle" : "text-fg-faint",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
          {expandable ? (
            <IconChevronRight
              className={cn(
                "shrink-0 text-fg-faint transition-transform duration-150",
                open && "rotate-90",
              )}
              size={13}
              stroke={1.7}
            />
          ) : null}
        </button>

        {/* Collapsed: live tail preview. Expanded: full scrollable output. */}
        {hasBody ? (
          <>
            <CollapsibleMotion open={open} preset="timeline">
              <pre className="scroll-thin max-h-96 overflow-auto border-hairline-soft border-t px-3 py-2 font-mono text-[12px] text-fg-faint leading-relaxed whitespace-pre-wrap wrap-break-word">
                {parsed.truncated ? "[earlier output truncated]\n" : ""}
                {cappedBody}
              </pre>
            </CollapsibleMotion>
            {!open ? (
              <div className="border-hairline-soft border-t px-3 py-2">
                <pre className="max-h-16 overflow-hidden font-mono text-[12px] text-fg-faint leading-relaxed whitespace-pre-wrap wrap-break-word">
                  {preview.text}
                </pre>
                {hasMore ? (
                  <div className="mt-1 text-2xs text-fg-faint">
                    {parsed.truncated ? "earlier output truncated · " : ""}
                    click to expand{preview.hidden > 0 ? ` (+${preview.hidden} lines)` : ""}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    );
  },
  (prev, next) =>
    prev.name === next.name &&
    prev.output === next.output &&
    prev.isComplete === next.isComplete &&
    prev.isError === next.isError &&
    prev.args === next.args,
);

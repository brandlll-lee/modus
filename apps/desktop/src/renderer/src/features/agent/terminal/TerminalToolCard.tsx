import { IconAlertCircle, IconCheck, IconChevronRight, IconTerminal2 } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";
import { CollapsibleMotion } from "../../../components/ui/CollapsibleMotion";
import { cn } from "../../../lib/cn";
import { ShinyText } from "../TextEffects";
import { parseTerminalOutput } from "./parseTerminal";

type TerminalToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  isComplete?: boolean;
  variant?: TerminalToolVariant;
};

export type TerminalToolVariant = "standalone" | "group";

/** Hard cap on rendered rows when expanded, so a huge log can't freeze chat. */
const MAX_BODY_CHARS = 60_000;

/**
 * Cursor-style terminal card for `bash` / `terminal_run` / `terminal_read`.
 *
 * Collapsed: a dark one-line command row. Expanded: the terminal panel.
 */
export const TerminalToolCard = memo(
  function TerminalToolCard({
    name,
    args,
    output,
    isError = false,
    isComplete = false,
    variant = "standalone",
  }: TerminalToolCardProps) {
    const [open, setOpen] = useState(false);
    const parsed = useMemo(() => parseTerminalOutput(name, args, output), [name, args, output]);

    const running = !isComplete && !isError;
    const hasBody = parsed.body.trim().length > 0;
    const cappedBody = useMemo(
      () =>
        parsed.body.length > MAX_BODY_CHARS ? `${parsed.body.slice(-MAX_BODY_CHARS)}` : parsed.body,
      [parsed.body],
    );
    const exitCode = parsed.status?.match(/^exited\s+(.+)$/i)?.[1];
    const command = parsed.command ?? "command";
    const success = !running && !isError && (!exitCode || exitCode === "0");
    const panelStatus = isError
      ? "Failed"
      : exitCode && exitCode !== "0"
        ? `Exit code ${exitCode}`
        : success
          ? "Success"
          : parsed.status;

    const headerLabel = running
      ? `Running ${command}`
      : exitCode
        ? "Ran command"
        : isError
          ? "Command failed"
          : "Ran command";

    const panel = (
      <div
        className={cn(
          "mt-1 overflow-hidden rounded-lg border bg-code-bg",
          isError ? "border-danger/30" : "border-hairline",
        )}
      >
        <div className="px-3 pt-2 text-fg-faint text-xs">Shell</div>
        <div className="px-3 py-3">
          <pre className="scroll-thin overflow-x-auto whitespace-pre font-mono text-[12px] text-fg leading-relaxed">
            $ {command}
          </pre>
          {hasBody || parsed.truncated ? (
            <pre className="scroll-thin mt-2 max-h-96 overflow-auto font-mono text-[12px] text-fg-faint leading-relaxed whitespace-pre-wrap wrap-break-word">
              {parsed.truncated ? "[earlier output truncated]\n" : ""}
              {cappedBody}
            </pre>
          ) : null}
          {panelStatus ? (
            <div
              className={cn(
                "mt-2 flex items-center justify-end gap-1 text-2xs",
                isError || (exitCode && exitCode !== "0") ? "text-danger" : "text-fg-faint",
              )}
            >
              {success ? <IconCheck size={12} stroke={1.8} /> : null}
              {isError ? <IconAlertCircle size={12} stroke={1.8} /> : null}
              <span>{panelStatus}</span>
            </div>
          ) : null}
        </div>
      </div>
    );

    if (variant === "group") {
      const groupLabel = open
        ? running
          ? "Running command"
          : "Ran command"
        : running
          ? `Running ${command}`
          : `Ran ${command}`;

      return (
        <div className="min-w-0 text-sm">
          <button
            aria-expanded={open}
            className={cn(
              "flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left transition-colors hover:text-fg-muted",
              isError ? "text-danger" : "text-fg-subtle",
            )}
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {open ? (
              <IconChevronRight
                className="shrink-0 rotate-90 text-fg-faint"
                size={12}
                stroke={1.7}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate" title={command}>
              {running ? <ShinyText>{groupLabel}</ShinyText> : groupLabel}
            </span>
          </button>
          <CollapsibleMotion open={open} preset="timeline">
            {panel}
          </CollapsibleMotion>
        </div>
      );
    }

    return (
      <div className="min-w-0">
        <button
          aria-expanded={open}
          className={cn(
            "flex h-8 w-full min-w-0 items-center gap-2 rounded-md bg-code-bg px-2.5 text-left transition-colors hover:bg-hover",
            isError && "text-danger",
          )}
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span className="flex shrink-0 items-center text-fg-faint">
            {isError ? (
              <IconAlertCircle className="text-danger" size={14} stroke={1.7} />
            ) : (
              <IconTerminal2 size={14} stroke={1.7} />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-fg-muted text-sm" title={command}>
            {running ? <ShinyText>{headerLabel}</ShinyText> : headerLabel}
          </span>
          <IconChevronRight
            className={cn(
              "shrink-0 text-fg-faint transition-transform duration-150",
              open && "rotate-90",
            )}
            size={13}
            stroke={1.7}
          />
        </button>

        <CollapsibleMotion open={open} preset="timeline">
          {panel}
        </CollapsibleMotion>
      </div>
    );
  },
  (prev, next) =>
    prev.name === next.name &&
    prev.output === next.output &&
    prev.isComplete === next.isComplete &&
    prev.isError === next.isError &&
    prev.variant === next.variant &&
    prev.args === next.args,
);

import { IconAlertCircle, IconCheck, IconChevronRight } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";
import { CollapsibleMotion } from "../../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../../components/ui/ShinyText";
import { cn } from "../../../lib/cn";
import { parseTerminalOutput } from "./parseTerminal";

type TerminalToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  isComplete?: boolean;
};

/** Hard cap on rendered output when expanded, so a huge log can't freeze chat. */
const MAX_BODY_CHARS = 60_000;

/**
 * Flat terminal tool row (Cursor parity).
 *
 * Collapsed: `Running {cmd}` / `Ran {cmd}` — flat text, truncated.
 * Expanded: soft panel with `$ command` + output.
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

    const summary = running
      ? `Running ${command}`
      : isError
        ? `Command failed ${command}`
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
          <span className="min-w-0 flex-1 truncate" title={command}>
            {running ? <ShinyText>{summary}</ShinyText> : summary}
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
          <div
            className={cn(
              "mt-1 overflow-hidden rounded-lg border bg-card",
              isError ? "border-danger/30" : "border-hairline",
            )}
          >
            <div className="px-3 py-3">
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] text-fg leading-relaxed">
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
        </CollapsibleMotion>
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

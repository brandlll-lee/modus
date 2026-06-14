import { IconAlertCircle, IconChevronRight, IconLoader2 } from "@tabler/icons-react";
import { memo, type ReactNode, useState } from "react";
import { getToolUiMeta, type ToolUiMeta } from "../../../../shared/tools";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { cn } from "../../lib/cn";
import { DiffToolCard } from "./diff/DiffToolCard";
import { TERMINAL_CARD_TOOLS } from "./terminal/parseTerminal";
import { TerminalToolCard } from "./terminal/TerminalToolCard";
import { ShinyText } from "./TextEffects";
import { toolIcon } from "./toolIcons";

type ToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  isComplete?: boolean;
  /** Session cwd, threaded to the diff card so it can open the edited file. */
  cwd?: string | undefined;
};

/** Tools that render as a rich Cursor-style diff card instead of a flat row. */
const DIFF_TOOLS = new Set(["edit", "write"]);

/** Cap how much tool output we drop into the DOM at once. */
const MAX_DETAIL_CHARS = 12_000;

type ToolView = {
  icon: ReactNode;
  verb: string;
  /** Main target shown after the verb. Always truncated so it can't widen chat. */
  target: string;
  /** Render the target in monospace (commands, patterns). */
  mono: boolean;
};

export const ToolCard = memo(
  function ToolCard({
    name,
    args,
    output,
    isComplete = false,
    isError = false,
    cwd,
  }: ToolCardProps) {
    // edit/write get the rich diff treatment; every other tool stays a flat row.
    if (DIFF_TOOLS.has(name)) {
      return (
        <DiffToolCard args={args} cwd={cwd} isComplete={isComplete} isError={isError} name={name} />
      );
    }

    // bash / terminal_run / terminal_read get a Cursor-style terminal card with
    // a live output preview that expands to the full log.
    if (TERMINAL_CARD_TOOLS.has(name)) {
      return (
        <TerminalToolCard
          args={args}
          isComplete={isComplete}
          isError={isError}
          name={name}
          output={output}
        />
      );
    }

    return (
      <FlatToolRow
        args={args}
        isComplete={isComplete}
        isError={isError}
        name={name}
        output={output}
      />
    );
  },
  (prev, next) =>
    prev.name === next.name &&
    prev.output === next.output &&
    prev.isComplete === next.isComplete &&
    prev.isError === next.isError &&
    prev.cwd === next.cwd &&
    argsEqual(prev.args, next.args),
);

type FlatToolRowProps = Omit<ToolCardProps, "cwd">;

function FlatToolRow({
  name,
  args,
  output,
  isComplete = false,
  isError = false,
}: FlatToolRowProps) {
  const [open, setOpen] = useState(false);
  const view = describeTool(name, args);
  const detail = toolDetail(name, args, output);
  const expandable = detail.trim().length > 0;
  const running = !isComplete && !isError;

  const body = (
    <>
      <span className="shrink-0 text-fg-faint">
        {isError ? (
          <IconAlertCircle className="text-danger" size={14} stroke={1.7} />
        ) : isComplete ? (
          view.icon
        ) : (
          <IconLoader2
            className="animate-spin text-fg-subtle will-change-transform"
            size={14}
            stroke={1.7}
          />
        )}
      </span>
      {running ? (
        // Running tools shimmer their label (the timeline's "Thinking" effect).
        <ShinyText className="min-w-0 flex-1 truncate">
          {`${view.verb} ${view.target}`.trim()}
        </ShinyText>
      ) : (
        <>
          <span className={cn("shrink-0", isError ? "text-danger" : "text-fg-muted")}>
            {view.verb}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-fg-faint",
              view.mono && "font-mono text-[12px]",
            )}
            title={view.target}
          >
            {view.target}
          </span>
        </>
      )}
      {isError ? <span className="shrink-0 text-2xs text-danger">failed</span> : null}
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
    </>
  );

  return (
    <div className="min-w-0 text-sm">
      {expandable ? (
        <button
          aria-expanded={open}
          className="flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-fg"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-2 py-0.5">{body}</div>
      )}

      <CollapsibleMotion open={open && expandable} preset="timeline">
        <pre
          className={cn(
            "scroll-thin mt-1 max-h-72 overflow-auto rounded-md border border-hairline bg-canvas px-3 py-2",
            "whitespace-pre-wrap wrap-break-word font-mono text-[12px] text-fg-faint leading-relaxed",
            isError && "border-danger/25 text-danger/90",
          )}
        >
          {clampDetail(detail)}
        </pre>
      </CollapsibleMotion>
    </div>
  );
}

function describeTool(name: string, args: unknown): ToolView {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const meta = getToolUiMeta(name);
  if (!meta) {
    return { icon: toolIcon("tool"), verb: humanize(name), target: bestEffortArg(a), mono: true };
  }
  const base: ToolView = {
    icon: toolIcon(meta.iconName),
    verb: meta.verb,
    target: primaryTarget(meta, a),
    mono: meta.mono,
  };
  switch (name) {
    case "read":
      return { ...base, target: `${shortenPath(str(a.path))}${lineRange(a.offset, a.limit)}` };
    case "edit": {
      const count = Array.isArray(a.edits) ? a.edits.length : 0;
      return count > 1 ? { ...base, target: `${shortenPath(str(a.path))} (${count} edits)` } : base;
    }
    case "grep": {
      const where = a.path ? ` in ${shortenPath(str(a.path))}` : a.glob ? ` in ${str(a.glob)}` : "";
      return { ...base, target: `${str(a.pattern)}${where}` };
    }
    case "find": {
      const where = a.path ? ` in ${shortenPath(str(a.path))}` : "";
      return { ...base, target: `${str(a.pattern)}${where}` };
    }
    default:
      return base;
  }
}

/** Default target label derived from the tool's declared primary argument. */
function primaryTarget(meta: ToolUiMeta, a: Record<string, unknown>): string {
  if (!meta.primaryArgKey) return bestEffortArg(a);
  const value = str(a[meta.primaryArgKey]);
  if (meta.primaryArgKey === "path") return value ? shortenPath(value) : ".";
  return value;
}

function toolDetail(name: string, args: unknown, output: string): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  if (name === "bash" || name === "terminal_run") {
    const command = str(a.command);
    return output.trim() ? `$ ${command}\n\n${output}` : `$ ${command}`;
  }
  if (name === "write" && !output.trim()) {
    return typeof a.content === "string" ? a.content : "";
  }
  return output;
}

function clampDetail(detail: string): string {
  const trimmed = detail.replace(/\s+$/, "");
  return trimmed.length > MAX_DETAIL_CHARS
    ? `${trimmed.slice(0, MAX_DETAIL_CHARS)}\n…(truncated)`
    : trimmed;
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

function lineRange(offset: unknown, limit: unknown): string {
  const start = typeof offset === "number" ? offset : undefined;
  const count = typeof limit === "number" ? limit : undefined;
  if (start != null && count != null) return ` L${start}-${start + count}`;
  if (start != null) return ` L${start}+`;
  if (count != null) return ` (${count} lines)`;
  return "";
}

/** Keep the tail (filename) visible when a path is long, instead of CSS clipping it. */
function shortenPath(path: string, max = 52): string {
  if (path.length <= max) return path;
  return `…${path.slice(-(max - 1))}`;
}

function humanize(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Tool";
}

function bestEffortArg(args: Record<string, unknown>): string {
  for (const key of ["command", "path", "pattern", "query", "url"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  const keys = Object.keys(args);
  return keys.length ? JSON.stringify(args) : "";
}

function argsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key],
  );
}

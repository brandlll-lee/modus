import {
  IconAlertTriangle,
  IconChevronRight,
  IconFile,
  IconFilePlus,
  IconFileSearch,
  IconFolder,
  IconLoader2,
  IconPencil,
  IconSearch,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { memo, type ReactNode, useState } from "react";
import { cn } from "../../lib/cn";

type ToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  isComplete?: boolean;
};

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
  function ToolCard({ name, args, output, isComplete = false, isError = false }: ToolCardProps) {
    const [open, setOpen] = useState(false);
    const view = describeTool(name, args);
    const detail = toolDetail(name, args, output);
    const expandable = detail.trim().length > 0;

    const body = (
      <>
        <span className="shrink-0 text-fg-faint">
          {isError ? (
            <IconAlertTriangle className="text-danger" size={14} stroke={1.7} />
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

        <AnimatePresence initial={false}>
          {open && expandable ? (
            <m.div
              animate={{ height: "auto", opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              <pre
                className={cn(
                  "scroll-thin mt-1 max-h-72 overflow-auto rounded-md border border-hairline bg-canvas px-3 py-2",
                  "whitespace-pre-wrap wrap-break-word font-mono text-[12px] text-fg-faint leading-relaxed",
                  isError && "border-danger/25 text-danger/90",
                )}
              >
                {clampDetail(detail)}
              </pre>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  },
  (prev, next) =>
    prev.name === next.name &&
    prev.output === next.output &&
    prev.isComplete === next.isComplete &&
    prev.isError === next.isError &&
    argsEqual(prev.args, next.args),
);

function describeTool(name: string, args: unknown): ToolView {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (name) {
    case "read": {
      const path = shortenPath(str(a.path));
      const range = lineRange(a.offset, a.limit);
      return { icon: icon(IconFile), verb: "Read", target: `${path}${range}`, mono: false };
    }
    case "bash": {
      return { icon: icon(IconTerminal2), verb: "Ran", target: str(a.command), mono: true };
    }
    case "edit": {
      const count = Array.isArray(a.edits) ? a.edits.length : 0;
      const suffix = count > 1 ? ` (${count} edits)` : "";
      return {
        icon: icon(IconPencil),
        verb: "Edited",
        target: `${shortenPath(str(a.path))}${suffix}`,
        mono: false,
      };
    }
    case "write": {
      return {
        icon: icon(IconFilePlus),
        verb: "Wrote",
        target: shortenPath(str(a.path)),
        mono: false,
      };
    }
    case "grep": {
      const where = a.path ? ` in ${shortenPath(str(a.path))}` : a.glob ? ` in ${str(a.glob)}` : "";
      return {
        icon: icon(IconSearch),
        verb: "Grepped",
        target: `${str(a.pattern)}${where}`,
        mono: true,
      };
    }
    case "find": {
      const where = a.path ? ` in ${shortenPath(str(a.path))}` : "";
      return {
        icon: icon(IconFileSearch),
        verb: "Searched",
        target: `${str(a.pattern)}${where}`,
        mono: true,
      };
    }
    case "ls": {
      return {
        icon: icon(IconFolder),
        verb: "Listed",
        target: a.path ? shortenPath(str(a.path)) : ".",
        mono: false,
      };
    }
    default:
      return { icon: icon(IconTool), verb: humanize(name), target: bestEffortArg(a), mono: true };
  }
}

function toolDetail(name: string, args: unknown, output: string): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  if (name === "bash") {
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

function icon(Glyph: typeof IconFile): ReactNode {
  return <Glyph size={14} stroke={1.7} />;
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

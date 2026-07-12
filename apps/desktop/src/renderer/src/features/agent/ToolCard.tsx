import { IconAlertCircle, IconChevronRight } from "@tabler/icons-react";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import type { QuestionAnswer, QuestionRequest } from "../../../../shared/contracts";
import { getToolUiMeta, type ToolUiMeta, toolRenderKind } from "../../../../shared/tools";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";
import { useSmoothStreamingText } from "../../lib/useSmoothStreamingText";
import { DiffToolCard } from "./diff/DiffToolCard";
import { QuestionToolCard } from "./QuestionToolCard";
import { TerminalToolCard, type TerminalToolVariant } from "./terminal/TerminalToolCard";
import { toolIcon } from "./toolIcons";
import { VisualToolCard } from "./VisualToolCard";

type ToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  isComplete?: boolean;
  variant?: TerminalToolVariant;
  /** Session cwd, threaded to the diff card so it can open the edited file. */
  cwd?: string | undefined;
  questionRequest?: QuestionRequest;
  questionAnswers?: QuestionAnswer[];
  questionSkipped?: boolean;
};

/** Cap how much tool output we drop into the DOM at once. */
const MAX_DETAIL_CHARS = 12_000;

type ToolView = {
  icon: ReactNode;
  verb: string;
  /** Main target shown after the verb. Always truncated so it can't widen chat. */
  target: string;
};

export const ToolCard = memo(
  function ToolCard({
    name,
    args,
    output,
    isComplete = false,
    isError = false,
    variant,
    cwd,
    questionRequest,
    questionAnswers,
    questionSkipped,
  }: ToolCardProps) {
    // The catalog declares how each tool renders; route on that capability
    // instead of matching names, so a new tool is a catalog entry, not an edit
    // here. (todo tools are intercepted upstream in the Timeline and never reach
    // ToolCard, so they fall through to a flat row defensively.)
    const render = toolRenderKind(name);
    if (render === "diff") {
      return (
        <DiffToolCard args={args} cwd={cwd} isComplete={isComplete} isError={isError} name={name} />
      );
    }

    if (render === "terminal") {
      return (
        <TerminalToolCard
          args={args}
          isComplete={isComplete}
          isError={isError}
          name={name}
          output={output}
          {...(variant ? { variant } : {})}
        />
      );
    }

    if (render === "live") {
      return (
        <LiveToolCard
          args={args}
          isComplete={isComplete}
          isError={isError}
          name={name}
          output={output}
        />
      );
    }

    if (render === "question") {
      return (
        <QuestionToolCard
          args={args}
          isComplete={isComplete}
          {...(questionAnswers ? { answers: questionAnswers } : {})}
          {...(questionRequest ? { request: questionRequest } : {})}
          {...(questionSkipped !== undefined ? { skipped: questionSkipped } : {})}
        />
      );
    }

    if (render === "visual") {
      return <VisualToolCard args={args} isComplete={isComplete} isError={isError} />;
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
    prev.variant === next.variant &&
    prev.cwd === next.cwd &&
    prev.questionRequest === next.questionRequest &&
    prev.questionAnswers === next.questionAnswers &&
    prev.questionSkipped === next.questionSkipped &&
    argsEqual(prev.args, next.args),
);

type FlatToolRowProps = Omit<ToolCardProps, "cwd">;

const LIVE_AUTO_COLLAPSE_MS = 800;
const LIVE_OUTPUT_PACING = {
  paceMs: 16,
  maxStep: 36,
} as const;

function LiveToolCard({
  name,
  args,
  output,
  isComplete = false,
  isError = false,
}: FlatToolRowProps) {
  const running = !isComplete && !isError;
  const [open, setOpen] = useState(() => running || isError);
  const [smoothOutput, setSmoothOutput] = useState(() => running);
  const sawRunningRef = useRef(false);
  const scrollRef = useRef<HTMLPreElement>(null);
  const view = describeTool(name, args);
  const status = running ? liveStatus(output) || "Starting" : isError ? "Failed" : "Complete";
  const rawDetail = clampTailDetail(output.trimEnd());
  const visibleRawDetail = useSmoothStreamingText(
    rawDetail,
    smoothOutput && open && !isError && rawDetail.length > 0,
    LIVE_OUTPUT_PACING,
  );
  const playbackComplete = !rawDetail || visibleRawDetail === rawDetail;
  const fallbackDetail = running || isError ? status : "";
  const detail = isError
    ? rawDetail || fallbackDetail
    : rawDetail
      ? visibleRawDetail
      : fallbackDetail;
  const bodyOpen = open && Boolean(detail.trim());

  useEffect(() => {
    if (running) {
      sawRunningRef.current = true;
      setSmoothOutput(true);
      setOpen(true);
      return;
    }
    if (isError) {
      setSmoothOutput(false);
      setOpen(true);
      return;
    }
    if (sawRunningRef.current && isComplete && playbackComplete) {
      setSmoothOutput(false);
      const timeout = globalThis.setTimeout(() => setOpen(false), LIVE_AUTO_COLLAPSE_MS);
      return () => globalThis.clearTimeout(timeout);
    }
    return undefined;
  }, [running, isComplete, isError, playbackComplete]);

  useEffect(() => {
    if (!bodyOpen || !detail || !scrollRef.current) return undefined;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    return undefined;
  }, [bodyOpen, detail]);

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-hairline bg-canvas text-sm">
      <button
        aria-expanded={bodyOpen}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-hover"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="shrink-0 text-fg-faint">
          {isError ? <IconAlertCircle className="text-danger" size={14} stroke={1.7} /> : view.icon}
        </span>
        {running ? (
          <ShinyText className="shrink-0 font-medium">{view.verb}</ShinyText>
        ) : (
          <span className={cn("shrink-0 font-medium", isError ? "text-danger" : "text-fg")}>
            {view.verb}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-fg-subtle" title={view.target}>
          {view.target}
        </span>
        <span
          className={cn(
            "min-w-0 max-w-[35%] truncate text-xs",
            isError ? "text-danger" : "text-fg-faint",
          )}
          title={status}
        >
          {status}
        </span>
        <IconChevronRight
          className={cn(
            "shrink-0 text-fg-faint transition-transform duration-150",
            bodyOpen && "rotate-90",
          )}
          size={13}
          stroke={1.7}
        />
      </button>

      <CollapsibleMotion open={bodyOpen} preset="timeline">
        <pre
          className={cn(
            "scroll-thin max-h-80 overflow-auto border-hairline border-t bg-code-bg px-3 py-2",
            "whitespace-pre-wrap wrap-break-word text-[12px] text-fg-faint leading-relaxed",
            isError && "text-danger/90",
          )}
          ref={scrollRef}
        >
          {detail}
        </pre>
      </CollapsibleMotion>
    </div>
  );
}

function FlatToolRow({
  name,
  args,
  output,
  isComplete = false,
  isError = false,
}: FlatToolRowProps) {
  const [open, setOpen] = useState(false);
  const running = !isComplete && !isError;
  const view = describeTool(name, running ? undefined : args);
  const status = running ? liveStatus(output) : "";
  const detail = running ? "" : toolDetail(name, args, output);
  const expandable = detail.trim().length > 0;

  const body = (
    <>
      <span className="shrink-0 text-fg-faint">
        {isError ? <IconAlertCircle className="text-danger" size={14} stroke={1.7} /> : view.icon}
      </span>
      {running ? (
        <>
          <ShinyText className="shrink-0">{view.verb}</ShinyText>
          {status ? (
            <span className="min-w-0 flex-1 truncate text-fg-faint" title={status}>
              {status}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className={cn("shrink-0 font-medium", isError ? "text-danger" : "text-fg-subtle")}>
            {view.verb}
          </span>
          <span className="min-w-0 flex-1 truncate text-fg-subtle" title={view.target}>
            {view.target}
          </span>
        </>
      )}
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
            "whitespace-pre-wrap wrap-break-word text-[12px] text-fg-faint leading-relaxed",
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
    return { icon: toolIcon("tool"), verb: humanize(name), target: bestEffortArg(a) };
  }
  const base: ToolView = {
    icon: toolIcon(meta.iconName),
    verb: meta.verb,
    target: primaryTarget(meta, a),
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
  const meta = getToolUiMeta(name);
  // A terminal-style command tool: prefix the command even with no output yet.
  if (meta?.render === "terminal" && meta.primaryArgKey === "command") {
    const command = str(a.command);
    return output.trim() ? `$ ${command}\n\n${output}` : `$ ${command}`;
  }
  // A new-file writer with no textual output: show the content being written.
  if (meta?.diffSource === "newFile" && !output.trim()) {
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

function clampTailDetail(detail: string): string {
  return detail.length > MAX_DETAIL_CHARS ? detail.slice(-MAX_DETAIL_CHARS) : detail;
}

function liveStatus(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "";
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
  return keys.length ? `${keys.length} parameters` : "";
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

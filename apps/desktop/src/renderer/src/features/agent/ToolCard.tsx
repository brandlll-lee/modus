import { memo, type ReactNode } from "react";
import { getToolUiMeta, type ToolUiMeta, toolRenderKind } from "../../../../shared/tools";
import { ActionRow } from "./ActionRow";
import { DiffToolCard } from "./diff/DiffToolCard";
import { TerminalToolCard } from "./terminal/TerminalToolCard";
import { toolActionIcon } from "./toolIcons";

type ToolCardProps = {
  name: string;
  label?: string | undefined;
  args?: unknown;
  output: string;
  details?: unknown;
  isError?: boolean;
  isComplete?: boolean;
  onOpenFile?: ((path: string) => void) | undefined;
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
    label,
    args,
    output,
    details,
    isComplete = false,
    isError = false,
    onOpenFile,
  }: ToolCardProps) {
    const render = toolRenderKind(name);
    if (render === "diff") {
      return (
        <DiffToolCard
          args={args}
          details={details}
          output={output}
          isComplete={isComplete}
          isError={isError}
          name={name}
          {...(onOpenFile ? { onOpenFile } : {})}
        />
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
        />
      );
    }

    return (
      <FlatToolRow
        label={label}
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
    prev.label === next.label &&
    prev.output === next.output &&
    prev.details === next.details &&
    prev.isComplete === next.isComplete &&
    prev.isError === next.isError &&
    prev.onOpenFile === next.onOpenFile &&
    argsEqual(prev.args, next.args),
);

type FlatToolRowProps = ToolCardProps;

function FlatToolRow({
  name,
  label,
  args,
  output,
  isComplete = false,
  isError = false,
}: FlatToolRowProps) {
  const running = !isComplete && !isError;
  const view = describeTool(name, args, running);
  if (label) view.verb = running ? (getToolUiMeta(name)?.activeVerb ?? `Running ${label}`) : label;
  const detail = running ? "" : output;
  return (
    <ActionRow
      icon={view.icon}
      label={running ? `${view.verb}${view.target ? ` ${view.target}` : ""}` : view.verb}
      target={view.target}
      detail={clampDetail(detail)}
      active={running}
      danger={isError}
    />
  );
}

function describeTool(name: string, args: unknown, running: boolean): ToolView {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const meta = getToolUiMeta(name);
  if (!meta) {
    return {
      icon: toolActionIcon(name),
      verb: `${running ? "Running " : ""}${humanize(name)}`,
      target: bestEffortArg(a),
    };
  }
  const base: ToolView = {
    icon: toolActionIcon(name),
    verb: running ? (meta.activeVerb ?? meta.verb) : meta.verb,
    target: primaryTarget(meta, a),
  };
  switch (name) {
    case "read":
      return { ...base, target: `${shortenPath(str(a.path))}${lineRange(a.offset, a.limit)}` };
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

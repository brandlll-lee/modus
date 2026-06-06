import { IconTerminal2 } from "@tabler/icons-react";

type ToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  isComplete?: boolean;
};

export function ToolCard({
  name,
  args,
  output,
  isComplete = false,
  isError = false,
}: ToolCardProps) {
  const detail = summarizeToolDetail(args, output);
  const label = formatToolLabel(name, args);

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-fg-subtle">
      <IconTerminal2 className="shrink-0 text-fg-faint" size={15} stroke={1.65} />
      {isComplete ? (
        <span className={isError ? "shrink-0 text-danger" : "shrink-0 text-fg-muted"}>
          {isError ? "Failed" : "Ran"} {label}
        </span>
      ) : (
        <span className="shrink-0 text-fg-muted">{`Running ${label}`}</span>
      )}
      {detail && isComplete ? (
        <span className="min-w-0 truncate text-fg-faint">{detail}</span>
      ) : null}
      <span className={isError ? "ml-auto shrink-0 text-danger" : "ml-auto shrink-0 text-fg-faint"}>
        {isError ? "failed" : isComplete ? "" : "running"}
      </span>
    </div>
  );
}

function formatToolLabel(name: string, args: unknown): string {
  if (typeof args === "object" && args && "command" in args) {
    return String((args as { command?: unknown }).command ?? name);
  }
  if (typeof args === "object" && args && "path" in args) {
    return `${name} ${String((args as { path?: unknown }).path ?? "")}`.trim();
  }
  return name;
}

function summarizeToolDetail(args: unknown, output: string): string {
  const raw = output.trim() || (args ? JSON.stringify(args) : "");
  return raw.length > 96 ? `${raw.slice(0, 96)}...` : raw;
}

import { IconTerminal2 } from "@tabler/icons-react";

type ToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
};

export function ToolCard({ name, args, output, isError = false }: ToolCardProps) {
  const detail = summarizeToolDetail(args, output);

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-fg-subtle">
      <IconTerminal2 className="shrink-0 text-fg-faint" size={15} stroke={1.65} />
      <span className="shrink-0 text-fg-muted">{name}</span>
      {detail ? <span className="min-w-0 truncate text-fg-faint">{detail}</span> : null}
      <span className={isError ? "ml-auto shrink-0 text-danger" : "ml-auto shrink-0 text-fg-faint"}>
        {isError ? "failed" : "done"}
      </span>
    </div>
  );
}

function summarizeToolDetail(args: unknown, output: string): string {
  const raw = output.trim() || (args ? JSON.stringify(args) : "");
  return raw.length > 96 ? `${raw.slice(0, 96)}...` : raw;
}

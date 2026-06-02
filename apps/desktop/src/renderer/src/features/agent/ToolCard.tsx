import { IconTerminal2, IconTool } from "@tabler/icons-react";

type ToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  isError?: boolean;
};

export function ToolCard({ name, args, output, isError = false }: ToolCardProps) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-white/6 text-fg-subtle">
        <IconTool size={13} stroke={1.7} />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-hairline bg-white/2.5">
        <div className="flex h-8 items-center gap-2 border-hairline border-b px-3 text-xs text-fg-subtle">
          <IconTerminal2 size={13} stroke={1.7} />
          <span className="truncate">{name}</span>
          <span className={isError ? "ml-auto text-danger" : "ml-auto text-fg-faint"}>
            {isError ? "failed" : "done"}
          </span>
        </div>
        {args ? (
          <pre className="scroll-thin overflow-x-auto whitespace-pre-wrap px-3 pt-2 font-mono text-2xs text-fg-faint">
            {JSON.stringify(args, null, 2)}
          </pre>
        ) : null}
        {output ? (
          <pre className="scroll-thin max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs text-fg-muted leading-relaxed">
            {output}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

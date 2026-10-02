import { IconChevronRight, IconCopy } from "@tabler/icons-react";
import { memo, useEffect, useMemo, useState } from "react";
import { getToolUiMeta } from "../../../../../shared/tools";
import { CollapsibleMotion } from "../../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../../components/ui/ShinyText";
import { cn } from "../../../lib/cn";
import { toolActionIcon } from "../toolIcons";
import { fileDiff, toolTargetPath } from "./fileDiff";
import { InlineDiffView } from "./InlineDiff";

type DiffToolCardProps = {
  name: string;
  args?: unknown;
  output: string;
  details?: unknown;
  isError?: boolean;
  isComplete?: boolean;
  onOpenFile?: ((path: string) => void) | undefined;
};

function contentLines(content: string): number {
  let end = content.length;
  while (end && (content[end - 1] === "\n" || content[end - 1] === "\r")) end--;
  if (!end) return 0;
  let count = 1;
  for (let i = 0; i < end; i++) {
    if (content[i] === "\n" || (content[i] === "\r" && content[i + 1] !== "\n")) count++;
  }
  return count;
}

export const DiffToolCard = memo(function DiffToolCard({
  name,
  args,
  output,
  details,
  isError = false,
  isComplete = false,
  onOpenFile,
}: DiffToolCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<{ diff?: string; error?: string }>();
  const meta = getToolUiMeta(name);
  const running = !isComplete && !isError;
  const path = toolTargetPath(args);
  const fileName = path?.replace(/\\/g, "/").split("/").pop();
  const verb = isError ? "Failed" : running ? (meta?.activeVerb ?? name) : (meta?.verb ?? name);
  const content =
    meta?.filePreview === "content" &&
    args &&
    typeof args === "object" &&
    "content" in args &&
    typeof args.content === "string"
      ? args.content
      : undefined;
  const lineCount = useMemo(
    () => (content === undefined ? undefined : contentLines(content)),
    [content],
  );
  const diff = useMemo(
    () => fileDiff(isError ? undefined : running ? preview : details),
    [isError, running, preview, details],
  );
  const hasBody = !!diff || content !== undefined || (isError && !!output) || !!preview?.error;
  const bodyOpen = open && hasBody;
  const result =
    details && typeof details === "object" ? (details as Record<string, unknown>) : undefined;
  const copyText =
    typeof result?.patch === "string"
      ? result.patch
      : typeof result?.diff === "string"
        ? result.diff
        : content;

  useEffect(() => {
    if (!running || meta?.filePreview !== "edits") return;
    let current = true;
    void window.modus.agent.previewEdits(args).then(
      (parts) => {
        if (current) setPreview({ diff: parts.join("\n  ...\n") });
      },
      (error) => {
        if (current) setPreview({ error: String(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [args, running, meta?.filePreview]);

  async function copy(): Promise<void> {
    if (copyText === undefined) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="group/diff min-w-0 text-sm">
      <div className="flex min-w-0 items-center gap-1">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-fg disabled:cursor-default"
          disabled={!path || !onOpenFile}
          onClick={() => {
            if (path) onOpenFile?.(path);
          }}
          title={path}
          type="button"
        >
          <span className="action-icon">{toolActionIcon(name)}</span>
          {running ? (
            <ShinyText className="min-w-0 truncate">{`${verb}${fileName ? ` ${fileName}` : ""}`}</ShinyText>
          ) : (
            <span className={cn("min-w-0 truncate", isError ? "text-danger" : "text-fg-subtle")}>
              {verb}
              {fileName ? ` ${fileName}` : ""}
            </span>
          )}
          {diff ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
              {running ? <span className="text-fg-faint">Preview</span> : null}
              <span className="font-mono text-success">+{diff.added}</span>
              <span className="font-mono text-danger">-{diff.removed}</span>
            </span>
          ) : lineCount !== undefined ? (
            <span className="shrink-0 text-xs text-fg-faint tabular-nums">
              {lineCount} lines{running ? " · preview" : ""}
            </span>
          ) : null}
        </button>
        {!running && !isError && copyText !== undefined ? (
          <button
            aria-label={copied ? "Copied" : "Copy file content"}
            className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg-subtle"
            onClick={() => void copy().catch(() => {})}
            type="button"
          >
            <IconCopy size={13} stroke={1.7} />
          </button>
        ) : null}
        {hasBody ? (
          <button
            aria-expanded={bodyOpen}
            aria-label={bodyOpen ? "Collapse file content" : "Expand file content"}
            className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg-subtle"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <IconChevronRight
              className={cn("transition-transform duration-150", bodyOpen && "rotate-90")}
              size={14}
              stroke={1.7}
            />
          </button>
        ) : null}
      </div>
      <CollapsibleMotion open={bodyOpen} preset="timeline">
        {bodyOpen ? (
          <div className="scroll-thin mt-1 max-h-96 overflow-auto rounded-md border border-hairline bg-card">
            {running ? (
              <p className="px-3 py-1 text-xs text-fg-faint">
                Content preview · PI has not finished the operation.
              </p>
            ) : null}
            {isError ? (
              <pre role="alert" className="whitespace-pre-wrap p-3 text-xs text-danger">
                {output}
              </pre>
            ) : diff ? (
              <InlineDiffView diff={diff} path={path} streaming={running} />
            ) : content !== undefined ? (
              <pre className="whitespace-pre p-3 font-mono text-xs text-fg-subtle">
                {content.slice(0, 12000)}
                {content.length > 12000 ? "\n… (preview truncated)" : ""}
              </pre>
            ) : preview?.error ? (
              <p className="p-3 text-xs text-danger">Preview unavailable: {preview.error}</p>
            ) : null}
          </div>
        ) : null}
      </CollapsibleMotion>
    </div>
  );
});

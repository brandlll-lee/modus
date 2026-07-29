import { IconChevronRight, IconCopy } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";
import { getToolUiMeta, type ToolUiMeta } from "../../../../../shared/tools";
import { CollapsibleMotion } from "../../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../../components/ui/ShinyText";
import { Tooltip } from "../../../components/ui/Tooltip";
import { cn } from "../../../lib/cn";
import { materialIconForFile } from "../../files/fileIcons";
import { type InlineDiff, inlineDiffFromToolArgs, toolTargetPath } from "./computeInlineDiff";
import { InlineDiffView } from "./InlineDiff";

type DiffToolCardProps = {
  name: string;
  args?: unknown;
  isError?: boolean;
  isComplete?: boolean;
  /** Open the target in the Files inspector (App.openWorkspaceFile). */
  onOpenFile?: ((path: string) => void) | undefined;
};

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function argRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

function primaryTarget(meta: ToolUiMeta | undefined, args: Record<string, unknown>): string {
  const key = meta?.primaryArgKey;
  if (!key) return "";
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function displayName(
  path: string | undefined,
  meta: ToolUiMeta | undefined,
  args: Record<string, unknown>,
  toolName: string,
): string {
  if (path) return fileNameFromPath(path);
  return primaryTarget(meta, args) || meta?.verb || toolName;
}

/** Running label from catalog `diffSource` (structured), not tool-name cases. */
function progressPhrase(meta: ToolUiMeta | undefined, fileName: string): string {
  const verb = meta?.diffSource === "newFile" ? "creating" : "editing";
  return `${verb} ${fileName}`;
}

/** Reconstruct a unified-ish text blob for the clipboard from the diff lines. */
function diffToClipboardText(diff: InlineDiff): string {
  return diff.lines
    .map((line) => {
      if (line.kind === "add") return `+${line.text}`;
      if (line.kind === "del") return `-${line.text}`;
      if (line.kind === "gap") return "…";
      return ` ${line.text}`;
    })
    .join("\n");
}

/**
 * Diff card for file-writing tools.
 *
 * Running: material icon + ShinyText progress phrase — no live ±.
 * Done: verb + file + static ±; primary click opens Files; chevron expands diff.
 */
export const DiffToolCard = memo(
  function DiffToolCard({
    name,
    args,
    isError = false,
    isComplete = false,
    onOpenFile,
  }: DiffToolCardProps) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const diff = useMemo(() => inlineDiffFromToolArgs(name, args), [name, args]);
    const path = toolTargetPath(args);
    const meta = getToolUiMeta(name);
    const argsRecord = argRecord(args);
    const fileName = displayName(path, meta, argsRecord, name);
    const fileTitle = path ? path.replace(/\\/g, "/") : fileName;
    const iconUrl = materialIconForFile(fileName);
    const isNewFileDiff = meta?.diffSource === "newFile";
    const running = !isComplete && !isError;
    const bodyOpen = open && Boolean(diff) && !running;
    const doneVerb = meta?.verb ?? "Edited";

    function openInFiles(): void {
      if (path && onOpenFile) {
        onOpenFile(path);
      }
    }

    async function copyDiff(): Promise<void> {
      if (!diff) return;
      try {
        await navigator.clipboard.writeText(diffToClipboardText(diff));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        // Clipboard denied — silently ignore; the diff is still visible.
      }
    }

    return (
      <div className="group/diff min-w-0 text-sm">
        <div className="flex min-w-0 items-center gap-1">
          <button
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-fg disabled:cursor-default"
            disabled={!path || !onOpenFile}
            onClick={openInFiles}
            title={fileTitle}
            type="button"
          >
            <span className="flex w-4 shrink-0 items-center justify-center">
              {iconUrl ? (
                <img alt="" className="size-3.5" draggable={false} src={iconUrl} />
              ) : null}
            </span>

            {running ? (
              <ShinyText className="min-w-0 truncate">{progressPhrase(meta, fileName)}</ShinyText>
            ) : (
              <>
                <span className={cn("shrink-0", isError ? "text-danger" : "text-fg-muted")}>
                  {doneVerb}
                </span>
                <span className="min-w-0 truncate text-fg-subtle text-sm">{fileName}</span>
                {diff ? (
                  isError ? (
                    <span className="shrink-0 rounded-[4px] bg-danger/15 px-1.5 py-0.5 text-danger text-xs">
                      failed
                    </span>
                  ) : (
                    <DiffDelta added={diff.added} removed={diff.removed} />
                  )
                ) : null}
              </>
            )}
          </button>

          {diff && !running ? (
            <>
              <Tooltip content={copied ? "Copied" : "Copy diff"} side="bottom" sideOffset={6}>
                <button
                  aria-label="Copy diff"
                  className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg-subtle group-hover/diff:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyDiff();
                  }}
                  type="button"
                >
                  <IconCopy size={13} stroke={1.7} />
                </button>
              </Tooltip>

              <button
                aria-expanded={bodyOpen}
                aria-label={bodyOpen ? "Collapse diff" : "Expand diff"}
                className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg-subtle group-hover/diff:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen((value) => !value);
                }}
                type="button"
              >
                <IconChevronRight
                  className={cn("transition-transform duration-150", bodyOpen && "rotate-90")}
                  size={14}
                  stroke={1.7}
                />
              </button>
            </>
          ) : null}
        </div>

        <CollapsibleMotion open={bodyOpen} preset="timeline">
          <div
            className={cn(
              "scroll-thin mt-1 max-h-96 overflow-auto rounded-md border border-hairline bg-card",
              isNewFileDiff && "bg-diff-add-bg",
            )}
          >
            {diff ? <InlineDiffView diff={diff} path={path} /> : null}
          </div>
        </CollapsibleMotion>
      </div>
    );
  },
  (prev, next) =>
    prev.name === next.name &&
    prev.isComplete === next.isComplete &&
    prev.isError === next.isError &&
    prev.onOpenFile === next.onOpenFile &&
    prev.args === next.args,
);

function DiffDelta({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
      {added > 0 ? <span className="text-success">+{added}</span> : null}
      {removed > 0 ? <span className="text-danger">-{removed}</span> : null}
    </span>
  );
}

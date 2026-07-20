import { IconChevronRight, IconCopy, IconFilePlus } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";
import { getToolUiMeta, type ToolUiMeta } from "../../../../../shared/tools";
import { CollapsibleMotion } from "../../../components/ui/CollapsibleMotion";
import { NumberTicker } from "../../../components/ui/NumberTicker";
import { ShinyText } from "../../../components/ui/ShinyText";
import { Tooltip } from "../../../components/ui/Tooltip";
import { cn } from "../../../lib/cn";
import { type InlineDiff, inlineDiffFromToolArgs, toolTargetPath } from "./computeInlineDiff";
import { InlineDiffView } from "./InlineDiff";

type DiffToolCardProps = {
  name: string;
  args?: unknown;
  isError?: boolean;
  isComplete?: boolean;
  /** Session cwd, used to resolve the target path when opening the file. */
  cwd?: string | undefined;
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

function fileTypeGlyph(label: string): string | undefined {
  const name = fileNameFromPath(label);
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return undefined;
  return `${name.slice(dot + 1, dot + 2).toUpperCase()}+`;
}

function operationLabel(meta: ToolUiMeta | undefined): string {
  return meta?.diffSource === "newFile" ? "Created" : (meta?.verb ?? "Edited");
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
 * Diff card for file-writing tools. The collapsed row is the source of truth;
 * expanding reuses the same lightweight inline diff view.
 *
 * The diff is computed entirely from the tool's arguments (zero IPC), so it
 * renders the instant `tool.started` fires — even while the write is still
 * pending permission — mirroring Cursor's pre-apply preview.
 */
export const DiffToolCard = memo(
  function DiffToolCard({
    name,
    args,
    isError = false,
    isComplete = false,
    cwd,
  }: DiffToolCardProps) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const diff = useMemo(() => inlineDiffFromToolArgs(name, args), [name, args]);
    const path = toolTargetPath(args);
    const meta = getToolUiMeta(name);
    const argsRecord = argRecord(args);
    const fileName = displayName(path, meta, argsRecord, name);
    const fileTitle = path ? path.replace(/\\/g, "/") : fileName;
    const glyph = fileTypeGlyph(fileName);
    const isNewFileDiff = meta?.diffSource === "newFile";
    const running = !isComplete && !isError;
    const bodyOpen = open && Boolean(diff);

    function openFile(): void {
      if (cwd && path) {
        void window.modus.file.open({ cwd, path }).catch(() => {});
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
            aria-expanded={bodyOpen}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-fg disabled:cursor-default"
            disabled={!diff}
            onDoubleClick={openFile}
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <span className="flex w-4 shrink-0 items-center justify-center text-link">
              {glyph ? (
                <span className="font-semibold font-mono text-[10px] leading-none tabular-nums">
                  {glyph}
                </span>
              ) : (
                <IconFilePlus size={14} stroke={1.7} />
              )}
            </span>

            {running ? (
              <ShinyText className="shrink-0">{operationLabel(meta)}</ShinyText>
            ) : (
              <span className={cn("shrink-0 font-semibold", isError ? "text-danger" : "text-fg")}>
                {operationLabel(meta)}
              </span>
            )}

            <span className="min-w-0 truncate text-fg-muted text-sm" title={fileTitle}>
              {fileName}
            </span>

            {diff ? (
              isError ? (
                <span className="shrink-0 rounded-[4px] bg-danger/15 px-1.5 py-0.5 text-danger text-xs">
                  failed
                </span>
              ) : (
                <DiffDelta added={diff.added} removed={diff.removed} />
              )
            ) : null}
          </button>

          {diff ? (
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
                className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg-subtle disabled:opacity-40 group-hover/diff:opacity-100"
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
              "scroll-thin mt-1 max-h-96 overflow-auto rounded-md border border-hairline bg-code-bg",
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
    prev.cwd === next.cwd &&
    prev.args === next.args,
);

function DiffDelta({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
      {added > 0 || removed === 0 ? (
        <span className="text-success">
          +<NumberTicker value={added} />
        </span>
      ) : null}
      {removed > 0 ? (
        <span className="text-danger">
          -<NumberTicker value={removed} />
        </span>
      ) : null}
    </span>
  );
}

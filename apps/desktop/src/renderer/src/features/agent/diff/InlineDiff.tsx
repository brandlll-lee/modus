import { memo } from "react";
import { cn } from "../../../lib/cn";
import type { InlineDiff, InlineDiffLine } from "./computeInlineDiff";

type InlineDiffViewProps = {
  diff: InlineDiff;
};

/** Marker glyph shown in the sign column for each line kind. */
const SIGN: Record<InlineDiffLine["kind"], string> = {
  add: "+",
  del: "-",
  context: "",
  gap: "",
};

/**
 * Lightweight, Cursor-style inline diff. Pure DOM rows — no Monaco instance —
 * so a single agent turn can render many of these without choking the chat
 * stream. Red/green washes come from the `--color-diff-*` theme tokens, so the
 * view tracks light/dark automatically. Syntax highlighting is intentionally
 * deferred (Q4.1): the red/green wash plus the sign column carries the meaning.
 */
export const InlineDiffView = memo(function InlineDiffView({ diff }: InlineDiffViewProps) {
  return (
    <div className="overflow-x-auto font-mono text-[12px] leading-[1.65]">
      <div className="min-w-full">
        {diff.lines.map((line, index) => (
          <DiffRow key={diffRowKey(line, index)} line={line} />
        ))}
      </div>
      {diff.truncated ? (
        <div className="border-hairline-soft border-t px-3 py-1.5 text-2xs text-fg-faint">
          … {diff.hiddenLineCount} more line{diff.hiddenLineCount === 1 ? "" : "s"} hidden
        </div>
      ) : null}
    </div>
  );
});

/**
 * Stable per-row key. Diff lines carry no natural id, so we compose one from the
 * line's identity (kind + both side line numbers) plus its ordinal to stay
 * unique even when identical text repeats.
 */
function diffRowKey(line: InlineDiffLine, index: number): string {
  return `${index}:${line.kind}:${line.oldLine ?? ""}:${line.newLine ?? ""}`;
}

function DiffRow({ line }: { line: InlineDiffLine }) {
  if (line.kind === "gap") {
    return (
      <div className="flex select-none items-center text-fg-faint">
        <span className="w-10 shrink-0" />
        <span className="w-4 shrink-0" />
        <span className="px-2 py-0.5 text-2xs tracking-widest">{line.text}</span>
      </div>
    );
  }

  const isAdd = line.kind === "add";
  const isDel = line.kind === "del";

  return (
    <div className={cn("flex items-stretch", isAdd && "bg-diff-add-bg", isDel && "bg-diff-del-bg")}>
      <span
        className={cn(
          "w-10 shrink-0 select-none px-2 text-right text-fg-faint tabular-nums",
          isAdd && "bg-diff-add-gutter",
          isDel && "bg-diff-del-gutter",
        )}
      >
        {line.newLine ?? line.oldLine ?? ""}
      </span>
      <span
        className={cn(
          "w-4 shrink-0 select-none text-center",
          isAdd && "bg-diff-add-gutter text-success",
          isDel && "bg-diff-del-gutter text-danger",
        )}
      >
        {SIGN[line.kind]}
      </span>
      <span
        className={cn(
          "whitespace-pre px-2 py-0.5",
          isAdd ? "text-fg" : isDel ? "text-fg-muted" : "text-fg-subtle",
        )}
      >
        {line.text === "" ? " " : line.text}
      </span>
    </div>
  );
}

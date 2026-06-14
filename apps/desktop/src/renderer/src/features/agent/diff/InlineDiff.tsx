import type { ThemedToken } from "shiki/core";
import { memo, useMemo } from "react";
import { highlightToLines, languageForPath, useCodeHighlighter } from "../../../lib/codeHighlight";
import { cn } from "../../../lib/cn";
import { useTheme } from "../../../lib/theme";
import type { InlineDiff, InlineDiffLine } from "./computeInlineDiff";

type InlineDiffViewProps = {
  diff: InlineDiff;
  /** Target file path, used to pick the syntax-highlighting grammar. */
  path?: string | undefined;
};

/** Marker glyph shown in the sign column for each line kind. */
const SIGN: Record<InlineDiffLine["kind"], string> = {
  add: "+",
  del: "-",
  context: "",
  gap: "",
};

/**
 * Cursor-style inline diff: red/green washed rows with real syntax highlighting
 * (Shiki, JS engine — pure DOM rows, no Monaco). The whole change is tokenized
 * in one pass so multi-line context (strings, comments) colours correctly; gap
 * rows are excluded from the code blob and mapped back by index. While a grammar
 * loads, rows fall back to plain text and re-render once it's ready.
 */
export const InlineDiffView = memo(function InlineDiffView({ diff, path }: InlineDiffViewProps) {
  const [themeMode] = useTheme();
  const lang = languageForPath(path);
  const ready = useCodeHighlighter(lang);

  const tokenByLine = useMemo(() => {
    // Map each diff line to its index in the highlighted code blob (gaps excluded).
    const codeLineByDiffIndex: Array<number | null> = [];
    const codeLines: string[] = [];
    for (const line of diff.lines) {
      if (line.kind === "gap") {
        codeLineByDiffIndex.push(null);
        continue;
      }
      codeLineByDiffIndex.push(codeLines.length);
      codeLines.push(line.text);
    }
    // `ready` is referenced so the memo recomputes once the grammar finishes loading.
    void ready;
    const tokens = highlightToLines(codeLines.join("\n"), lang, themeMode);
    return { codeLineByDiffIndex, tokens };
  }, [diff.lines, lang, themeMode, ready]);

  return (
    <div className="overflow-x-auto font-mono text-[12px] leading-[1.65]">
      <div className="min-w-full">
        {diff.lines.map((line, index) => (
          <DiffRow
            key={diffRowKey(line, index)}
            line={line}
            tokens={
              tokenByLine.codeLineByDiffIndex[index] !== null
                ? tokenByLine.tokens?.[tokenByLine.codeLineByDiffIndex[index] as number]
                : undefined
            }
          />
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

function DiffRow({ line, tokens }: { line: InlineDiffLine; tokens?: ThemedToken[] | undefined }) {
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
      <span className={cn("whitespace-pre px-2 py-0.5", isDel && "opacity-70")}>
        <DiffLineText line={line} tokens={tokens} />
      </span>
    </div>
  );
}

/** Highlighted tokens when a grammar is ready, else the raw line text. */
function DiffLineText({ line, tokens }: { line: InlineDiffLine; tokens?: ThemedToken[] | undefined }) {
  if (line.text === "") {
    return <span> </span>;
  }
  if (!tokens || tokens.length === 0) {
    return <span className="text-fg-subtle">{line.text}</span>;
  }
  return (
    <>
      {tokens.map((token, index) => (
        <span key={`${index}:${token.offset ?? index}`} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </>
  );
}

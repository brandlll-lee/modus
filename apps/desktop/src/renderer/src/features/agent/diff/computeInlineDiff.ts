import { structuredPatch } from "diff";
import { getToolUiMeta } from "../../../../../shared/tools";

/**
 * Pure diff computation for the edit/write tool cards.
 *
 * Approach A (see the design grilling): we render the diff entirely from the
 * tool's *arguments* — no IPC, no git round-trip — so the card can show the
 * change the instant `tool.started` fires (even before the file is written).
 *
 * Consequences worth knowing:
 *  - `edit` args are `{ path, edits: [{ oldText, newText }] }`. Each edit is a
 *    localized fragment, so line numbers are relative to that fragment, not the
 *    whole file. We run `structuredPatch` per edit to get 3-line context and
 *    automatic elision of unchanged regions, then concatenate the edits.
 *  - `write` args are `{ path, content }`. We have no prior on-disk content, so
 *    (per Q3.1) it always renders as an all-green new file (`+N -0`).
 */

export type InlineDiffLineKind = "add" | "del" | "context" | "gap";

export type InlineDiffLine = {
  kind: InlineDiffLineKind;
  /** New-side line number (1-based, fragment-relative). Absent for del/gap. */
  newLine?: number;
  /** Old-side line number (1-based, fragment-relative). Absent for add/gap. */
  oldLine?: number;
  /** Line text without the diff prefix. For `gap`, a short elision label. */
  text: string;
};

export type InlineDiff = {
  lines: InlineDiffLine[];
  /** Total additions across the whole change (NOT just the visible window). */
  added: number;
  /** Total deletions across the whole change. */
  removed: number;
  /** A render cap dropped trailing lines. */
  truncated: boolean;
  /** How many lines were dropped by the cap (0 unless `truncated`). */
  hiddenLineCount: number;
};

export type InlineDiffOptions = {
  /** Lines of unchanged context kept around each change. */
  context?: number;
  /** Hard cap on rendered rows; excess is summarized. Default 600. */
  maxLines?: number;
};

const DEFAULT_CONTEXT = 3;
const DEFAULT_MAX_LINES = 600;

/** Normalize CRLF/CR to LF so diffing is line-ending agnostic (mirrors PI). */
function normalizeToLF(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Split content into lines, dropping the artifact empty element from a trailing newline. */
function toLines(content: string): string[] {
  const normalized = normalizeToLF(content);
  if (normalized === "") {
    return [];
  }
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

type RawEdit = { oldText: string; newText: string };

/** Defensively pull `{ oldText, newText }[]` out of unknown edit-tool args. */
function readEdits(args: Record<string, unknown>): RawEdit[] {
  const raw = args.edits;
  if (!Array.isArray(raw)) {
    return [];
  }
  const edits: RawEdit[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const oldText = (item as Record<string, unknown>).oldText;
      const newText = (item as Record<string, unknown>).newText;
      if (typeof oldText === "string" && typeof newText === "string") {
        edits.push({ oldText, newText });
      }
    }
  }
  return edits;
}

/** Push one structured patch's hunks onto the accumulator, tracking counts. */
function appendPatchHunks(
  acc: InlineDiffLine[],
  counts: { added: number; removed: number },
  oldText: string,
  newText: string,
  context: number,
): void {
  const patch = structuredPatch(
    "a",
    "b",
    normalizeToLF(oldText),
    normalizeToLF(newText),
    undefined,
    undefined,
    { context, stripTrailingCr: true },
  );

  patch.hunks.forEach((hunk, hunkIndex) => {
    if (hunkIndex > 0) {
      // Unchanged region elided between two hunks of the same edit.
      acc.push({ kind: "gap", text: "⋯" });
    }
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      const marker = line[0];
      const text = line.slice(1);
      if (marker === "+") {
        acc.push({ kind: "add", newLine, text });
        newLine += 1;
        counts.added += 1;
      } else if (marker === "-") {
        acc.push({ kind: "del", oldLine, text });
        oldLine += 1;
        counts.removed += 1;
      } else if (marker === " ") {
        acc.push({ kind: "context", oldLine, newLine, text });
        oldLine += 1;
        newLine += 1;
      }
      // Lines starting with "\" ("\ No newline at end of file") are skipped.
    }
  });
}

/** Apply the render cap, preserving the true counts in the header. */
function capLines(
  lines: InlineDiffLine[],
  maxLines: number,
): {
  lines: InlineDiffLine[];
  truncated: boolean;
  hiddenLineCount: number;
} {
  if (lines.length <= maxLines) {
    return { lines, truncated: false, hiddenLineCount: 0 };
  }
  return {
    lines: lines.slice(0, maxLines),
    truncated: true,
    hiddenLineCount: lines.length - maxLines,
  };
}

/** Diff for the `edit` tool: concatenate each fragment's hunks with a separator. */
export function computeEditInlineDiff(
  edits: RawEdit[],
  options: InlineDiffOptions = {},
): InlineDiff {
  const context = options.context ?? DEFAULT_CONTEXT;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const acc: InlineDiffLine[] = [];
  const counts = { added: 0, removed: 0 };

  edits.forEach((edit, editIndex) => {
    if (editIndex > 0 && acc.length > 0) {
      // Separator between distinct edit fragments.
      acc.push({ kind: "gap", text: "⋯" });
    }
    appendPatchHunks(acc, counts, edit.oldText, edit.newText, context);
  });

  const capped = capLines(acc, maxLines);
  return {
    lines: capped.lines,
    added: counts.added,
    removed: counts.removed,
    truncated: capped.truncated,
    hiddenLineCount: capped.hiddenLineCount,
  };
}

/** Diff for the `write` tool: an all-green new file (`original = ""`). */
export function computeWriteInlineDiff(
  content: string,
  options: InlineDiffOptions = {},
): InlineDiff {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const lines = toLines(content).map<InlineDiffLine>((text, index) => ({
    kind: "add",
    newLine: index + 1,
    text,
  }));
  const capped = capLines(lines, maxLines);
  return {
    lines: capped.lines,
    added: lines.length,
    removed: 0,
    truncated: capped.truncated,
    hiddenLineCount: capped.hiddenLineCount,
  };
}

/**
 * Build an inline diff straight from a tool call's name + args, or `undefined`
 * if the tool isn't a diff-producing writer or the args don't carry usable data.
 * The diff strategy comes from the catalog's `diffSource`, so a new diff tool
 * only declares it there — this function needs no change.
 */
export function inlineDiffFromToolArgs(
  name: string,
  args: unknown,
  options: InlineDiffOptions = {},
): InlineDiff | undefined {
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : undefined;
  if (!record) {
    return undefined;
  }

  const diffSource = getToolUiMeta(name)?.diffSource;

  if (diffSource === "edits") {
    const edits = readEdits(record);
    if (edits.length === 0) {
      return undefined;
    }
    return computeEditInlineDiff(edits, options);
  }

  if (diffSource === "newFile") {
    if (typeof record.content !== "string") {
      return undefined;
    }
    return computeWriteInlineDiff(record.content, options);
  }

  return undefined;
}

/** The workspace-relative or absolute path a diff tool targeted, if present. */
export function toolTargetPath(args: unknown): string | undefined {
  if (args && typeof args === "object") {
    const path = (args as Record<string, unknown>).path;
    if (typeof path === "string" && path.trim()) {
      return path;
    }
  }
  return undefined;
}

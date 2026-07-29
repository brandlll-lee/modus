import type { ContextItem, MessageContextChip } from "./contracts";

/** Compact L9 / L9-17 label from a 1-based inclusive line range. */
export function formatFileLineRange(range?: {
  fromLine?: number;
  toLine?: number;
}): string | undefined {
  if (range?.fromLine === undefined) {
    return undefined;
  }
  const from = range.fromLine;
  const to = range.toLine ?? from;
  return from === to ? `L${from}` : `L${from}-${to}`;
}

function chipBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Display-only chip for a sent user message (and optimistic preview). */
export function contextChipFor(item: ContextItem): MessageContextChip | undefined {
  switch (item.type) {
    case "file": {
      const lines = formatFileLineRange(item.range);
      return {
        kind: "file",
        label: chipBasename(item.path),
        ...(lines ? { detail: lines } : {}),
      };
    }
    case "folder":
      return { kind: "folder", label: `${chipBasename(item.path)}/` };
    case "doc":
      return { kind: "doc", label: item.title };
    case "terminal":
      return { kind: "terminal", label: `terminal:${item.terminalId.slice(0, 6)}` };
    case "browser":
      return { kind: "browser", label: "browser" };
    case "git-diff":
      return { kind: "git-diff", label: item.mode === "branch" ? "Branch" : "working diff" };
    case "past-chat":
      return { kind: "past-chat", label: item.title };
    case "project-summary":
      return { kind: "project-summary", label: "project summary" };
    case "recent-changes":
      return { kind: "recent-changes", label: "recent changes" };
    case "rules":
      return { kind: "rules", label: "project rules" };
    case "search":
      return { kind: "search", label: `search:${item.query}` };
    case "design-element": {
      const el = item.element;
      const text = el.text
        ? ` "${el.text.length > 24 ? `${el.text.slice(0, 23)}…` : el.text}"`
        : "";
      const detail = el.source ? `${el.source.file}:${el.source.line}` : el.domPath;
      return {
        kind: "design-element",
        label: `${el.label}${text}`,
        detail,
        ...(el.color ? { color: el.color } : {}),
      };
    }
    case "design-annotation": {
      const annotation = item.annotation;
      return {
        kind: "design-annotation",
        label: annotation.label,
        detail: `${Math.round(annotation.rect.width)}×${Math.round(annotation.rect.height)}`,
        ...(annotation.color ? { color: annotation.color } : {}),
      };
    }
    case "excerpt":
      return {
        kind: "excerpt",
        label: chipBasename(item.path),
        ...(item.locator ? { detail: item.locator } : {}),
      };
  }
  // Persisted/unknown context kinds (e.g. removed Preview Design Mode
  // `document-region`) must not become `undefined` array holes → JSON `null`.
  return undefined;
}

export function buildContextChips(items: ContextItem[]): MessageContextChip[] {
  return items.flatMap((item) => {
    const chip = contextChipFor(item);
    return chip ? [chip] : [];
  });
}

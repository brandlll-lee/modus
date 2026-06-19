import {
  IconBook2,
  IconFileText,
  IconFolder,
  IconGitBranch,
  IconListSearch,
  IconMessage2,
  IconNotebook,
  IconReportSearch,
  IconSearch,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ContextItem } from "../../../../shared/contracts";
import { iconForPath } from "../diff/fileIcon";

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Icon + display label for a context item — the single source for both the
 * inline editor atom and any chip rendering. */
export function tokenMeta(item: ContextItem): { icon: ReactNode; label: string } {
  const props = { size: 13, stroke: 1.7 } as const;
  switch (item.type) {
    case "file":
      return { icon: iconForPath(item.path, props), label: basename(item.path) };
    case "folder":
      return { icon: <IconFolder {...props} />, label: `${basename(item.path)}/` };
    case "doc":
      return { icon: <IconBook2 {...props} />, label: item.title };
    case "terminal":
      return {
        icon: <IconTerminal2 {...props} />,
        label: `terminal:${item.terminalId.slice(0, 6)}`,
      };
    case "browser":
      return { icon: <IconWorld {...props} />, label: "Browser" };
    case "git-diff":
      return {
        icon: <IconGitBranch {...props} />,
        label: item.mode === "branch" ? "Branch" : "Working diff",
      };
    case "past-chat":
      return { icon: <IconMessage2 {...props} />, label: item.title };
    case "project-summary":
      return { icon: <IconReportSearch {...props} />, label: "Project summary" };
    case "recent-changes":
      return { icon: <IconListSearch {...props} />, label: "Recent changes" };
    case "rules":
      return { icon: <IconNotebook {...props} />, label: "Project rules" };
    case "search":
      return { icon: <IconSearch {...props} />, label: `search:${item.query}` };
    default:
      return { icon: <IconFileText {...props} />, label: "context" };
  }
}

/**
 * Inline atom content (icon · label) rendered to static markup for the
 * contenteditable editor. Accent-colored, baseline-aligned with the text so it
 * reads as part of the line (Cursor parity).
 */
export function TokenContent({ item }: { item: ContextItem }) {
  const meta = tokenMeta(item);
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1 align-[-0.15em] text-focus-ring">
      <span className="inline-flex">{meta.icon}</span>
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

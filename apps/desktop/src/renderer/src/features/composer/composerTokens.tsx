import {
  IconBook2,
  IconCube,
  IconFileText,
  IconFolder,
  IconGitBranch,
  IconListSearch,
  IconMessage2,
  IconNotebook,
  IconPointer,
  IconReportSearch,
  IconSearch,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ContextItem, SkillSelection } from "../../../../shared/contracts";
import { materialIconForFile } from "../files/fileIcons";

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function fileTokenIcon(path: string): ReactNode {
  const iconUrl = materialIconForFile(path);
  return iconUrl ? (
    <img alt="" className="size-[13px]" draggable={false} src={iconUrl} />
  ) : (
    <IconFileText size={13} stroke={1.7} />
  );
}

/** Icon + display label for a context item — the single source for both the
 * inline editor atom and any chip rendering. */
export function tokenMeta(item: ContextItem): { icon: ReactNode; label: string } {
  const props = { size: 13, stroke: 1.7 } as const;
  switch (item.type) {
    case "file":
      return { icon: fileTokenIcon(item.path), label: basename(item.path) };
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
    case "design-element":
      return {
        icon: <IconPointer {...props} />,
        label: item.element.componentName || item.element.tagName || item.element.label,
      };
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
    <span className="inline-flex max-w-[220px] items-center gap-1 align-[-0.15em] text-[#2f8edb]">
      <span className="inline-flex">{meta.icon}</span>
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

export function SkillTokenContent({ skill }: { skill: SkillSelection }) {
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1 align-[-0.15em] text-[#2f8edb]">
      <span className="inline-flex">
        <IconCube size={13} stroke={1.7} />
      </span>
      <span className="truncate">{skill.name}</span>
    </span>
  );
}

export function contextItemKey(item: ContextItem): string {
  if (item.type === "file" || item.type === "folder") {
    return `${item.type}:${item.path}`;
  }

  if (item.type === "doc") {
    return `doc:${item.docId}`;
  }

  if (item.type === "terminal") {
    return `terminal:${item.terminalId}:${item.range?.fromLine ?? ""}:${item.range?.toLine ?? ""}`;
  }

  if (item.type === "git-diff") {
    return `git-diff:${item.mode}:${item.base ?? ""}`;
  }

  if (item.type === "recent-changes") {
    return `recent-changes:${item.limit ?? ""}`;
  }

  if (item.type === "search") {
    return `search:${item.query}`;
  }

  if (item.type === "design-element") {
    return `design-element:${item.element.id}`;
  }

  return item.type;
}

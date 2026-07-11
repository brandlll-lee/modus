import {
  IconBook2,
  IconCube,
  IconFileText,
  IconFolder,
  IconGitBranch,
  IconListSearch,
  IconMessage2,
  IconNotebook,
  IconPencil,
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

/** Same inspect glyph as Design Mode's in-page chip (corner brackets + pointer). */
export function InspectGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M5 3a2 2 0 0 0-2 2" />
      <path d="M19 3a2 2 0 0 1 2 2" />
      <path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h1" />
      <path d="M9 21h2" />
      <path d="M14 3h1" />
      <path d="M3 9v1" />
      <path d="M21 9v2" />
      <path d="M3 14v1" />
      <path d="m12 12 4 10 1.7-4.3L22 16Z" />
    </svg>
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
        icon: <InspectGlyph />,
        label: item.element.componentName || item.element.tagName || item.element.label,
      };
    case "design-annotation":
      return { icon: <IconPencil {...props} />, label: item.annotation.label };
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
  const markColor =
    item.type === "design-element"
      ? item.element.color
      : item.type === "design-annotation"
        ? item.annotation.color
        : undefined;
  return (
    <span
      className="inline-flex max-w-[220px] items-center gap-1 align-[-0.15em] text-link"
      style={markColor ? { color: markColor } : undefined}
    >
      <span className="inline-flex">{meta.icon}</span>
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

export function SkillTokenContent({ skill }: { skill: SkillSelection }) {
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1 align-[-0.15em] text-link">
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

  if (item.type === "design-annotation") {
    return `design-annotation:${item.annotation.id}`;
  }

  return item.type;
}

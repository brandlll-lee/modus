import { IconCube, IconFileText, IconFolder } from "@tabler/icons-react";
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

/**
 * Inline atom content (icon · label) rendered to static markup for the
 * contenteditable editor. Accent-colored, baseline-aligned with the text so it
 * reads as part of the line (Cursor parity).
 */
export function TokenContent({ item }: { item: ContextItem }) {
  const meta = tokenMeta(item);

  return (
    <span className="inline-flex max-w-[260px] items-center gap-1 align-[-0.15em] text-link">
      <span className="inline-flex">{meta.icon}</span>
      <span className="truncate">{meta.label}</span>
      {meta.detail ? (
        <span className="shrink-0 font-normal text-fg-muted">{meta.detail}</span>
      ) : null}
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

export function tokenMeta(item: ContextItem) {
  return {
    icon: item.type === "folder" ? <IconFolder size={13} /> : fileTokenIcon(item.path),
    label: basename(item.path),
    detail: item.path,
  };
}
export function contextItemKey(item: ContextItem): string {
  return `${item.type}:${item.path}`;
}

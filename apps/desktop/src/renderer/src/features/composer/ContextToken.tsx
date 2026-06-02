import {
  IconBook2,
  IconFileText,
  IconFolder,
  IconGitBranch,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ContextItem } from "../../../../shared/contracts";

type ContextTokenProps = {
  item: ContextItem;
  onRemove(): void;
};

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function tokenMeta(item: ContextItem): {
  icon: ReactNode;
  label: string;
} {
  if (item.type === "file") {
    return { icon: <IconFileText size={12} stroke={1.7} />, label: basename(item.path) };
  }

  if (item.type === "folder") {
    return { icon: <IconFolder size={12} stroke={1.7} />, label: `${basename(item.path)}/` };
  }

  if (item.type === "doc") {
    return { icon: <IconBook2 size={12} stroke={1.7} />, label: item.title };
  }

  if (item.type === "terminal") {
    return {
      icon: <IconTerminal2 size={12} stroke={1.7} />,
      label: `terminal:${item.terminalId.slice(0, 6)}`,
    };
  }

  return { icon: <IconGitBranch size={12} stroke={1.7} />, label: "working diff" };
}

export function ContextToken({ item, onRemove }: ContextTokenProps) {
  const meta = tokenMeta(item);

  return (
    <button
      className="flex h-6 max-w-[180px] items-center gap-1 rounded-md bg-white/6 px-1.5 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
      onClick={onRemove}
      title="Remove context"
      type="button"
    >
      <span className="shrink-0 text-fg-faint">{meta.icon}</span>
      <span className="truncate">{meta.label}</span>
      <IconX className="shrink-0 text-fg-faint" size={11} stroke={1.7} />
    </button>
  );
}

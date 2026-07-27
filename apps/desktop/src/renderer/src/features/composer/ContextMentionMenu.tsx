import {
  IconBook2,
  IconChevronRight,
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
import { Fragment } from "react";
import type { ContextKind } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";
import { materialIconForFile } from "../files/fileIcons";
import type { MentionRow } from "./useComposerMentions";

type ContextMentionMenuProps = {
  rows: MentionRow[];
  activeIndex: number;
  onSelect(row: MentionRow): void;
  onHover(index: number): void;
};

function iconForKind(kind: ContextKind) {
  const props = { size: 15, stroke: 1.6 } as const;
  switch (kind) {
    case "folder":
      return <IconFolder {...props} />;
    case "doc":
      return <IconBook2 {...props} />;
    case "terminal":
      return <IconTerminal2 {...props} />;
    case "browser":
      return <IconWorld {...props} />;
    case "git-diff":
      return <IconGitBranch {...props} />;
    case "past-chat":
      return <IconMessage2 {...props} />;
    case "project-summary":
      return <IconReportSearch {...props} />;
    case "recent-changes":
      return <IconListSearch {...props} />;
    case "rules":
      return <IconNotebook {...props} />;
    case "search":
      return <IconSearch {...props} />;
    default:
      return <IconFileText {...props} />;
  }
}

function fileRowIcon(path: string) {
  const iconUrl = materialIconForFile(path);
  return iconUrl ? (
    <img alt="" className="size-[15px]" draggable={false} src={iconUrl} />
  ) : (
    <IconFileText size={15} stroke={1.6} />
  );
}

/** Colored file-type glyph for file rows; otherwise the kind glyph. */
function rowIcon(row: Extract<MentionRow, { row: "add" | "nav" }>) {
  if (row.row === "add" && row.item.type === "file") {
    return fileRowIcon(row.item.path);
  }
  return iconForKind(row.icon);
}

export function ContextMentionMenu({
  rows,
  activeIndex,
  onSelect,
  onHover,
}: ContextMentionMenuProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="scroll-thin absolute bottom-full left-1 z-20 mb-2 max-h-[336px] w-[340px] max-w-[calc(100%-0.5rem)] overflow-y-auto popup-chrome p-1">
      {rows.map((row, index) => {
        if (row.row === "header") {
          return (
            <div className="px-2 pt-1.5 pb-1 text-2xs text-fg-faint" key={row.id}>
              {row.label}
            </div>
          );
        }

        // A hairline divides the direct-add/file rows from the drill-in rows
        // (Cursor parity) — drawn above the first nav row.
        const prev = rows[index - 1];
        const divider = row.row === "nav" && prev !== undefined && prev.row !== "nav";
        const active = index === activeIndex;

        if (row.row === "more") {
          return (
            <button
              className={cn(
                "flex h-8 w-full items-center rounded-md px-2.5 text-left text-xs text-fg-faint transition-colors",
                active && "bg-hover text-fg-muted",
              )}
              key={row.id}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(row);
              }}
              onMouseMove={() => onHover(index)}
              type="button"
            >
              {row.label}
            </button>
          );
        }

        const detail = row.row === "add" ? row.detail : undefined;
        return (
          <Fragment key={row.id}>
            {divider ? <div className="mx-1 my-1 h-px bg-hairline-soft" /> : null}
            <button
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 text-left transition-colors",
                detail ? "py-1.5" : "h-9",
                active && "bg-hover",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(row);
              }}
              onMouseMove={() => onHover(index)}
              type="button"
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-fg-subtle">
                {rowIcon(row)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg text-sm leading-tight">{row.label}</span>
                {detail ? (
                  <span className="mt-0.5 block truncate text-2xs text-fg-faint leading-tight">
                    {detail}
                  </span>
                ) : null}
              </span>
              {row.row === "nav" ? (
                <IconChevronRight className="shrink-0 text-fg-faint" size={14} stroke={1.8} />
              ) : null}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

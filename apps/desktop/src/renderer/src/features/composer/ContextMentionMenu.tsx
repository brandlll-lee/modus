import { IconFileText, IconFolder } from "@tabler/icons-react";
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
  return kind === "folder" ? (
    <IconFolder size={15} stroke={1.6} />
  ) : (
    <IconFileText size={15} stroke={1.6} />
  );
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
function rowIcon(row: MentionRow) {
  if (row.item.type === "file") {
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
        const active = index === activeIndex;

        const detail = row.detail;
        return (
          <button
            key={row.id}
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
          </button>
        );
      })}
    </div>
  );
}

import { IconCube, IconTerminal2 } from "@tabler/icons-react";
import { cn } from "../../lib/cn";
import type { SlashItem } from "./useComposerSlash";

type SlashMenuProps = {
  items: SlashItem[];
  activeIndex: number;
  onSelect(item: SlashItem): void;
};

export function SlashMenu({ items, activeIndex, onSelect }: SlashMenuProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="scroll-thin absolute right-3 bottom-full left-3 z-20 mb-3 max-h-[320px] overflow-y-auto popup-chrome p-1">
      {items.map((item, index) => {
        const showSectionHeader = item.kind !== "action" && items[index - 1]?.kind !== item.kind;
        const scopeLabel =
          item.kind === "skill" ? (item.skill.scope === "user" ? "Personal" : "Workspace") : null;
        return (
          <div key={item.key}>
            {showSectionHeader ? (
              <p className="px-2 pt-2 pb-1 text-xs text-fg-faint">
                {item.kind === "skill" ? "Skills" : "Commands"}
              </p>
            ) : null}
            <button
              className={cn(
                "grid min-h-8 w-full grid-cols-[22px_minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors disabled:opacity-45",
                index === activeIndex ? "bg-hover" : "hover:bg-hover",
              )}
              disabled={item.kind === "action" && item.disabled}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
              type="button"
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-fg-faint">
                {item.kind === "action" ? (
                  item.leading
                ) : item.kind === "skill" ? (
                  <IconCube size={15} stroke={1.7} />
                ) : (
                  <IconTerminal2 size={14} stroke={1.6} />
                )}
              </span>
              <span className="truncate text-sm text-fg">{item.name}</span>
              <span className="min-w-0 truncate text-xs text-fg-faint">{item.description}</span>
              {scopeLabel ? (
                <span className="shrink-0 text-xs text-fg-faint">{scopeLabel}</span>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

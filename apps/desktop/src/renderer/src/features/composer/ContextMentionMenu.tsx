import {
  IconBook2,
  IconFileText,
  IconFolder,
  IconGitBranch,
  IconListSearch,
  IconNotebook,
  IconReportSearch,
  IconSearch,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import type { ContextKind, ContextSuggestion } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

type ContextMentionMenuProps = {
  suggestions: ContextSuggestion[];
  activeIndex: number;
  onSelect(suggestion: ContextSuggestion): void;
};

function iconForType(type: ContextKind) {
  if (type === "folder") {
    return <IconFolder size={14} stroke={1.6} />;
  }

  if (type === "doc") {
    return <IconBook2 size={14} stroke={1.6} />;
  }

  if (type === "terminal") {
    return <IconTerminal2 size={14} stroke={1.6} />;
  }

  if (type === "browser") {
    return <IconWorld size={14} stroke={1.6} />;
  }

  if (type === "git-diff") {
    return <IconGitBranch size={14} stroke={1.6} />;
  }

  if (type === "project-summary") {
    return <IconReportSearch size={14} stroke={1.6} />;
  }

  if (type === "recent-changes") {
    return <IconListSearch size={14} stroke={1.6} />;
  }

  if (type === "rules") {
    return <IconNotebook size={14} stroke={1.6} />;
  }

  if (type === "search") {
    return <IconSearch size={14} stroke={1.6} />;
  }

  return <IconFileText size={14} stroke={1.6} />;
}

export function ContextMentionMenu({
  suggestions,
  activeIndex,
  onSelect,
}: ContextMentionMenuProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="absolute right-3 bottom-[42px] left-3 z-20 overflow-hidden rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
      {suggestions.map((suggestion, index) => (
        <button
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors",
            index === activeIndex ? "bg-hover" : "hover:bg-hover",
          )}
          key={suggestion.id}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(suggestion);
          }}
          type="button"
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-fg-faint">
            {iconForType(suggestion.type)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-fg-muted">{suggestion.label}</span>
            <span className="block truncate text-2xs text-fg-faint">{suggestion.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

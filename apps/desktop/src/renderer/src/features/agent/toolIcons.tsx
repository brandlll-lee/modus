import {
  IconFile,
  IconFolder,
  IconPencil,
  IconSearch,
  IconTerminal2,
  IconTool,
  IconWorld,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { getToolUiMeta, type ToolIconName } from "../../../../shared/tools";
import { cn } from "../../lib/cn";

/** Session-scoped: one failed host never retries (shared by tool rows + markdown). */
const failedHosts = new Set<string>();

const ACTION_ICONS = {
  file: IconFile,
  folder: IconFolder,
  edit: IconPencil,
  search: IconSearch,
  terminal: IconTerminal2,
  tool: IconTool,
  globe: IconWorld,
  favicon: IconWorld,
};

export function toolIcon(name: ToolIconName): ReactNode {
  const Icon = ACTION_ICONS[name];
  return <Icon aria-hidden size={16} stroke={1.7} />;
}

export function toolActionIcon(name: string): ReactNode {
  const meta = getToolUiMeta(name);
  return toolIcon(
    meta?.iconName ??
      (meta?.render === "diff" ? "edit" : meta?.render === "terminal" ? "terminal" : "tool"),
  );
}

/** The site's favicon for an external URL, falling back to a globe. */
export function Favicon({ url, className }: { url: string; className?: string }) {
  const host = hostname(url);
  const [failed, setFailed] = useState(() => (host ? failedHosts.has(host) : true));
  if (!host || failed) {
    return <IconWorld className={className} size={14} stroke={1.7} />;
  }
  return (
    <img
      alt=""
      className={cn("size-3.5 shrink-0 rounded-sm", className)}
      loading="lazy"
      decoding="async"
      onError={() => {
        failedHosts.add(host);
        setFailed(true);
      }}
      src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
    />
  );
}

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

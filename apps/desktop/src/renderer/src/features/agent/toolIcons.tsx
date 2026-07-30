import { IconWorld } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { cn } from "../../lib/cn";
import type { ToolIconName } from "../../../../shared/tools";

/** Session-scoped: one failed host never retries (shared by tool rows + markdown). */
const failedHosts = new Set<string>();

/**
 * Leading icon for a tool row. Only web tools declare one: a globe for web
 * search, and the target site's favicon for web fetch — so the row shows WHICH
 * site was read. Every other row leads with its bold verb, no icon.
 */
export function toolIcon(name: ToolIconName, target?: string): ReactNode {
  if (name === "favicon") {
    // Keyed by URL so a new target resets a previous load failure.
    return <Favicon key={target ?? ""} url={target ?? ""} />;
  }
  return <IconWorld size={14} stroke={1.7} />;
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

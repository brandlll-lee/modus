import { IconChevronRight } from "@tabler/icons-react";
import { type ReactNode, useId, useState } from "react";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";

export function ActionRow({
  icon,
  label,
  target,
  detail,
  active = false,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  target?: string | undefined;
  detail?: string | undefined;
  active?: boolean;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const expandable = !!detail?.trim();
  const body = (
    <>
      <span className="action-icon">{icon}</span>
      {active ? (
        <ShinyText className="min-w-0 truncate">{label}</ShinyText>
      ) : (
        <span className={cn("shrink-0", danger ? "text-danger" : "text-fg-subtle")}>{label}</span>
      )}
      {target ? (
        <span className="min-w-0 flex-1 truncate" title={target}>
          {target}
        </span>
      ) : null}
      {expandable ? (
        <IconChevronRight
          aria-hidden
          size={13}
          stroke={1.7}
          className={cn(
            "shrink-0 text-fg-faint transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      ) : null}
    </>
  );
  return (
    <div className="min-w-0 text-sm font-medium">
      {expandable ? (
        <button
          aria-controls={contentId}
          aria-expanded={open}
          className="flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left text-fg-subtle transition-colors hover:text-fg-muted"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-2 py-0.5 text-fg-subtle">{body}</div>
      )}
      <CollapsibleMotion id={contentId} open={open && expandable} preset="timeline">
        <pre
          className={cn(
            "scroll-thin mt-1 max-h-72 overflow-auto rounded-md border border-hairline bg-card px-3 py-2 whitespace-pre-wrap wrap-break-word text-xs text-fg-muted leading-relaxed",
            danger && "border-danger/25 text-danger/90",
          )}
        >
          {detail}
        </pre>
      </CollapsibleMotion>
    </div>
  );
}

import type { ReactNode } from "react";
import { ToolbarButton } from "./ToolbarButton";

export type ResourceRowAction = {
  label: string;
  icon: ReactNode;
  onClick(): void;
};

export function ResourceRow({
  action,
  description,
  leading,
  meta,
  title,
}: {
  action?: ResourceRowAction;
  description?: string;
  leading?: ReactNode;
  meta?: ReactNode;
  title: string;
}) {
  return (
    <div className="flex min-h-12 min-w-0 items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-hover">
      {leading ? <div className="flex shrink-0 items-center pt-0.5">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-fg">{title}</p>
        {description ? (
          <p className="mt-0.5 break-words text-sm text-fg-muted">{description}</p>
        ) : null}
        {meta ? <div className="mt-1 break-all text-xs text-fg-faint">{meta}</div> : null}
      </div>
      {action ? (
        <ToolbarButton label={action.label} onClick={action.onClick}>
          {action.icon}
        </ToolbarButton>
      ) : null}
    </div>
  );
}

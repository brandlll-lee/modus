import type { ComponentPropsWithRef } from "react";
import { cn } from "../../lib/cn";
import { Tooltip } from "./Tooltip";

export const TOOLBAR_ICON = { size: 15, stroke: 1.5 } as const;

type ToolbarButtonProps = ComponentPropsWithRef<"button"> & {
  label: string;
  active?: boolean;
};

export function ToolbarButton({
  children,
  label,
  active = false,
  className,
  ...props
}: ToolbarButtonProps) {
  return (
    <Tooltip content={label}>
      <button
        {...props}
        aria-label={label}
        aria-pressed={active || undefined}
        className={cn(
          "toolbar-icon-button app-no-drag inline-flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40",
          active && "bg-active",
          className,
        )}
        data-active={active}
        type={props.type ?? "button"}
      >
        {children}
      </button>
    </Tooltip>
  );
}

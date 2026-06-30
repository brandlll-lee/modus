import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Tooltip } from "./Tooltip";

type ToolbarButtonProps = {
  children: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

/**
 * Shared 32px icon button for chrome toggles (header panel toggles, sidebar
 * collapse). One definition → identical look, hover, tooltip, and tokens
 * everywhere, so the left/right panel controls stay perfectly symmetric and
 * theme-adaptive (colors come from `--color-*` tokens, so dark/light just work).
 */
export function ToolbarButton({
  children,
  label,
  active = false,
  disabled = false,
  onClick,
}: ToolbarButtonProps) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className={cn(
          "toolbar-icon-button app-no-drag flex items-center justify-center rounded-md transition-colors hover:bg-hover",
          active && "bg-active",
          disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
        )}
        data-active={active}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}

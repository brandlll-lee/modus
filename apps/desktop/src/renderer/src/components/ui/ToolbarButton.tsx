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
 * Shared 28px icon button for chrome toggles (header panel toggles, sidebar
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
          "app-no-drag flex size-7 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-fg-subtle",
          active ? "bg-active text-fg-subtle" : "text-fg-faint",
          disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-fg-faint",
        )}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}

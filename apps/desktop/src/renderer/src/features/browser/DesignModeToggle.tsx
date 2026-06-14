import { IconPointer, IconX } from "@tabler/icons-react";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";

type DesignModeToggleProps = {
  active: boolean;
  disabled?: boolean;
  onToggle(): void;
};

/**
 * Design Mode switch in the browser toolbar. Two visual states, matching the
 * reference: a quiet pen/pointer icon button when off (tooltip "Design Mode" +
 * the Ctrl+Shift+D shortcut), and a brand-tinted pill — icon + "Design" + ✕ —
 * when on. All colors come from Modus theme tokens so it adapts to light/dark.
 */
export function DesignModeToggle({ active, disabled = false, onToggle }: DesignModeToggleProps) {
  if (active) {
    return (
      <button
        aria-label="Exit Design Mode"
        aria-pressed
        className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-focus-ring/30 bg-focus-ring/12 pr-1 pl-2 text-focus-ring transition-colors hover:bg-focus-ring/20"
        onClick={onToggle}
        type="button"
      >
        <IconPointer size={14} stroke={1.8} />
        <span className="text-xs font-medium">Design</span>
        <IconX className="opacity-80" size={13} stroke={2} />
      </button>
    );
  }

  return (
    <Tooltip
      content={
        <span className="flex items-center gap-1.5">
          Design Mode
          <kbd className="rounded bg-chip-strong px-1 py-px text-2xs text-fg-faint">
            Ctrl Shift D
          </kbd>
        </span>
      }
      side="bottom"
    >
      <button
        aria-label="Design Mode"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors",
          "hover:bg-hover hover:text-fg-subtle",
          disabled && "cursor-not-allowed opacity-35 hover:bg-transparent hover:text-fg-faint",
        )}
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        <IconPointer size={15} stroke={1.65} />
      </button>
    </Tooltip>
  );
}

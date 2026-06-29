import type { CSSProperties } from "react";
import { cn } from "../../lib/cn";

type ShineBorderProps = {
  /** Border width in px. */
  borderWidth?: number;
  /** Animation duration in seconds. */
  duration?: number;
  /** CSS color or comma-separated color stops for the radial shine. */
  shineColor?: string;
  className?: string;
};

export function ShineBorder({
  borderWidth = 1,
  duration = 11,
  shineColor = "var(--color-composer-shine)",
  className,
}: ShineBorderProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "modus-shine-border pointer-events-none absolute inset-0 rounded-[inherit]",
        className,
      )}
      style={
        {
          "--shine-border-width": `${borderWidth}px`,
          "--shine-duration": `${duration}s`,
          backgroundImage: `radial-gradient(transparent, transparent, ${shineColor}, transparent, transparent)`,
        } as CSSProperties
      }
    />
  );
}

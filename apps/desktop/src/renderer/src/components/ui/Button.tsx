import type { ComponentPropsWithRef } from "react";
import { cn } from "../../lib/cn";

export function Button({
  className,
  variant = "secondary",
  ...props
}: ComponentPropsWithRef<"button"> & { variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-fg text-canvas hover:bg-fg-muted",
        variant === "secondary" && "border border-hairline bg-surface text-fg hover:bg-hover",
        variant === "ghost" && "text-fg-muted hover:bg-hover hover:text-fg",
        className,
      )}
    />
  );
}

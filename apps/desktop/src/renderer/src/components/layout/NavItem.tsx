import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "../../lib/cn";

export function NavItem({
  active,
  icon,
  children,
  className,
  ...props
}: ComponentPropsWithRef<"button"> & {
  active?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      {...props}
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
        active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
        className,
      )}
    >
      {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

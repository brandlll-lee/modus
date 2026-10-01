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
        "navigation-row text-left",
        active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
        className,
      )}
    >
      {icon ? <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

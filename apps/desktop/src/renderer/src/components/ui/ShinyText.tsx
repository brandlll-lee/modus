import { cn } from "../../lib/cn";

type ShinyTextProps = {
  children: string;
  className?: string;
};

export function ShinyText({ children, className }: ShinyTextProps) {
  return (
    <span className={cn("shiny-text relative inline-block text-fg-subtle", className)}>
      {children}
      <span className="shiny-text-beam" aria-hidden="true">
        <span className="shiny-text-beam-text">{children}</span>
      </span>
    </span>
  );
}

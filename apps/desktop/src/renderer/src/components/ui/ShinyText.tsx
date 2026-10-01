import { cn } from "../../lib/cn";

type ShinyTextProps = {
  children: string;
  className?: string;
};

export function ShinyText({ children, className }: ShinyTextProps) {
  return (
    <span className={cn("shiny-text inline-block text-fg-subtle", className)}>{children}</span>
  );
}

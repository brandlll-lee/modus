import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** 面板小标题栏，右侧可放操作按钮（正常大小写、无分隔线、不加粗）。 */
export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between px-3">
      <h2 className="text-sm font-normal text-fg-subtle">{title}</h2>
      {children}
    </div>
  );
}

/**
 * Inspector empty hero — layout matches Git Review (icon + hint + optional CTA).
 * Pass icons at size={22} stroke={1.4}.
 */
export function EmptyState({
  icon,
  hint,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  hint: string;
  description?: string;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-3 px-6 text-center",
        className,
      )}
    >
      <span className="text-fg-faint">{icon}</span>
      <span className="text-fg-subtle text-xs">{hint}</span>
      {description ? <span className="text-fg-faint text-xs">{description}</span> : null}
      {action}
    </div>
  );
}

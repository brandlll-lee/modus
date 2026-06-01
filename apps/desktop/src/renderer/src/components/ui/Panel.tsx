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

/** 空状态占位。 */
export function EmptyState({
  icon,
  hint,
  className,
}: {
  icon: ReactNode;
  hint: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="text-fg-faint">{icon}</span>
      <span className="text-xs text-fg-subtle">{hint}</span>
    </div>
  );
}

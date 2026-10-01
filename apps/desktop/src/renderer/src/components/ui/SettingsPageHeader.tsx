import type { ReactNode } from "react";

export function SettingsPageHeader({
  actions,
  description,
  title,
}: {
  actions?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-5 pb-5">
      <div className="min-w-0">
        <h1 className="text-[28px] font-medium leading-tight text-fg">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-[62ch] text-sm text-fg-subtle">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

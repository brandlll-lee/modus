import type { ReactNode } from "react";

export function SettingsSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsList({ children }: { children: ReactNode }) {
  return <div className="settings-list">{children}</div>;
}

export function SettingsRow({
  control,
  description,
  title,
}: {
  control: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="settings-row">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg">{title}</div>
        {description ? <div className="mt-1 text-xs text-fg-subtle">{description}</div> : null}
      </div>
      <div className="min-w-0 shrink-0">{control}</div>
    </div>
  );
}

export function ReadOnlyPill({ children }: { children: string }) {
  return <span className="rounded-md bg-chip px-2.5 py-1 text-xs text-fg-muted">{children}</span>;
}

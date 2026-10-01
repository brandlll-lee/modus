import type { ReactNode } from "react";
export function ComposerDock({ rails, children }: { rails?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {rails ? <div className="divide-y divide-hairline-soft">{rails}</div> : null}
      {children}
    </div>
  );
}

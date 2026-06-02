import { IconShieldLock } from "@tabler/icons-react";
import type { PermissionRequest } from "../../../../shared/contracts";

type PermissionCardProps = {
  request: PermissionRequest;
};

export function PermissionCard({ request }: PermissionCardProps) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-danger/15 text-danger">
        <IconShieldLock size={13} stroke={1.7} />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2">
        <div className="mb-1 text-xs text-danger">{request.action}</div>
        <div className="truncate font-mono text-2xs text-fg-muted">{request.target}</div>
        <div className="mt-1 text-xs text-fg-subtle">{request.reason}</div>
      </div>
    </div>
  );
}

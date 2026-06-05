import { IconShieldLock } from "@tabler/icons-react";
import type { PermissionDecision, PermissionRequest } from "../../../../shared/contracts";

type PermissionCardProps = {
  request: PermissionRequest;
  decision?: PermissionDecision["decision"] | undefined;
  onDecide?(request: PermissionRequest, decision: "allow-once" | "allow-workspace" | "deny"): void;
};

function decisionLabel(decision: PermissionDecision["decision"]): string {
  if (decision === "allow-once") return "Allowed once";
  if (decision === "allow-workspace") return "Always allowed";
  return "Denied";
}

export function PermissionCard({ decision, onDecide, request }: PermissionCardProps) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-danger/15 text-danger">
        <IconShieldLock size={13} stroke={1.7} />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2">
        <div className="mb-1 text-xs text-danger">{request.action}</div>
        <div className="truncate font-mono text-2xs text-fg-muted">{request.target}</div>
        <div className="mt-1 text-xs text-fg-subtle">{request.reason}</div>
        {decision ? (
          <div className="mt-2 text-2xs text-fg-faint">{decisionLabel(decision)}</div>
        ) : null}
        {onDecide && !decision ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              className="rounded-md border border-hairline px-2 py-1 text-2xs text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              onClick={() => onDecide(request, "allow-once")}
              type="button"
            >
              Allow once
            </button>
            <button
              className="rounded-md border border-hairline px-2 py-1 text-2xs text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              onClick={() => onDecide(request, "allow-workspace")}
              type="button"
            >
              Always allow
            </button>
            <button
              className="rounded-md border border-danger/30 px-2 py-1 text-2xs text-danger transition-colors hover:bg-danger/10"
              onClick={() => onDecide(request, "deny")}
              type="button"
            >
              Deny
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

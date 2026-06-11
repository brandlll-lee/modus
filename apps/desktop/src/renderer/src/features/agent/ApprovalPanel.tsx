import { IconCornerDownLeft, IconLock } from "@tabler/icons-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PermissionDecision, PermissionRequest } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

type ApprovalDecision = PermissionDecision["decision"];

type ApprovalPanelProps = {
  request: PermissionRequest;
  onDecide(request: PermissionRequest, decision: ApprovalDecision): Promise<void> | void;
};

type ApprovalOption = {
  decision: ApprovalDecision;
  key: string;
  title: string;
  description: string;
};

const APPROVAL_OPTIONS: ApprovalOption[] = [
  {
    decision: "allow-once",
    key: "1",
    title: "Yes, allow this time",
    description: "Run only this request, then ask again next time.",
  },
  {
    decision: "allow-workspace",
    key: "2",
    title: "Yes, always allow in this project",
    description: "Trust this action target for the current workspace.",
  },
  {
    decision: "deny",
    key: "3",
    title: "No, deny this request",
    description: "Block the tool call and let the agent continue safely.",
  },
];

export function ApprovalPanel({ onDecide, request }: ApprovalPanelProps) {
  const [selected, setSelected] = useState<ApprovalDecision>("allow-once");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const panelRef = useRef<HTMLElement | null>(null);
  const target = request.target.trim() || request.action;
  const title = useMemo(() => approvalTitle(request.action), [request.action]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  async function submit(decision: ApprovalDecision = selected): Promise<void> {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onDecide(request, decision);
    } catch (caught) {
      setSubmitting(false);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const option = APPROVAL_OPTIONS.find((item) => item.key === event.key);
    if (option) {
      event.preventDefault();
      setSelected(option.decision);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void submit("deny");
    }
  }

  return (
    <section
      aria-label="Tool approval"
      className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-composer outline-none focus-visible:shadow-composer-focus"
      onKeyDown={handleKeyDown}
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-chip text-fg-muted">
            <IconLock size={14} stroke={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-sm font-normal text-fg">{title}</h2>
              <span className="rounded bg-chip px-1.5 py-0.5 font-mono text-2xs text-fg-faint">
                {request.action}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-fg-faint">{request.reason}</p>
          </div>
        </div>

        <div className="mt-3 min-w-0 rounded-md border border-hairline-soft bg-code-bg px-3 py-2 font-mono text-[12px] text-fg wrap-break-word">
          {target}
        </div>

        <div className="mt-3 grid gap-1">
          {APPROVAL_OPTIONS.map((option) => {
            const active = selected === option.decision;
            return (
              <button
                aria-pressed={active}
                className={cn(
                  "group flex w-full min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 text-left outline-none transition-colors",
                  active
                    ? "border-hairline-strong bg-active text-fg"
                    : "border-transparent text-fg-muted hover:bg-hover hover:text-fg",
                  option.decision === "deny" && active && "border-danger/25 bg-danger/8",
                )}
                disabled={submitting}
                key={option.decision}
                onClick={() => setSelected(option.decision)}
                type="button"
              >
                <span className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-chip px-1.5 font-mono text-2xs text-fg-subtle">
                  {option.key}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm leading-snug",
                      option.decision === "deny" && active ? "text-danger" : "text-current",
                    )}
                  >
                    {option.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-fg-faint">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex min-w-0 items-center justify-end gap-2 border-hairline-soft border-t pt-3">
          {error ? <p className="min-w-0 flex-1 truncate text-xs text-danger">{error}</p> : null}
          <button
            className="flex h-8 items-center rounded-md px-3 text-sm text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-50"
            disabled={submitting}
            onClick={() => void submit("deny")}
            type="button"
          >
            Deny
          </button>
          <button
            className="flex h-8 items-center gap-1.5 rounded-md bg-focus-ring px-3 text-sm text-white transition-colors hover:bg-focus-ring-soft disabled:opacity-50"
            disabled={submitting}
            onClick={() => void submit()}
            type="button"
          >
            {submitting ? "Submitting" : "Submit"}
            <IconCornerDownLeft size={13} stroke={1.8} />
          </button>
        </div>
      </div>
    </section>
  );
}

function approvalTitle(action: PermissionRequest["action"]): string {
  if (action === "mcp.call") return "Allow using this MCP tool?";
  if (action === "shell.execute") return "Allow running this command?";
  if (action === "git.write") return "Allow changing git state?";
  if (action === "file.write") return "Allow editing files?";
  if (action === "file.delete") return "Allow deleting files?";
  return "Allow opening this external target?";
}

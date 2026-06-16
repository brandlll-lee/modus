import { Dialog } from "@base-ui/react/dialog";
import { IconCloudUpload, IconGitBranch, IconGitCommit, IconLoader2 } from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { GitStatusSummary } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

type CommitAction = "commit" | "commit-and-push" | "push";

type CommitDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  cwd: string | undefined;
  status: GitStatusSummary | undefined;
  /** Re-fetch panel state after a successful commit/push. */
  onRefresh(): void | Promise<void>;
};

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * Minimal commit/push modal: three explicit actions — Commit, Commit and push,
 * Push. There is no staging (every commit includes all changes), no pull/fetch,
 * and no branch switcher (branch viewing/switching lives in the panel header).
 * Each action calls the real `diff.commitOrPush` IPC.
 */
export function CommitDialog({ open, onOpenChange, cwd, status, onRefresh }: CommitDialogProps) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<CommitAction | undefined>();
  const [error, setError] = useState<string | undefined>();
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setMessage("");
      setError(undefined);
      setBusy(undefined);
    }
  }, [open]);

  const ahead = status?.ahead ?? 0;
  const hasUpstream = status?.hasUpstream ?? false;
  const hasRemote = status?.hasRemote ?? false;
  const changeCount = (status?.stagedCount ?? 0) + (status?.unstagedCount ?? 0);
  const canCommit = message.trim().length > 0 && changeCount > 0 && !busy;
  // Push alone is meaningful when there are local commits ahead, or no upstream yet.
  const canPushOnly = !busy && (ahead > 0 || !hasUpstream) && hasRemote;

  async function run(action: CommitAction): Promise<void> {
    if (!cwd) return;
    setBusy(action);
    setError(undefined);
    try {
      await window.modus.diff.commitOrPush({
        cwd,
        ...(action === "push" ? {} : { message: message.trim() }),
        commit: action !== "push",
        push: action !== "commit",
      });
      await onRefresh();
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  function onMessageKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit) {
      event.preventDefault();
      void run("commit");
    }
  }

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 ease-out-quint",
            "data-ending-style:opacity-0 data-starting-style:opacity-0",
          )}
        />
        <Dialog.Popup
          className={cn(
            "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-2rem))]",
            "origin-center overflow-hidden rounded-xl border border-hairline bg-elevated shadow-popup outline-none",
            "transition-[transform,opacity] duration-150 ease-out-quint",
            "data-ending-style:scale-[0.97] data-ending-style:opacity-0",
            "data-starting-style:scale-[0.97] data-starting-style:opacity-0",
          )}
          initialFocus={messageRef}
        >
          {/* Header: branch + diff stat (read-only; switching lives in the panel) */}
          <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
            <span className="flex min-w-0 items-center gap-1.5 text-fg-muted text-sm">
              <IconGitBranch className="shrink-0 text-fg-subtle" size={14} stroke={1.7} />
              <span className="max-w-[200px] truncate font-medium">
                {status?.branch ?? "detached"}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-2 font-mono text-xs">
              <span className="text-success">+{status?.added ?? 0}</span>
              <span className="text-danger">-{status?.removed ?? 0}</span>
            </div>
          </div>

          <Dialog.Title className="sr-only">Commit or push changes</Dialog.Title>

          <div className="px-4">
            <textarea
              className={cn(
                "scroll-thin h-24 w-full resize-none rounded-lg border border-hairline bg-canvas px-3 py-2.5",
                "text-sm text-fg leading-relaxed outline-none transition-colors placeholder:text-fg-faint",
                "focus:border-hairline-strong",
              )}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={onMessageKeyDown}
              placeholder="Describe your changes…"
              ref={messageRef}
              value={message}
            />
            <p className="mt-1.5 text-2xs text-fg-faint">
              Commits all {changeCount} changed file{changeCount === 1 ? "" : "s"}.
            </p>
          </div>

          {error ? (
            <div className="mx-4 mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md border border-danger/30 bg-danger/8 px-2.5 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}

          <div className="mt-3 border-hairline-soft border-t">
            <ActionRow
              busy={busy === "commit"}
              disabled={!canCommit}
              icon={<IconGitCommit size={16} stroke={1.7} />}
              label="Commit"
              onClick={() => void run("commit")}
              shortcut="Ctrl+⏎"
            />
            <ActionRow
              busy={busy === "commit-and-push"}
              disabled={!canCommit || !hasRemote}
              icon={<IconCloudUpload size={16} stroke={1.7} />}
              label="Commit and push"
              onClick={() => void run("commit-and-push")}
            />
            <ActionRow
              busy={busy === "push"}
              disabled={!canPushOnly}
              icon={<IconCloudUpload size={16} stroke={1.7} />}
              label={ahead > 0 ? `Push (${ahead})` : "Push"}
              onClick={() => void run("push")}
            />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ActionRow({
  icon,
  label,
  shortcut,
  disabled,
  busy,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  busy?: boolean;
  onClick(): void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors",
        disabled ? "cursor-not-allowed text-fg-faint" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
      disabled={disabled || busy}
      onClick={onClick}
      type="button"
    >
      <span className={cn("flex size-4 items-center justify-center", !disabled && "text-fg-subtle")}>
        {busy ? <IconLoader2 className="animate-spin" size={16} stroke={1.7} /> : icon}
      </span>
      <span className="flex-1">{label}</span>
      {shortcut ? <span className="font-mono text-2xs text-fg-faint">{shortcut}</span> : null}
    </button>
  );
}

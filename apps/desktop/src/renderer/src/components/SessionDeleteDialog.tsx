import { Dialog } from "@base-ui/react/dialog";
import { type RefObject, useState } from "react";
import type { SessionDeletionResult } from "../../../shared/contracts";
import { Button } from "./ui/Button";
import { DialogBody, DialogSurface } from "./ui/DialogSurface";

export function SessionDeleteDialog({
  title,
  onDelete,
  onClose,
  finalFocus,
}: {
  title: string;
  onDelete(): Promise<SessionDeletionResult[]>;
  onClose(): void;
  finalFocus: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<SessionDeletionResult[]>();
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await onDelete());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const trashed = result?.filter(({ method }) => method === "trash").length ?? 0;
  const deleted = result?.filter(({ method }) => method === "unlink").length ?? 0;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogSurface size="compact" finalFocus={finalFocus}>
        <header className="shrink-0 px-5 pt-5 pb-3">
          <Dialog.Title className="text-lg font-semibold">Delete sessions</Dialog.Title>
        </header>
        <DialogBody className="space-y-4 px-5">
          <p className="break-words text-sm">{title}</p>
          <Dialog.Description className="text-sm text-fg-muted">
            PI moves session files to trash when available. Otherwise, it deletes them permanently.
            This also removes them from PI CLI.
          </Dialog.Description>
          {result ? (
            <p role="status" className="text-sm text-fg-muted">
              {trashed} moved to trash. {deleted} permanently deleted.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="break-words text-sm text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <footer className="flex shrink-0 justify-end gap-2 px-5 py-4">
          <Dialog.Close render={<Button disabled={busy} />}>
            {result ? "Close" : "Cancel"}
          </Dialog.Close>
          {!result ? (
            <Button className="text-danger" disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting..." : "Delete"}
            </Button>
          ) : null}
        </footer>
      </DialogSurface>
    </Dialog.Root>
  );
}

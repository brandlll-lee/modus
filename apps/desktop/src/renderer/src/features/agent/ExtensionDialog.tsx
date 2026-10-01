import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import type { QuestionAnswer, QuestionRequest } from "../../../../shared/contracts";
import { Button } from "../../components/ui/Button";
import { DialogBody, DialogSurface } from "../../components/ui/DialogSurface";

export function ExtensionDialog({ request }: { request: QuestionRequest }) {
  const question = request.questions[0];
  const [value, setValue] = useState(question?.prefill ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(true);
  const [response, setResponse] = useState<{ selected?: string; skipped: boolean }>();
  if (!question) return null;

  function respond(selected?: string, skipped = false): void {
    if (busy || !question) return;
    setBusy(true);
    setResponse({ ...(selected !== undefined ? { selected } : {}), skipped });
    setOpen(false);
  }

  async function submitResponse(): Promise<void> {
    if (!question || !response) return;
    const { selected, skipped } = response;
    try {
      const answer: QuestionAnswer = {
        questionId: question.id,
        selected: selected === undefined ? [] : [selected],
        ...(selected === undefined ? { custom: value } : {}),
      };
      await window.modus.questions.respond({
        requestId: request.id,
        answers: skipped ? [] : [answer],
        skipped,
      });
    } catch (caught) {
      setBusy(false);
      setOpen(true);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open) respond(undefined, true);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) void submitResponse();
      }}
    >
      <DialogSurface size="compact">
        <Dialog.Title className="shrink-0 border-b border-hairline-soft p-5 break-words text-fg text-base">
          {question.header}
        </Dialog.Title>
        <DialogBody className="px-5 py-4">
          {question.detail ? (
            <Dialog.Description className="mt-2 whitespace-pre-wrap break-words text-fg-muted text-sm">
              {question.detail}
            </Dialog.Description>
          ) : null}
          {question.options.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {question.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  disabled={busy}
                  className="break-words rounded-md border border-hairline px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-hover focus-visible:outline-focus-ring"
                  onClick={() => void respond(option.label)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void respond();
              }}
            >
              <textarea
                aria-label={question.header}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={busy}
                className="min-h-24 rounded-md border border-hairline bg-surface p-3 text-sm text-fg outline-focus-ring"
              />
              <Button type="submit" disabled={busy} variant="primary">
                Continue
              </Button>
            </form>
          )}
          {error ? <p className="mt-3 text-danger text-sm">{error}</p> : null}
        </DialogBody>
        <footer className="shrink-0 border-t border-hairline-soft px-5 py-3">
          <Dialog.Close
            disabled={busy}
            className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-hover"
          >
            Cancel
          </Dialog.Close>
        </footer>
      </DialogSurface>
    </Dialog.Root>
  );
}

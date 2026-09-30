import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import type { QuestionAnswer, QuestionRequest } from "../../../../shared/contracts";

export function ExtensionDialog({ request }: { request: QuestionRequest }) {
  const question = request.questions[0];
  const [value, setValue] = useState(question?.prefill ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!question) return null;

  async function respond(selected?: string, skipped = false): Promise<void> {
    if (busy || !question) return;
    setBusy(true);
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
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) void respond(undefined, true);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-fg/20 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-hairline bg-panel p-5 shadow-lg">
          <Dialog.Title className="break-words text-fg text-base">{question.header}</Dialog.Title>
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
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-fg px-3 py-2 text-canvas text-sm"
              >
                Continue
              </button>
            </form>
          )}
          {error ? <p className="mt-3 text-danger text-sm">{error}</p> : null}
          <Dialog.Close
            disabled={busy}
            className="mt-4 rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-hover"
          >
            Cancel
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

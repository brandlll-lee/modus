import { IconChevronRight } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";
import type { QuestionAnswer, QuestionRequest } from "../../../../shared/contracts";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";

/**
 * Transcript card for a completed `ask_user` call (Cursor/Codex-style): collapsed
 * it reads "Asked N questions"; expanded it lists each question with the answer
 * the user chose from the structured `question.resolved` event.
 */

type QuestionToolCardProps = {
  args?: unknown;
  isComplete?: boolean;
  request?: QuestionRequest;
  answers?: QuestionAnswer[];
  skipped?: boolean;
};

type ArgQuestion = {
  id?: string;
  header: string;
  options?: Array<{ label?: string; recommended?: boolean }>;
};

type QnA = { id: string; header: string; answer: string; recommended: boolean };

function readQuestions(args: unknown): ArgQuestion[] {
  if (!args || typeof args !== "object") {
    return [];
  }
  const value = (args as { questions?: unknown }).questions;
  return Array.isArray(value) ? (value as ArgQuestion[]) : [];
}

function answerText(answer: QuestionAnswer | undefined): string {
  const parts = [...(answer?.selected ?? [])];
  if (answer?.custom) {
    parts.push(answer.custom);
  }
  return parts.join("; ");
}

function buildPairs(
  questions: ArgQuestion[],
  answers: QuestionAnswer[] | undefined,
  skipped: boolean | undefined,
): QnA[] {
  const answersById = new Map((answers ?? []).map((answer) => [answer.questionId, answer]));
  return questions.map((question, index) => {
    const structured = question.id ? answersById.get(question.id) : answers?.[index];
    const answer = skipped ? "Skipped" : answerText(structured);
    const recommended = (question.options ?? []).some(
      (option) =>
        option.recommended === true &&
        option.label != null &&
        structured?.selected.includes(option.label),
    );
    return { id: question.id ?? question.header, header: question.header, answer, recommended };
  });
}

export const QuestionToolCard = memo(function QuestionToolCard({
  args,
  isComplete = false,
  request,
  answers,
  skipped,
}: QuestionToolCardProps) {
  const [open, setOpen] = useState(false);
  const questions = useMemo(() => request?.questions ?? readQuestions(args), [args, request]);
  const pairs = useMemo(
    () => buildPairs(questions, answers, skipped),
    [answers, questions, skipped],
  );

  const count = questions.length;
  const running = !isComplete;

  if (running) {
    return (
      <div className="flex min-w-0 items-center gap-2 py-0.5 text-sm">
        <ShinyText className="min-w-0 flex-1 truncate">Asking…</ShinyText>
      </div>
    );
  }

  const label = `Asked ${count} ${count === 1 ? "question" : "questions"}`;

  return (
    <div className="min-w-0 text-sm">
      <button
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left text-fg-muted transition-colors hover:text-fg"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="font-medium">{label}</span>
        <IconChevronRight
          className={cn(
            "shrink-0 text-fg-faint transition-transform duration-150",
            open && "rotate-90",
          )}
          size={13}
          stroke={1.7}
        />
      </button>

      <CollapsibleMotion open={open} preset="timeline">
        <div className="mt-1.5 flex flex-col gap-2.5 border-hairline border-l pl-3">
          {pairs.map((pair) => (
            <div className="min-w-0" key={pair.id}>
              <div className="font-medium text-[13px] text-fg">{pair.header}</div>
              <div className="mt-0.5 text-fg-faint text-xs">
                {pair.answer || "—"}
                {pair.recommended ? (
                  <span className="ml-1.5 text-fg-faint/70">(Recommended)</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleMotion>
    </div>
  );
});

import { IconChevronRight } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { cn } from "../../lib/cn";
import { ShinyText } from "./TextEffects";

/**
 * Transcript card for a completed `ask_user` call (Cursor/Codex-style): collapsed
 * it reads "Asked N questions"; expanded it lists each question with the answer
 * the user chose. Questions come from the call args; answers are recovered from
 * the tool's own output serialization ("Q: …\nA: …"), so the card needs no extra
 * event plumbing. "(Recommended)" is shown when the chosen answer was the option
 * the planner had marked recommended.
 */

type QuestionToolCardProps = {
  args?: unknown;
  output: string;
  isComplete?: boolean;
};

type ArgQuestion = {
  header: string;
  options?: Array<{ label?: string; recommended?: boolean }>;
};

type QnA = { header: string; answer: string; recommended: boolean };

function readQuestions(args: unknown): ArgQuestion[] {
  if (!args || typeof args !== "object") {
    return [];
  }
  const value = (args as { questions?: unknown }).questions;
  return Array.isArray(value) ? (value as ArgQuestion[]) : [];
}

/** Pull the ordered "A: …" answer lines out of the tool's serialized output. */
function readAnswerLines(output: string): string[] {
  const answers: string[] = [];
  for (const line of output.split("\n")) {
    const match = /^A:\s?(.*)$/.exec(line.trim());
    if (match) {
      answers.push(match[1] ?? "");
    }
  }
  return answers;
}

function buildPairs(questions: ArgQuestion[], output: string): QnA[] {
  const answers = readAnswerLines(output);
  return questions.map((question, index) => {
    const answer = answers[index]?.trim() ?? "";
    const recommended = (question.options ?? []).some(
      (option) =>
        option.recommended === true && option.label != null && answer.includes(option.label),
    );
    return { header: question.header, answer, recommended };
  });
}

export const QuestionToolCard = memo(function QuestionToolCard({
  args,
  output,
  isComplete = false,
}: QuestionToolCardProps) {
  const [open, setOpen] = useState(false);
  const questions = useMemo(() => readQuestions(args), [args]);
  const pairs = useMemo(() => buildPairs(questions, output), [questions, output]);

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
            <div className="min-w-0" key={pair.header}>
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

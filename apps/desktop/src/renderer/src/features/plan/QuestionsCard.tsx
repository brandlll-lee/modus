import {
  IconChevronLeft,
  IconChevronRight,
  IconInfoCircle,
  IconPencil,
  IconSelector,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { QuestionAnswer, QuestionRequest } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

/**
 * Codex-style "Questions" card shown above the composer when the agent calls
 * `ask_user` (Figure 4): numbered options with a moveable keyboard cursor, an
 * always-present free-text row, and a Dismiss/Submit footer. It paginates across
 * questions and resolves the blocked run via onSubmit (answers) or onSkip. The
 * accent is the shared blue action token (same as the plan decision card).
 */

type Draft = { selected: string[]; custom: string };

function initialDraft(question: QuestionRequest["questions"][number]): Draft {
  // Single-choice questions start on the recommended option (else the first),
  // matching Codex's pre-highlighted default; multi-select starts empty.
  if (!question.multiSelect) {
    const preferred = question.options.find((option) => option.recommended) ?? question.options[0];
    return { selected: preferred ? [preferred.label] : [], custom: "" };
  }
  return { selected: [], custom: "" };
}

export function QuestionsCard({
  request,
  onSubmit,
  onSkip,
}: {
  request: QuestionRequest;
  onSubmit: (answers: QuestionAnswer[]) => void;
  onSkip: () => void;
}) {
  const questions = request.questions;
  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, initialDraft(question)])),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Re-focus the card and reset the option cursor when the page changes, so the
  // scoped keyboard handler keeps working without stealing keys from the composer.
  useEffect(() => {
    setCursor(0);
    containerRef.current?.focus();
  }, []);

  const question = questions[index];
  if (!question) {
    return null;
  }
  const active = question;
  const draft = drafts[active.id] ?? { selected: [], custom: "" };
  const isLast = index >= questions.length - 1;
  const multiple = questions.length > 1;

  function updateDraft(id: string, next: Partial<Draft>): void {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { selected: [], custom: "" }), ...next },
    }));
  }

  function selectAt(optionIndex: number): void {
    const option = active.options[optionIndex];
    if (!option) {
      return;
    }
    setCursor(optionIndex);
    if (active.multiSelect) {
      const current = drafts[active.id]?.selected ?? [];
      const selected = current.includes(option.label)
        ? current.filter((label) => label !== option.label)
        : [...current, option.label];
      updateDraft(active.id, { selected });
    } else {
      updateDraft(active.id, { selected: [option.label] });
    }
  }

  function moveCursor(delta: number): void {
    const next = Math.max(0, Math.min(cursor + delta, active.options.length - 1));
    setCursor(next);
    // Single-choice: the highlight IS the selection (radio behavior).
    if (!active.multiSelect) {
      const option = active.options[next];
      if (option) {
        updateDraft(active.id, { selected: [option.label] });
      }
    }
  }

  function goToPage(next: number): void {
    setIndex(Math.max(0, Math.min(next, questions.length - 1)));
    setCursor(0);
  }

  function collectAnswers(): QuestionAnswer[] {
    return questions.map((entry) => {
      const entryDraft = drafts[entry.id] ?? { selected: [], custom: "" };
      const custom = entryDraft.custom.trim();
      return {
        questionId: entry.id,
        selected: entryDraft.selected,
        ...(custom ? { custom } : {}),
      };
    });
  }

  function primaryAction(): void {
    if (isLast) {
      onSubmit(collectAnswers());
    } else {
      goToPage(index + 1);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const typing = (event.target as HTMLElement).tagName === "INPUT";
    if (event.key === "Enter") {
      event.preventDefault();
      primaryAction();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onSkip();
      return;
    }
    if (typing) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(-1);
    } else if (event.key === "ArrowRight" && !isLast) {
      event.preventDefault();
      goToPage(index + 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      goToPage(index - 1);
    } else if (event.key === " ") {
      event.preventDefault();
      selectAt(cursor);
    } else if (/^[1-9]$/.test(event.key)) {
      const optionIndex = Number(event.key) - 1;
      if (optionIndex < active.options.length) {
        event.preventDefault();
        selectAt(optionIndex);
      }
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focusable card hosts scoped keyboard nav.
    <div
      className="mb-2 rounded-xl border border-composer-border bg-elevated px-3.5 py-3 shadow-composer-edge outline-none"
      onKeyDown={onKeyDown}
      ref={containerRef}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[14px] text-fg leading-snug">{active.header}</div>
          {active.detail ? (
            <div className="mt-1 text-fg-subtle text-xs leading-relaxed">{active.detail}</div>
          ) : null}
        </div>
        {multiple ? (
          <div className="flex shrink-0 items-center gap-1.5 text-fg-faint text-xs">
            <button
              aria-label="Previous question"
              className="flex size-5 items-center justify-center rounded transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-40"
              disabled={index === 0}
              onClick={() => goToPage(index - 1)}
              type="button"
            >
              <IconChevronLeft size={14} stroke={1.8} />
            </button>
            <span className="tabular-nums">
              {index + 1} of {questions.length}
            </span>
            <button
              aria-label="Next question"
              className="flex size-5 items-center justify-center rounded transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-40"
              disabled={isLast}
              onClick={() => goToPage(index + 1)}
              type="button"
            >
              <IconChevronRight size={14} stroke={1.8} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-col gap-1">
        {active.options.map((option, optionIndex) => {
          const selected = draft.selected.includes(option.label);
          const isCursor = optionIndex === cursor;
          return (
            <button
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                selected ? "bg-build/12" : "hover:bg-hover",
              )}
              key={option.label}
              onClick={() => selectAt(optionIndex)}
              type="button"
            >
              <span
                className={cn(
                  "flex size-[18px] shrink-0 items-center justify-center rounded-full font-semibold text-[11px]",
                  selected ? "bg-build text-build-fg" : "border border-hairline text-fg-faint",
                )}
              >
                {optionIndex + 1}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
                <span className="truncate font-medium text-fg">{option.label}</span>
                {option.recommended ? (
                  <span className="shrink-0 text-fg-faint text-xs">(Recommended)</span>
                ) : null}
                {option.description ? (
                  <IconInfoCircle
                    className="shrink-0 text-fg-faint"
                    size={13}
                    stroke={1.6}
                    title={option.description}
                  />
                ) : null}
              </span>
              <span className="flex-1" />
              {isCursor ? (
                <IconSelector className="shrink-0 text-fg-faint/70" size={14} stroke={1.6} />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <IconPencil className="shrink-0 text-fg-faint" size={14} stroke={1.6} />
        <input
          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-faint outline-none"
          onChange={(event) => updateDraft(active.id, { custom: event.target.value })}
          placeholder="Or type a different answer…"
          value={draft.custom}
        />
        <button
          className="flex shrink-0 items-center gap-1 text-fg-faint text-xs transition-colors hover:text-fg-subtle"
          onClick={onSkip}
          type="button"
        >
          Dismiss
          <kbd className="rounded border border-hairline px-1 py-px font-sans text-[10px]">ESC</kbd>
        </button>
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-build px-3 py-[6px] font-medium text-[13px] text-build-fg transition-colors hover:bg-build-hover"
          onClick={primaryAction}
          type="button"
        >
          {isLast ? "Submit" : "Next"}
          <span className="text-[11px] text-build-fg/60">⏎</span>
        </button>
      </div>
    </div>
  );
}

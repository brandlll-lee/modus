import { Menu } from "@base-ui/react/menu";
import { IconChevronRight, IconDots } from "@tabler/icons-react";
import { m } from "motion/react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import type { PlanRef } from "../../../../shared/contracts";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ModusBot } from "../../components/ui/ModusBot";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";
import { useTheme } from "../../lib/theme";
import { useSmoothStreamingText } from "../../lib/useSmoothStreamingText";
import { MessageBlock } from "./MessageBlock";
import { subagentColor } from "./subagentUi";
import type { RunBlockItem, WorkFoldItem } from "./Timeline";
import { TodosCard } from "./TodosCard";
import { ToolCard } from "./ToolCard";

/** Rough reading-time estimate for a thinking transcript (1–9s), Cursor-style. */
function estimateThinkingSeconds(text: string): number {
  return Math.max(1, Math.min(9, Math.round(text.length / 240)));
}

function FoldHeader({
  active = false,
  showOrb = false,
  label,
  onToggle,
  open,
  trailing,
}: {
  active?: boolean;
  /** Live WorkFold only — ThoughtRow must not show the agent orb. */
  showOrb?: boolean;
  label: string;
  onToggle(): void;
  open: boolean;
  /** Far-right actions (settled ⋯). Enables flex-1 so the menu sits at the end. */
  trailing?: ReactNode;
}) {
  const [mode] = useTheme();

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {showOrb ? (
        <ThinkingOrb
          aria-label="Working"
          className="shrink-0"
          size={20}
          state="solving"
          theme={mode === "light" ? "light" : "dark"}
        />
      ) : null}
      <button
        aria-expanded={open}
        className={cn(
          "group/activity flex min-w-0 max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-sm text-fg-subtle transition-colors hover:text-fg-muted",
          trailing ? "flex-1" : undefined,
        )}
        onClick={onToggle}
        type="button"
      >
        {active ? (
          <ShinyText className="min-w-0 truncate">{label}</ShinyText>
        ) : (
          <span className="min-w-0 truncate text-fg-muted">{label}</span>
        )}
        <m.span
          animate={{ rotate: open ? 90 : 0 }}
          className="flex size-4 shrink-0 items-center justify-center text-fg-faint opacity-0 transition-opacity group-focus-visible/activity:opacity-100 group-hover/activity:opacity-100"
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <IconChevronRight size={12} stroke={1.8} />
        </m.span>
      </button>
      {trailing}
    </div>
  );
}

/**
 * One thinking segment. While streaming it auto-expands; once done it folds to
 * "Thought for Xs". Used inside a {@link WorkFold}.
 */
export function ThoughtRow({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const interactedRef = useRef(false);

  useEffect(() => {
    if (!interactedRef.current) {
      setOpen(streaming);
    }
  }, [streaming]);

  const displayText = useSmoothStreamingText(text, streaming);

  if (!streaming && !text.trim()) {
    return null;
  }

  const label = streaming ? "Thinking" : `Thought for ${estimateThinkingSeconds(text)}s`;

  return (
    <div className="min-w-0">
      <FoldHeader
        active={streaming}
        label={label}
        onToggle={() => {
          interactedRef.current = true;
          setOpen((value) => !value);
        }}
        open={open}
      />
      <CollapsibleMotion open={open} preset="timeline">
        <pre className="mt-1 max-w-full whitespace-pre-wrap text-2xs text-fg-faint leading-relaxed">
          {displayText}
        </pre>
      </CollapsibleMotion>
    </div>
  );
}

function FoldMoreActions({ answer, elapsedLabel }: { answer?: string; elapsedLabel: string }) {
  const [copied, setCopied] = useState(false);

  function copyAnswer(): void {
    if (!answer || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    void navigator.clipboard.writeText(answer).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }

  const rowClass =
    "flex h-7 cursor-default items-center rounded-sm px-2 text-sm outline-none select-none";

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="More actions"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-faint outline-none transition-colors",
          "hover:bg-hover hover:text-fg-muted data-popup-open:bg-hover data-popup-open:text-fg",
        )}
        title="More actions"
      >
        <IconDots size={15} stroke={1.8} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" side="bottom" sideOffset={4}>
          <Menu.Popup className="origin-(--transform-origin) min-w-[132px] popup-chrome p-0.5">
            {answer !== undefined && answer.length > 0 ? (
              <Menu.Item
                className={cn(rowClass, "text-fg data-highlighted:bg-hover")}
                onClick={copyAnswer}
              >
                {copied ? "Copied" : "Copy"}
              </Menu.Item>
            ) : null}
            <div className={cn(rowClass, "text-fg-muted tabular-nums")} role="note">
              {elapsedLabel}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Cursor-style turn work fold: one header for the whole run's work.
 * Live → expanded "Working for…"; settled → collapsed "Worked for…".
 */
export const WorkFold = memo(function WorkFold({
  run,
  items,
  formatElapsed,
  cwd,
  onOpenSubagent,
  onOpenPlan,
}: {
  run: RunBlockItem;
  items: WorkFoldItem[];
  formatElapsed: (end: number, start: number) => string;
  cwd?: string;
  onOpenSubagent?(childSessionId: string): void;
  onOpenPlan?(plan: PlanRef): void;
}) {
  const active = run.status === "running" || run.status === "blocked";
  const [open, setOpen] = useState(active);
  const interactedRef = useRef(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!interactedRef.current) {
      setOpen(active);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const elapsed = formatElapsed(
    active ? Date.now() : (run.completedAt ?? run.startedAt),
    run.startedAt,
  );
  const label =
    run.status === "failed"
      ? "Modus stopped"
      : run.status === "cancelled"
        ? "Stopped by you"
        : active
          ? `Working for ${elapsed}`
          : `Worked for ${elapsed}`;

  return (
    <div className="min-w-0 text-sm">
      <FoldHeader
        active={active}
        label={label}
        onToggle={() => {
          interactedRef.current = true;
          setOpen((value) => !value);
        }}
        open={open}
        showOrb={active}
        trailing={
          !active ? (
            <FoldMoreActions
              {...(run.answer !== undefined ? { answer: run.answer } : {})}
              elapsedLabel={elapsed}
            />
          ) : undefined
        }
      />
      <CollapsibleMotion open={open} preset="timeline">
        <div className="mt-0.5 ml-[6px] border-hairline-strong border-l pl-3">
          <div className="space-y-1 pt-0.5 pb-1">
            {items.map((item) => {
              if (item.type === "thought") {
                return (
                  <ThoughtRow key={item.id} streaming={item.streaming ?? false} text={item.text} />
                );
              }
              if (item.type === "tool") {
                return (
                  <ToolCard
                    args={item.args}
                    isComplete={item.isComplete ?? false}
                    isError={item.isError ?? false}
                    key={item.id}
                    name={item.name}
                    output={item.output}
                    {...(cwd ? { cwd } : {})}
                    {...(item.plan && onOpenPlan ? { onOpenPlan, plan: item.plan } : {})}
                    {...(item.questionAnswers ? { questionAnswers: item.questionAnswers } : {})}
                    {...(item.questionRequest ? { questionRequest: item.questionRequest } : {})}
                    {...(item.questionSkipped !== undefined
                      ? { questionSkipped: item.questionSkipped }
                      : {})}
                  />
                );
              }
              if (item.type === "todos") {
                return <TodosCard key={item.id} todos={item.todos} updating={item.updating} />;
              }
              if (item.type === "subagent") {
                const subActive = item.status === "running";
                return (
                  <button
                    className="flex min-w-0 w-full items-start gap-3 rounded-lg border border-hairline-soft bg-card px-3 py-2.5 text-left transition-colors hover:bg-hover"
                    key={item.id}
                    onClick={() => onOpenSubagent?.(item.childSessionId)}
                    type="button"
                  >
                    <ModusBot
                      active={subActive}
                      busy={subActive}
                      className="mt-0.5 size-6 shrink-0"
                      color={subagentColor(item.childSessionId)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="min-w-0 truncate text-sm font-medium text-fg">{item.task}</div>
                      <div className="mt-1 text-xs text-fg-subtle">
                        {item.model ?? item.subagentType}
                      </div>
                    </div>
                  </button>
                );
              }
              if (item.type === "notice") {
                return (
                  <div className="text-xs text-fg-faint" key={item.id}>
                    {item.title}
                    {item.body ? ` — ${item.body}` : null}
                  </div>
                );
              }
              if (item.type === "message") {
                return (
                  <MessageBlock
                    content={item.content}
                    key={item.id}
                    messageId={item.id}
                    messageRole={item.role}
                    streaming={item.streaming ?? false}
                  />
                );
              }
              return null;
            })}
          </div>
        </div>
      </CollapsibleMotion>
    </div>
  );
});

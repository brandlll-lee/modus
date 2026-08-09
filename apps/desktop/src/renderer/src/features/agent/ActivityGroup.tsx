import { IconChevronRight } from "@tabler/icons-react";
import { m } from "motion/react";
import { memo, type ReactNode, useEffect, useId, useState } from "react";
import type { ModelInfo, PlanRef } from "../../../../shared/contracts";
import { getToolUiMeta, type ToolSummaryMeta } from "../../../../shared/tools";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";
import { MessageBlock } from "./MessageBlock";
import { SubagentRow } from "./SubagentRow";
import { subagentActivityLabel } from "./subagentUi";
import type {
  CompactionBlockItem,
  GroupedWorkActivityItem,
  RunBlockItem,
  WorkActivityGroupItem,
  WorkActivityItem,
  WorkFoldItem,
} from "./Timeline";
import { TodosCard } from "./TodosCard";
import { ToolCard } from "./ToolCard";

export function formatElapsed(end: number, start: number): string {
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** Single-line tool-style compaction status (ShinyText while running). */
export function CompactionRow({ status, detail }: Pick<CompactionBlockItem, "status" | "detail">) {
  const running = status === "running";
  const danger = status === "aborted" || status === "error";
  const label = running ? "Compacting context" : (detail ?? "Context compacted");
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      {running ? (
        <ShinyText className="shrink-0 font-medium">{label}</ShinyText>
      ) : (
        <span className={cn("shrink-0 font-medium", danger ? "text-danger" : "text-fg-subtle")}>
          {label}
        </span>
      )}
    </div>
  );
}

function FoldHeader({
  active = false,
  controlsId,
  label,
  onToggle,
  open,
}: {
  active?: boolean;
  controlsId?: string;
  label: string;
  onToggle(): void;
  open: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        aria-controls={controlsId}
        aria-expanded={open}
        className="group/activity flex min-w-0 max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-sm text-fg-subtle transition-colors hover:text-fg-muted"
        onClick={onToggle}
        type="button"
      >
        {active ? (
          <ShinyText className="min-w-0 truncate">{label}</ShinyText>
        ) : (
          <span className="min-w-0 truncate text-fg-subtle">{label}</span>
        )}
        <m.span
          animate={{ rotate: open ? 90 : 0 }}
          className="flex size-4 shrink-0 items-center justify-center text-fg-faint"
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <IconChevronRight size={12} stroke={1.8} />
        </m.span>
      </button>
    </div>
  );
}

function toolTarget(item: Extract<WorkActivityItem, { type: "tool" }>): string | undefined {
  const key = getToolUiMeta(item.name)?.primaryArgKey;
  if (!key || !item.args || typeof item.args !== "object" || Array.isArray(item.args))
    return undefined;
  const value = (item.args as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : undefined;
}

const thoughtText = (text: string) => text.trim().replace(/\s+/g, " ");

function isActivityActive(item: GroupedWorkActivityItem): boolean {
  if (item.type === "thought") return item.streaming === true;
  if (item.type === "tool") return item.isComplete !== true && item.isError !== true;
  return item.status === "running";
}

function activeActivityLabel(item: GroupedWorkActivityItem): string {
  if (item.type === "thought") {
    const preview = thoughtText(item.text);
    return preview ? `Thinking · ${preview}` : "Thinking";
  }
  if (item.type === "compaction") return "Compacting context";
  const meta = getToolUiMeta(item.name);
  const target = toolTarget(item);
  return `${meta?.activeVerb ?? meta?.verb ?? "Running"}${target ? ` ${target}` : ""}`;
}

function settledActivityLabel(items: GroupedWorkActivityItem[]): string {
  const buckets = new Map<string, ToolSummaryMeta & { keys: Set<string> }>();
  let unspecifiedTools = 0;
  for (const item of items) {
    if (item.type !== "tool") continue;
    const summary = getToolUiMeta(item.name)?.summary;
    if (!summary) {
      unspecifiedTools += 1;
      continue;
    }
    const bucketKey = `${summary.verb}\0${summary.noun.one}\0${summary.noun.other}`;
    const bucket = buckets.get(bucketKey) ?? { ...summary, keys: new Set<string>() };
    bucket.keys.add(summary.countBy === "target" ? (toolTarget(item) ?? item.id) : item.id);
    buckets.set(bucketKey, bucket);
  }
  const parts = Array.from(buckets.values(), ({ verb, noun, keys }) => {
    const count = keys.size;
    return `${verb} ${count} ${count === 1 ? noun.one : noun.other}`;
  });
  if (unspecifiedTools > 0) {
    parts.push(`used ${unspecifiedTools} ${unspecifiedTools === 1 ? "tool" : "tools"}`);
  }
  const thought = items.findLast((item) => item.type === "thought" && item.text.trim());
  const label =
    parts.join(", ") ||
    (thought?.type === "thought" ? `Thought · ${thoughtText(thought.text)}` : "Completed activity");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function workActivityPresentation(items: GroupedWorkActivityItem[]) {
  const activeItem = items.findLast(isActivityActive);
  const danger = items.some((item) =>
    item.type === "tool"
      ? item.isError === true
      : item.type === "compaction" && item.status === "error",
  );
  const label = activeItem ? activeActivityLabel(activeItem) : settledActivityLabel(items);
  return {
    label: danger && !activeItem ? `Failed: ${label}` : label,
    active: !!activeItem,
  };
}

function WorkActivityGroup({
  group,
  children,
}: {
  group: WorkActivityGroupItem;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const presentation = workActivityPresentation(group.items);
  return (
    <div className="min-w-0">
      <FoldHeader
        active={presentation.active}
        controlsId={contentId}
        label={presentation.label}
        onToggle={() => setOpen((value) => !value)}
        open={open}
      />
      <CollapsibleMotion id={contentId} open={open} preset="timeline">
        <div className="mt-1.5 space-y-2.5">{children}</div>
      </CollapsibleMotion>
    </div>
  );
}

export function WorkActivityRow({
  item,
  models,
  onOpenFile,
  onOpenSubagent,
  onOpenPlan,
}: {
  item: WorkActivityItem;
  models?: ModelInfo[];
  onOpenFile?(path: string): void;
  onOpenSubagent?(childSessionId: string): void;
  onOpenPlan?(plan: PlanRef): void;
}) {
  if (item.type === "thought") {
    if (!item.streaming && !item.text.trim()) return null;
    return (
      <pre className="max-w-full whitespace-pre-wrap text-2xs text-fg-faint leading-relaxed">
        {item.text}
      </pre>
    );
  }
  if (item.type === "todos") return <TodosCard {...item} />;
  if (item.type === "subagent") {
    return (
      <SubagentRow
        {...item}
        activityLabel={subagentActivityLabel(item.status, item.activity)}
        modelId={item.model}
        models={models}
        onClick={() => onOpenSubagent?.(item.childSessionId)}
      />
    );
  }
  if (item.type === "compaction") return <CompactionRow {...item} />;
  return (
    <ToolCard
      {...item}
      {...(onOpenFile ? { onOpenFile } : {})}
      {...(item.plan && onOpenPlan ? { onOpenPlan, plan: item.plan } : {})}
    />
  );
}

/**
 * Cursor-style turn work fold: one header for the whole run's work.
 * A live turn mounts open; its authoritative settled transition closes it once.
 */
export const WorkFold = memo(function WorkFold({
  run,
  items,
  models,
  onOpenFile,
  onOpenSubagent,
  onOpenPlan,
}: {
  run: RunBlockItem;
  items: WorkFoldItem[];
  models?: ModelInfo[];
  onOpenFile?(path: string): void;
  onOpenSubagent?(childSessionId: string): void;
  onOpenPlan?(plan: PlanRef): void;
}) {
  const active = run.status === "running" || run.status === "blocked";
  const [disclosure, setDisclosure] = useState({ active, open: active });
  const open = disclosure.active === active ? disclosure.open : active;
  const contentId = useId();
  const [, setTick] = useState(0);

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
        controlsId={contentId}
        label={label}
        onToggle={() => setDisclosure({ active, open: !open })}
        open={open}
      />
      <CollapsibleMotion id={contentId} open={open} preset="timeline">
        <div className="mt-0.5">
          <div className="space-y-2.5 pt-1.5 pb-2">
            {items.map((item) => {
              if (item.type === "work-activity-group") {
                return (
                  <WorkActivityGroup group={item} key={item.id}>
                    {item.items.map((activity) => (
                      <WorkActivityRow
                        item={activity}
                        key={activity.id}
                        {...(models ? { models } : {})}
                        {...(onOpenFile ? { onOpenFile } : {})}
                        {...(onOpenPlan ? { onOpenPlan } : {})}
                        {...(onOpenSubagent ? { onOpenSubagent } : {})}
                      />
                    ))}
                  </WorkActivityGroup>
                );
              }
              if (item.type !== "notice" && item.type !== "message") {
                return (
                  <WorkActivityRow
                    item={item}
                    key={item.id}
                    {...(models ? { models } : {})}
                    {...(onOpenFile ? { onOpenFile } : {})}
                    {...(onOpenPlan ? { onOpenPlan } : {})}
                    {...(onOpenSubagent ? { onOpenSubagent } : {})}
                  />
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

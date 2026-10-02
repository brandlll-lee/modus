import { IconBrain, IconListCheck, IconRefresh } from "@tabler/icons-react";
import { memo, type ReactNode, useEffect, useId, useState } from "react";
import type { PlanRef } from "../../../../shared/contracts";
import { getToolUiMeta, type ToolSummaryMeta } from "../../../../shared/tools";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";
import { ActivityHeader } from "./ActivityHeader";
import { MessageBlock } from "./MessageBlock";
import { RequestStatusRow } from "./RequestStatusRow";
import type {
  CompactionBlockItem,
  RunBlockItem,
  WorkActivityGroupItem,
  WorkActivityItem,
  WorkFoldItem,
} from "./Timeline";
import { TodosCard } from "./TodosCard";
import { ToolCard } from "./ToolCard";
import { ToolImageGroup } from "./ToolImageGroup";
import { toolActionIcon } from "./toolIcons";

export function formatElapsed(end: number, start: number): string {
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function PreparingRow() {
  return (
    <div role="status" className="py-0.5 text-sm">
      <ShinyText>Preparing</ShinyText>
    </div>
  );
}

/** Single-line tool-style compaction status (ShinyText while running). */
export function CompactionRow({ status, detail }: Pick<CompactionBlockItem, "status" | "detail">) {
  const running = status === "running";
  const danger = status === "aborted" || status === "error";
  const label = running ? "Compacting context" : (detail ?? "Context compacted");
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <IconRefresh aria-hidden className="action-icon" />
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

function toolTarget(item: Extract<WorkActivityItem, { type: "tool" }>): string | undefined {
  const key = getToolUiMeta(item.name)?.primaryArgKey;
  if (!key || !item.args || typeof item.args !== "object" || Array.isArray(item.args))
    return undefined;
  const value = (item.args as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : undefined;
}

const thoughtText = (text: string) => text.trim().replace(/\s+/g, " ");

function isActivityActive(item: WorkActivityItem): boolean {
  if (item.type === "todos") return item.updating;
  if (item.type === "thought") return item.streaming === true;
  if (item.type === "tool") return item.isComplete !== true && item.isError !== true;
  return item.status === "running";
}

function activeActivityLabel(item: WorkActivityItem): string {
  if (item.type === "todos") return "Updating to-dos";
  if (item.type === "thought") {
    const preview = thoughtText(item.text);
    return preview ? `Thinking · ${preview}` : "Thinking";
  }
  if (item.type === "compaction") return "Compacting context";
  const meta = getToolUiMeta(item.name);
  const target = toolTarget(item);
  return `${meta?.activeVerb ?? (meta ? meta.verb : `Running ${item.label ?? item.name}`)}${target ? ` ${target}` : ""}`;
}

function settledActivityLabel(items: WorkActivityItem[]): string {
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
  if (items.some((item) => item.type === "todos")) parts.push("updated to-dos");
  const thought = items.findLast((item) => item.type === "thought" && item.text.trim());
  const label =
    parts.join(", ") ||
    (thought?.type === "thought" ? `Thought · ${thoughtText(thought.text)}` : "Completed activity");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function workActivityPresentation(items: WorkActivityItem[]) {
  const activeTools = items.filter((item) => item.type === "tool" && isActivityActive(item));
  const activeItem = activeTools.at(-1) ?? items.findLast(isActivityActive);
  const danger = items.some((item) =>
    item.type === "tool"
      ? item.isError === true
      : item.type === "compaction" && item.status === "error",
  );
  const label = activeItem ? activeActivityLabel(activeItem) : settledActivityLabel(items);
  return {
    label:
      danger && !activeItem
        ? `Failed: ${label}`
        : activeTools.length > 1
          ? `${label} · ${activeTools.length} actions running`
          : label,
    active: !!activeItem,
    icon: activityIcon(activeItem ?? items.find((item) => item.type === "tool") ?? items[0]),
  };
}

function activityIcon(item: WorkActivityItem | undefined): ReactNode {
  if (item?.type === "tool") return toolActionIcon(item.name);
  if (item?.type === "todos") return <IconListCheck />;
  if (item?.type === "compaction") return <IconRefresh />;
  return <IconBrain />;
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
      <ActivityHeader
        active={presentation.active}
        controlsId={contentId}
        label={presentation.label}
        icon={presentation.icon}
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
  onOpenFile,
  onOpenPlan,
}: {
  item: WorkActivityItem;
  onOpenFile?(path: string): void;
  onOpenPlan?(plan: PlanRef): void;
}) {
  if (item.type === "thought") {
    if (!item.streaming && !item.text.trim()) return null;
    return (
      <div className="flex min-w-0 items-start gap-2">
        <IconBrain aria-hidden className="action-icon" />
        <pre className="min-w-0 max-w-full whitespace-pre-wrap text-xs text-fg-faint leading-relaxed">
          {item.text}
        </pre>
      </div>
    );
  }
  if (item.type === "todos") return <TodosCard {...item} />;
  if (item.type === "compaction") return <CompactionRow {...item} />;
  if (item.images?.length) return <ToolImageGroup items={[item]} />;
  return (
    <div
      className={item.parentToolCallId ? "ml-4 border-hairline-soft border-l pl-3" : undefined}
      data-parent-tool-call-id={item.parentToolCallId}
    >
      <ToolCard
        {...item}
        {...(onOpenFile ? { onOpenFile } : {})}
        {...(item.plan && onOpenPlan ? { onOpenPlan, plan: item.plan } : {})}
      />
    </div>
  );
}

export const WorkFold = memo(function WorkFold({
  run,
  items,
  onOpenFile,
  onOpenPlan,
}: {
  run: RunBlockItem;
  items: WorkFoldItem[];
  onOpenFile?(path: string): void;
  onOpenPlan?(plan: PlanRef): void;
}) {
  const active = run.status === "running" || run.status === "blocked";
  const [open, setOpen] = useState(true);
  const contentId = useId();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active || run.executionStartedAt === undefined || run.executionCompletedAt !== undefined)
      return undefined;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active, run.executionStartedAt, run.executionCompletedAt]);

  const elapsed = formatElapsed(
    run.executionCompletedAt ?? (active ? Date.now() : (run.completedAt ?? run.startedAt)),
    run.executionStartedAt ?? run.startedAt,
  );
  const label =
    run.status === "cancelled"
      ? "Stopped by you"
      : run.executionStartedAt === undefined
        ? active
          ? "Preparing"
          : "Request processed"
        : active && run.executionCompletedAt === undefined
          ? `Working for ${elapsed}`
          : `Worked for ${elapsed}`;

  return (
    <div className="min-w-0 text-sm">
      <ActivityHeader
        active={active && run.executionCompletedAt === undefined}
        controlsId={contentId}
        label={label}
        onToggle={() => setOpen((value) => !value)}
        open={open}
      />
      <CollapsibleMotion id={contentId} open={open} preset="timeline">
        <div className="mt-0.5">
          <div className="space-y-2.5 pt-1.5 pb-2">
            {items.map((item) => {
              if (item.type === "work-image-group")
                return <ToolImageGroup key={item.id} items={item.items} />;
              if (item.type === "request-status")
                return <RequestStatusRow key={item.id} item={item} />;
              if (item.type === "work-activity-group") {
                return (
                  <WorkActivityGroup group={item} key={item.id}>
                    {item.items.map((activity) => (
                      <WorkActivityRow
                        item={activity}
                        key={activity.id}
                        {...(onOpenFile ? { onOpenFile } : {})}
                        {...(onOpenPlan ? { onOpenPlan } : {})}
                      />
                    ))}
                  </WorkActivityGroup>
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

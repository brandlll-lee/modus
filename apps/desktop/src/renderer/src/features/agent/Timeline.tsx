import { IconAlertTriangle, IconChevronRight, IconFile, IconTerminal2 } from "@tabler/icons-react";
import { m, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  AgentEvent,
  PermissionDecision,
  PermissionRequest,
} from "../../../../shared/contracts";
import { ModusBot } from "../../components/ui/ModusBot";
import { cn } from "../../lib/cn";
import { MessageBlock } from "./MessageBlock";
import { PermissionCard } from "./PermissionCard";
import { ShinyText } from "./TextEffects";
import { ToolCard } from "./ToolCard";

type TimelineProps = {
  agentEvents: Array<{ id: string; event: AgentEvent; createdAt?: string }>;
  onPermissionDecision?(request: PermissionRequest, decision: PermissionDecision["decision"]): void;
};

type MessageBlockItem = {
  id: string;
  type: "message";
  role: "assistant" | "user";
  content: string;
  thinking: string;
  streaming?: boolean;
  /** Epoch ms — user send time, or assistant completion time. */
  createdAt?: number;
  /**
   * Set ONLY on the last assistant message of a completed turn. Carries the
   * whole turn's aggregated markdown + completion time so the turn shows a
   * single copy/timestamp footer at its bottom (not one per message segment).
   */
  actions?: { content: string; createdAt?: number };
};

type ToolBlockItem = {
  id: string;
  type: "tool";
  name: string;
  args?: unknown;
  output: string;
  isComplete?: boolean;
  isError?: boolean;
};

type PermissionBlockItem = {
  id: string;
  type: "permission";
  request: Extract<AgentEvent, { type: "permission.requested" }>["request"];
  decision?: PermissionDecision["decision"];
};

type RunBlockItem = {
  id: string;
  type: "run";
  runId: string;
  status: "running" | "completed" | "failed" | "blocked" | "cancelled";
  delivery?: string;
  body?: string;
  startedAt: number;
  completedAt?: number;
};

type NoticeBlockItem = {
  id: string;
  type: "notice";
  title: string;
  body: string;
  isError?: boolean;
};

type ThinkingBlockItem = {
  id: string;
  type: "thinking";
  runId: string;
};

type ToolGroupBlockItem = {
  id: string;
  type: "tool-group";
  /** Tool name shared by every member of the group (e.g. "read", "bash"). */
  name: string;
  tools: ToolBlockItem[];
  isError?: boolean;
};

type TimelineBlock =
  | MessageBlockItem
  | ToolBlockItem
  | PermissionBlockItem
  | RunBlockItem
  | NoticeBlockItem
  | ThinkingBlockItem
  | ToolGroupBlockItem;

export function buildBlocks(agentEvents: TimelineProps["agentEvents"]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  const blockById = new Map<string, TimelineBlock>();
  let order = 0;
  let activeAssistantMessageId: string | undefined;
  let activeRunId: string | undefined;

  function appendMessageBlock(block: MessageBlockItem): MessageBlockItem {
    blocks.push(block);
    blockById.set(block.id, block);
    if (block.role === "assistant") {
      activeAssistantMessageId = block.id;
    }
    return block;
  }

  function ensureAssistantMessageBlock(messageId: string): MessageBlockItem {
    const block = blockById.get(messageId);
    if (block?.type === "message") {
      if (block.role === "assistant") {
        activeAssistantMessageId = messageId;
      }
      return block;
    }
    return appendMessageBlock({
      id: messageId,
      type: "message",
      role: "assistant",
      content: "",
      thinking: "",
    });
  }

  for (const item of agentEvents) {
    const { id, event } = item;
    const eventAt = eventTime(item.createdAt, order);
    if (event.type === "run.started") {
      const block: RunBlockItem = {
        id: event.runId,
        type: "run",
        runId: event.runId,
        status: "running",
        delivery: event.delivery,
        startedAt: eventAt,
      };
      order++;
      blocks.push(block);
      blockById.set(event.runId, block);
      activeRunId = event.runId;
      continue;
    }

    if (event.type === "run.completed") {
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "completed";
        block.completedAt = eventAt;
        order++;
        if (event.summary !== undefined) {
          block.body = event.summary;
        }
      } else {
        const completedBlock: RunBlockItem = {
          id: event.runId,
          type: "run",
          runId: event.runId,
          status: "completed",
          startedAt: eventAt,
          completedAt: eventAt,
        };
        order++;
        if (event.summary !== undefined) {
          completedBlock.body = event.summary;
        }
        blocks.push(completedBlock);
      }
      if (activeRunId === event.runId) {
        activeRunId = undefined;
      }
      continue;
    }

    if (event.type === "run.failed") {
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "failed";
        block.body = event.message;
        block.completedAt = eventAt;
        order++;
      } else {
        blocks.push({
          id: event.runId,
          type: "run",
          runId: event.runId,
          status: "failed",
          body: event.message,
          startedAt: eventAt,
          completedAt: eventAt,
        });
        order++;
      }
      if (activeRunId === event.runId) {
        activeRunId = undefined;
      }
      continue;
    }

    if (event.type === "run.blocked") {
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "blocked";
        block.body = event.reason;
        block.completedAt = eventAt;
        order++;
      } else {
        blocks.push({
          id: event.runId,
          type: "run",
          runId: event.runId,
          status: "blocked",
          body: event.reason,
          startedAt: eventAt,
          completedAt: eventAt,
        });
        order++;
      }
      if (activeRunId === event.runId) {
        activeRunId = undefined;
      }
      continue;
    }

    if (event.type === "run.cancelled") {
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "cancelled";
        block.body = "Stopped by user.";
        block.completedAt = eventAt;
        order++;
      } else {
        blocks.push({
          id: event.runId,
          type: "run",
          runId: event.runId,
          status: "cancelled",
          body: "Stopped by user.",
          startedAt: eventAt,
          completedAt: eventAt,
        });
        order++;
      }
      if (activeRunId === event.runId) {
        activeRunId = undefined;
      }
      continue;
    }

    if (event.type === "message.started") {
      const block: MessageBlockItem = {
        id: event.messageId,
        type: "message",
        role: event.role,
        content: "",
        thinking: "",
        createdAt: eventAt,
      };
      appendMessageBlock(block);
      continue;
    }

    if (event.type === "message.delta") {
      const block = blockById.get(event.messageId);
      if (block?.type === "message") {
        block.content += event.delta;
      } else if (activeAssistantMessageId) {
        const activeBlock = blockById.get(activeAssistantMessageId);
        if (activeBlock?.type === "message") {
          activeBlock.content += event.delta;
        }
      } else {
        ensureAssistantMessageBlock(event.messageId).content += event.delta;
      }
      continue;
    }

    if (event.type === "thinking.delta") {
      const block = blockById.get(event.messageId);
      if (block?.type === "message") {
        block.thinking += event.delta;
      } else if (activeAssistantMessageId) {
        const activeBlock = blockById.get(activeAssistantMessageId);
        if (activeBlock?.type === "message") {
          activeBlock.thinking += event.delta;
        }
      } else {
        ensureAssistantMessageBlock(event.messageId).thinking += event.delta;
      }
      continue;
    }

    if (event.type === "message.completed") {
      const block = blockById.get(event.messageId);
      if (block?.type === "message") {
        block.createdAt = eventAt;
      }
      if (activeAssistantMessageId === event.messageId) {
        activeAssistantMessageId = undefined;
      }
      continue;
    }

    if (event.type === "tool.started") {
      const block: ToolBlockItem = {
        id: event.toolCallId,
        type: "tool",
        name: event.toolName,
        args: event.args,
        output: "",
      };
      blocks.push(block);
      blockById.set(event.toolCallId, block);
      continue;
    }

    if (event.type === "tool.output") {
      const block = blockById.get(event.toolCallId);
      if (block?.type === "tool") {
        block.output += event.output;
      }
      continue;
    }

    if (event.type === "tool.ended") {
      const block = blockById.get(event.toolCallId);
      if (block?.type === "tool") {
        block.isComplete = true;
        block.isError = event.isError;
      }
      continue;
    }

    if (event.type === "permission.requested") {
      const block: PermissionBlockItem = {
        id: event.request.id,
        type: "permission",
        request: event.request,
      };
      blocks.push(block);
      blockById.set(event.request.id, block);
      continue;
    }

    if (event.type === "permission.resolved") {
      const block = blockById.get(event.requestId);
      if (block?.type === "permission") {
        block.decision = event.decision;
      }
      continue;
    }

    if (event.type === "runtime.error") {
      blocks.push({
        body: event.message,
        id,
        isError: true,
        title: "runtime error",
        type: "notice",
      });
      continue;
    }

    if (event.type === "review.started") {
      blocks.push({
        body: "Reviewing local changes…",
        id,
        title: "review started",
        type: "notice",
      });
      continue;
    }

    if (event.type === "review.completed") {
      blocks.push({
        body: event.review.summary,
        id,
        title: event.review.status === "failed" ? "review failed" : "review completed",
        type: "notice",
        isError: event.review.status === "failed",
      });
      continue;
    }

    if (event.type === "review.failed") {
      blocks.push({
        body: event.message,
        id,
        isError: true,
        title: "review failed",
        type: "notice",
      });
      continue;
    }

    if (event.type === "queue.updated") {
      blocks.push({
        body: [...event.steering, ...event.followUp].join("\n"),
        id,
        title: "queue updated",
        type: "notice",
      });
      continue;
    }

    if (event.type === "compaction.started" || event.type === "compaction.ended") {
      blocks.push({
        body: event.type === "compaction.started" ? event.reason : (event.summary ?? "done"),
        id,
        title: event.type.replace(".", " "),
        type: "notice",
      });
    }
  }

  if (activeRunId) {
    const runBlock = blockById.get(activeRunId);
    if (runBlock?.type === "run" && runBlock.status === "running") {
      if (activeAssistantMessageId) {
        const activeBlock = blockById.get(activeAssistantMessageId);
        if (activeBlock?.type === "message" && activeBlock.role === "assistant") {
          activeBlock.streaming = true;
        }
      }
      let insertAfter = blocks.length - 1;
      for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index];
        if (!block) continue;
        if (block.type !== "run" || block.runId === activeRunId) {
          insertAfter = index;
          break;
        }
      }
      blocks.splice(insertAfter + 1, 0, {
        id: `thinking:${activeRunId}`,
        type: "thinking",
        runId: activeRunId,
      });
    }
  }

  return blocks;
}

/** Tools that collapse into a single summary row when ≥2 run back-to-back. */
const GROUPABLE_TOOLS = new Set(["read", "bash"]);
const TOOL_GROUP_MIN = 2;

/**
 * A single agent turn (one run) can produce SEVERAL assistant message segments
 * interleaved with tool calls. We want exactly one copy/timestamp footer per
 * turn, at its bottom — so we tag only the LAST assistant message of each
 * completed run with `actions`, carrying the whole turn's aggregated markdown
 * and completion time. While a run is still streaming, no footer is attached.
 */
export function attachTurnActions(blocks: TimelineBlock[]): TimelineBlock[] {
  let run: RunBlockItem | undefined;
  let lastAssistant: MessageBlockItem | undefined;
  let parts: string[] = [];

  const seal = (): void => {
    if (run && run.status !== "running" && lastAssistant && parts.length > 0) {
      lastAssistant.actions = {
        content: parts.join("\n\n"),
        ...(run.completedAt !== undefined ? { createdAt: run.completedAt } : {}),
      };
    }
    lastAssistant = undefined;
    parts = [];
  };

  for (const block of blocks) {
    if (block.type === "run") {
      seal();
      run = block;
      continue;
    }
    if (block.type === "message" && block.role === "assistant" && block.content.trim()) {
      parts.push(block.content);
      lastAssistant = block;
    }
  }
  seal();
  return blocks;
}

/**
 * Stable, collision-proof React keys for the rendered blocks.
 *
 * Message ids from the PI normalizer can repeat within a session (its fallback
 * counter resets when the runtime session is rebuilt on resume), so two blocks
 * can legitimately share `block.id`. Using the raw id as a React key then makes
 * React reuse one block's DOM for another's data — which looked like older
 * history being "overwritten" by a newer turn. We disambiguate by occurrence so
 * every rendered block has a unique key while keeping ids stable for routing.
 */
export function blockRenderKeys(blocks: TimelineBlock[]): string[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const n = (seen.get(block.id) ?? 0) + 1;
    seen.set(block.id, n);
    return n === 1 ? block.id : `${block.id}#${n}`;
  });
}

function toolGroupLabel(name: string, count: number): string {
  if (name === "read") {
    return `Read ${count} files`;
  }
  if (name === "bash") {
    return `Ran ${count} commands`;
  }
  return `${count} ${name} calls`;
}

/**
 * Collapse maximal runs of ≥2 strictly-adjacent same-name tool blocks (read,
 * bash) into a single `tool-group` block — but only once the run is "sealed":
 * every member complete AND (a real non-thinking block follows OR no run is
 * active). While a batch is still streaming or sits at the live tail, the tools
 * stay as individual rows so progress is visible; sealing triggers the fold.
 */
export function groupToolBlocks(blocks: TimelineBlock[]): TimelineBlock[] {
  const hasActiveRun = blocks.some((block) => block.type === "run" && block.status === "running");
  const result: TimelineBlock[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];
    if (!block) {
      index += 1;
      continue;
    }

    if (block.type !== "tool" || !GROUPABLE_TOOLS.has(block.name)) {
      result.push(block);
      index += 1;
      continue;
    }

    // Collect the maximal run of consecutive same-name tool blocks.
    const run: ToolBlockItem[] = [];
    let cursor = index;
    while (cursor < blocks.length) {
      const candidate = blocks[cursor];
      if (candidate?.type === "tool" && candidate.name === block.name) {
        run.push(candidate);
        cursor += 1;
      } else {
        break;
      }
    }

    const allComplete = run.every((tool) => tool.isComplete);
    const followedByRealBlock = blocks
      .slice(cursor)
      .some((following) => following.type !== "thinking");
    const sealed = allComplete && (followedByRealBlock || !hasActiveRun);
    const first = run[0];

    if (run.length >= TOOL_GROUP_MIN && sealed && first) {
      result.push({
        id: `tool-group:${first.id}`,
        type: "tool-group",
        name: block.name,
        tools: run,
        isError: run.some((tool) => tool.isError),
      });
    } else {
      result.push(...run);
    }
    index = cursor;
  }

  return result;
}

/**
 * Force a re-render on a fixed cadence while `active`. The elapsed label reads
 * `Date.now()` at render time, so without a self-driven tick it only advances
 * when something else re-renders the row (a streamed chunk). During the quiet
 * "Thinking" gap that means the counter freezes, then jumps when the next chunk
 * lands. This drives a steady 1s clock so it counts smoothly regardless of
 * stream cadence. State stays local to the row, so the Timeline never re-renders.
 */
function useElapsedTick(active: boolean): void {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

function RunRow({ block }: { block: RunBlockItem }) {
  const isError = block.status === "failed" || block.status === "blocked";
  const running = block.status === "running";
  useElapsedTick(running);
  const elapsed = formatElapsed(block.completedAt ?? Date.now(), block.startedAt);
  return (
    <div className="border-hairline-soft border-b pb-3">
      <div className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
        <ModusBot className="size-[18px] shrink-0" active={running} busy={running} />
        <span className={isError ? "text-danger" : "text-fg-muted"}>
          {block.status === "running" ? `Working for ${elapsed}` : `Worked for ${elapsed}`}
        </span>
        {block.status === "running" ? null : (
          <IconChevronRight className="shrink-0 text-fg-faint" size={13} stroke={1.65} />
        )}
        {block.body ? <span className="min-w-0 truncate text-fg-faint">{block.body}</span> : null}
      </div>
    </div>
  );
}

// Memoized with no props: it renders exactly once and never re-renders while the
// timeline churns through streamed tokens. That fully decouples the shimmer's
// rAF loop from the stream, so "Thinking" stays smooth instead of flickering on
// every chunk.
const ThinkingRow = memo(function ThinkingRow() {
  return (
    <div className="text-sm leading-relaxed">
      <ShinyText>Thinking</ShinyText>
    </div>
  );
});

/**
 * Collapsible summary for a sealed run of same-name tools. Mounts in the
 * expanded state so the individual rows the user was already watching stay put,
 * then folds into a single "Read N files" / "Ran N commands" line on the next
 * frame (height + opacity, domAnimation-only). Reduced motion starts collapsed.
 * Once the user toggles, their choice wins and the auto-fold is cancelled.
 */
const ToolGroup = memo(function ToolGroup({
  name,
  tools,
  isError = false,
}: {
  name: string;
  tools: ToolBlockItem[];
  isError?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(!reduceMotion);
  const interactedRef = useRef(false);

  useEffect(() => {
    if (reduceMotion || interactedRef.current) {
      return;
    }
    const id = window.setTimeout(() => {
      if (!interactedRef.current) {
        setExpanded(false);
      }
    }, 80);
    return () => window.clearTimeout(id);
  }, [reduceMotion]);

  function toggle(): void {
    interactedRef.current = true;
    setExpanded((value) => !value);
  }

  const Glyph = name === "bash" ? IconTerminal2 : IconFile;

  return (
    <div className="min-w-0 text-sm">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-fg"
        onClick={toggle}
        type="button"
      >
        <span className="shrink-0 text-fg-faint">
          {isError ? (
            <IconAlertTriangle className="text-danger" size={14} stroke={1.7} />
          ) : (
            <Glyph size={14} stroke={1.7} />
          )}
        </span>
        <span className={cn("shrink-0", isError ? "text-danger" : "text-fg-muted")}>
          {toolGroupLabel(name, tools.length)}
        </span>
        <span className="min-w-0 flex-1" />
        <IconChevronRight
          className={cn(
            "shrink-0 text-fg-faint transition-transform duration-150",
            expanded && "rotate-90",
          )}
          size={13}
          stroke={1.7}
        />
      </button>
      <m.div
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        className="overflow-hidden"
        initial={false}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="space-y-0.5 pt-0.5 pl-5">
          {tools.map((tool) => (
            <ToolCard
              args={tool.args}
              isComplete={tool.isComplete ?? false}
              isError={tool.isError ?? false}
              key={tool.id}
              name={tool.name}
              output={tool.output}
            />
          ))}
        </div>
      </m.div>
    </div>
  );
});

function Notice({ body, isError = false, title }: NoticeBlockItem) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm text-fg-subtle">
      <IconAlertTriangle
        className={isError ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-fg-faint"}
        size={15}
        stroke={1.65}
      />
      <div className="min-w-0">
        <span className={isError ? "text-danger" : "text-fg-muted"}>{title}</span>
        {body ? <span className="ml-2 text-fg-faint">{body}</span> : null}
      </div>
    </div>
  );
}

export function Timeline({ agentEvents, onPermissionDecision }: TimelineProps) {
  const blocks = useMemo(
    () => groupToolBlocks(attachTurnActions(buildBlocks(agentEvents))),
    [agentEvents],
  );
  const visibleBlocks = useMemo(
    () =>
      blocks.filter((block) => {
        if (block.type !== "message") {
          return true;
        }
        if (block.role === "user") {
          return block.content.trim();
        }
        return block.content.trim() || block.thinking.trim();
      }),
    [blocks],
  );
  const renderKeys = useMemo(() => blockRenderKeys(visibleBlocks), [visibleBlocks]);

  if (visibleBlocks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
        <ModusBot className="size-24" />
        <div className="space-y-2">
          <p className="text-[17px] font-normal tracking-tight text-fg-muted">
            Ready when you are.
          </p>
          <p className="text-[13px] tracking-tight text-fg-faint">
            Ask a question or describe a task to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-5xl px-6 pt-8 pb-24">
      <div className="space-y-4">
        {visibleBlocks.map((block, index) => (
          <m.div
            animate={{ opacity: 1 }}
            initial={{ opacity: 0 }}
            key={renderKeys[index]}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {block.type === "message" ? (
              <MessageBlock
                {...(block.actions ? { actions: block.actions } : {})}
                content={block.content}
                {...(block.createdAt !== undefined ? { createdAt: block.createdAt } : {})}
                messageRole={block.role}
                streaming={block.streaming ?? false}
                thinking={block.thinking}
              />
            ) : null}
            {block.type === "tool" ? (
              <ToolCard
                args={block.args}
                isComplete={block.isComplete ?? false}
                isError={block.isError ?? false}
                name={block.name}
                output={block.output}
              />
            ) : null}
            {block.type === "tool-group" ? (
              <ToolGroup isError={block.isError ?? false} name={block.name} tools={block.tools} />
            ) : null}
            {block.type === "permission" ? (
              <PermissionCard
                {...(onPermissionDecision ? { onDecide: onPermissionDecision } : {})}
                decision={block.decision}
                request={block.request}
              />
            ) : null}
            {block.type === "run" ? <RunRow block={block} /> : null}
            {block.type === "notice" ? <Notice {...block} /> : null}
            {block.type === "thinking" ? <ThinkingRow /> : null}
          </m.div>
        ))}
      </div>
    </div>
  );
}

function eventTime(createdAt: string | undefined, fallbackOrder: number): number {
  if (createdAt) {
    const parsed = Date.parse(createdAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallbackOrder * 1000;
}

function formatElapsed(end: number, start: number): string {
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}

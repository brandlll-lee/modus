import {
  IconAlertTriangle,
  IconChevronRight,
  IconSparkles,
} from "@tabler/icons-react";
import { m } from "motion/react";
import { useMemo } from "react";
import type {
  AgentEvent,
  PermissionDecision,
  PermissionRequest,
} from "../../../../shared/contracts";
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

type TimelineBlock =
  | MessageBlockItem
  | ToolBlockItem
  | PermissionBlockItem
  | RunBlockItem
  | NoticeBlockItem
  | ThinkingBlockItem;

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

function RunRow({ block }: { block: RunBlockItem }) {
  const isError = block.status === "failed" || block.status === "blocked";
  const elapsed = formatElapsed(block.completedAt ?? Date.now(), block.startedAt);
  return (
    <div className="border-hairline-soft border-b pb-3">
      <div className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
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

function ThinkingRow() {
  return (
    <div className="text-sm leading-relaxed">
      <ShinyText>Thinking</ShinyText>
    </div>
  );
}

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

export function Timeline({
  agentEvents,
  onPermissionDecision,
}: TimelineProps) {
  const blocks = useMemo(() => buildBlocks(agentEvents), [agentEvents]);
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

  if (visibleBlocks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
        <span className="flex size-8 items-center justify-center rounded-lg bg-white/4 text-fg-subtle">
          <IconSparkles size={15} stroke={1.5} />
        </span>
        <p className="text-sm text-fg-subtle">
          Session ready. The agent's responses will stream here.
        </p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-4xl px-6 py-8">
      <div className="space-y-4">
        {visibleBlocks.map((block) => (
          <m.div
            animate={{ opacity: 1 }}
            initial={{ opacity: 0 }}
            key={block.id}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {block.type === "message" ? (
              <MessageBlock
                content={block.content}
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
            {block.type === "permission" ? (
              <PermissionCard
                {...(onPermissionDecision ? { onDecide: onPermissionDecision } : {})}
                decision={block.decision}
                request={block.request}
              />
            ) : null}
            {block.type === "run" ? (
              <RunRow block={block} />
            ) : null}
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

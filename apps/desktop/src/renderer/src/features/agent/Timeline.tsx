import {
  IconAlertTriangle,
  IconCircleCheck,
  IconPlayerPlay,
  IconReportSearch,
  IconSparkles,
} from "@tabler/icons-react";
import { m } from "motion/react";
import type {
  AgentEvent,
  PermissionDecision,
  PermissionRequest,
} from "../../../../shared/contracts";
import { cn } from "../../lib/cn";
import { MessageBlock } from "./MessageBlock";
import { PermissionCard } from "./PermissionCard";
import { ToolCard } from "./ToolCard";

type TimelineProps = {
  agentEvents: Array<{ id: string; event: AgentEvent }>;
  pinnedUserMessageId?: string | null;
  onContinue?(): void;
  onPermissionDecision?(request: PermissionRequest, decision: PermissionDecision["decision"]): void;
  onReviewRun?(): void;
};

type MessageBlockItem = {
  id: string;
  type: "message";
  role: "assistant" | "user";
  content: string;
  thinking: string;
};

type ToolBlockItem = {
  id: string;
  type: "tool";
  name: string;
  args?: unknown;
  output: string;
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
};

type NoticeBlockItem = {
  id: string;
  type: "notice";
  title: string;
  body: string;
  isError?: boolean;
};

type TimelineBlock =
  | MessageBlockItem
  | ToolBlockItem
  | PermissionBlockItem
  | RunBlockItem
  | NoticeBlockItem;

export function buildBlocks(agentEvents: TimelineProps["agentEvents"]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  const blockById = new Map<string, TimelineBlock>();

  for (const { id, event } of agentEvents) {
    if (event.type === "run.started") {
      const block: RunBlockItem = {
        id: event.runId,
        type: "run",
        runId: event.runId,
        status: "running",
        delivery: event.delivery,
      };
      blocks.push(block);
      blockById.set(event.runId, block);
      continue;
    }

    if (event.type === "run.completed") {
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "completed";
        block.body = event.summary ?? "Ready for the next step.";
      } else {
        blocks.push({
          id: event.runId,
          type: "run",
          runId: event.runId,
          status: "completed",
          body: event.summary ?? "Ready for the next step.",
        });
      }
      continue;
    }

    if (event.type === "run.failed") {
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "failed";
        block.body = event.message;
      } else {
        blocks.push({
          id: event.runId,
          type: "run",
          runId: event.runId,
          status: "failed",
          body: event.message,
        });
      }
      continue;
    }

    if (event.type === "run.blocked") {
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "blocked";
        block.body = event.reason;
      } else {
        blocks.push({
          id: event.runId,
          type: "run",
          runId: event.runId,
          status: "blocked",
          body: event.reason,
        });
      }
      continue;
    }

    if (event.type === "run.cancelled") {
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "cancelled";
        block.body = "Stopped by user.";
      } else {
        blocks.push({
          id: event.runId,
          type: "run",
          runId: event.runId,
          status: "cancelled",
          body: "Stopped by user.",
        });
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
      blocks.push(block);
      blockById.set(event.messageId, block);
      continue;
    }

    if (event.type === "message.delta") {
      const block = blockById.get(event.messageId);
      if (block?.type === "message") {
        block.content += event.delta;
      }
      continue;
    }

    if (event.type === "thinking.delta") {
      const block = blockById.get(event.messageId);
      if (block?.type === "message") {
        block.thinking += event.delta;
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

  return blocks;
}

function RunRow({ block, onReviewRun }: { block: RunBlockItem; onReviewRun?: () => void }) {
  const isError = block.status === "failed" || block.status === "blocked";
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-fg-subtle">
      {block.status === "completed" ? (
        <IconCircleCheck className="shrink-0 text-success" size={15} stroke={1.65} />
      ) : (
        <IconPlayerPlay
          className={isError ? "shrink-0 text-danger" : "shrink-0 text-fg-faint"}
          size={15}
          stroke={1.65}
        />
      )}
      <span className={isError ? "text-danger" : "text-fg-muted"}>{block.status}</span>
      {block.delivery ? <span className="text-fg-faint">{block.delivery}</span> : null}
      {block.body ? <span className="min-w-0 truncate text-fg-faint">{block.body}</span> : null}
      {block.status === "completed" && onReviewRun ? (
        <button
          className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-hairline px-2 py-1 text-2xs text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          onClick={onReviewRun}
          type="button"
        >
          <IconReportSearch size={13} stroke={1.65} />
          Run review
        </button>
      ) : null}
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
  onContinue,
  onPermissionDecision,
  onReviewRun,
  pinnedUserMessageId,
}: TimelineProps) {
  const blocks = buildBlocks(agentEvents);
  const visibleBlocks = blocks.filter(
    (block) => block.type !== "message" || block.role !== "user" || block.content.trim(),
  );
  const pinnedBlock = pinnedUserMessageId
    ? visibleBlocks.find((block) => block.type === "message" && block.id === pinnedUserMessageId)
    : undefined;

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
    <div className="relative mx-auto w-full max-w-3xl px-6 py-8">
      {pinnedBlock?.type === "message" ? (
        <m.div
          animate={{ opacity: 1, y: 0 }}
          className="sticky top-0 z-10 mb-5 bg-canvas/96 pt-1 pb-3 backdrop-blur"
          initial={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          <MessageBlock content={pinnedBlock.content} messageRole="user" thinking="" />
        </m.div>
      ) : null}
      <div className="space-y-4">
        {visibleBlocks.map((block) => (
          <m.div
            animate={{ opacity: block.id === pinnedUserMessageId ? 0 : 1 }}
            className={cn(block.id === pinnedUserMessageId && "pointer-events-none")}
            data-message-id={block.type === "message" ? block.id : undefined}
            data-message-role={block.type === "message" ? block.role : undefined}
            initial={{ opacity: 0 }}
            key={block.id}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {block.type === "message" ? (
              <MessageBlock
                content={block.content}
                messageRole={block.role}
                thinking={block.thinking}
              />
            ) : null}
            {block.type === "tool" ? (
              <ToolCard
                args={block.args}
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
              <RunRow {...(onReviewRun ? { onReviewRun } : {})} block={block} />
            ) : null}
            {block.type === "notice" ? <Notice {...block} /> : null}
          </m.div>
        ))}
        {onContinue ? (
          <button
            className="rounded-md border border-hairline px-2.5 py-1.5 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            onClick={onContinue}
            type="button"
          >
            Continue
          </button>
        ) : null}
      </div>
    </div>
  );
}

import { IconAlertTriangle, IconSparkles } from "@tabler/icons-react";
import { m } from "motion/react";
import type { AgentEvent } from "../../../../shared/contracts";
import { MessageBlock } from "./MessageBlock";
import { PermissionCard } from "./PermissionCard";
import { ToolCard } from "./ToolCard";

type TimelineProps = {
  agentEvents: Array<{ id: string; event: AgentEvent }>;
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
};

type NoticeBlockItem = {
  id: string;
  type: "notice";
  title: string;
  body: string;
  isError?: boolean;
};

type TimelineBlock = MessageBlockItem | ToolBlockItem | PermissionBlockItem | NoticeBlockItem;

function buildBlocks(agentEvents: TimelineProps["agentEvents"]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  const blockById = new Map<string, TimelineBlock>();

  for (const { id, event } of agentEvents) {
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
      blocks.push({ id, type: "permission", request: event.request });
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

function Notice({ body, isError = false, title }: NoticeBlockItem) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-white/6 text-fg-subtle">
        <IconAlertTriangle size={13} stroke={1.7} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={
            isError
              ? "mb-1 font-mono text-2xs text-danger"
              : "mb-1 font-mono text-2xs text-fg-subtle"
          }
        >
          {title}
        </div>
        {body ? (
          <pre className="scroll-thin overflow-x-auto whitespace-pre-wrap rounded-md bg-white/2.5 px-3 py-2 font-mono text-xs text-fg-muted leading-relaxed">
            {body}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

export function Timeline({ agentEvents }: TimelineProps) {
  const blocks = buildBlocks(agentEvents);

  if (blocks.length === 0) {
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
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      {blocks.map((block) => (
        <m.div
          animate={{ opacity: 1 }}
          initial={{ opacity: 0 }}
          key={block.id}
          transition={{ duration: 0.15, ease: "easeOut" }}
        >
          {block.type === "message" ? (
            <MessageBlock content={block.content} role={block.role} thinking={block.thinking} />
          ) : null}
          {block.type === "tool" ? (
            <ToolCard
              args={block.args}
              isError={block.isError ?? false}
              name={block.name}
              output={block.output}
            />
          ) : null}
          {block.type === "permission" ? <PermissionCard request={block.request} /> : null}
          {block.type === "notice" ? <Notice {...block} /> : null}
        </m.div>
      ))}
    </div>
  );
}

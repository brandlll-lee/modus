import { IconAlertCircle } from "@tabler/icons-react";
import { useMemo } from "react";
import type { AgentEventItem } from "../../../../shared/agent-events";
import type {
  CompactionReason,
  ContextItem,
  ImageContent,
  MessageContextChip,
  ModelInfo,
  PromptImageAttachment,
  SkillSelection,
} from "../../../../shared/contracts";
import { toolRenderKind } from "../../../../shared/tools";
import { CopyButton } from "../../components/ui/CopyButton";
import { formatClock } from "../../lib/formatClock";
import { PreparingRow, WorkActivityRow, WorkFold } from "./ActivityGroup";
import { MessageBlock } from "./MessageBlock";
import { RequestStatusRow } from "./RequestStatusRow";

type TimelineProps = {
  sessionId?: string | undefined;
  /** Blocks built by the owner (ChatPane) — the single authority for this list. */
  blocks: TimelineBlock[];
  preparing?: boolean;
  enteringMessageId?: string | undefined;
  onMessageEntered?(messageId: string): void;
  /** Session cwd — file chips / markdown file nav resolve against the workspace. */
  cwd?: string | undefined;
  /** Active pane model — needed so inline edit can mount the shared Composer. */
  model?: string | undefined;
  models?: ModelInfo[];

  /**
   * Cursor-style edit & resend: rolls the session back to just before the
   * message, then re-prompts with the edited text. Rejections surface inline
   * in the message editor.
   */
  onEditResend?(
    messageId: string,
    message: string,
    attachments?: PromptImageAttachment[],
    contextItems?: ContextItem[],
    skills?: SkillSelection[],
  ): Promise<void>;

  /** Open a workspace file path in the Files inspector. */
  onOpenFile?(path: string): void;
  workspaceId?: string | undefined;
};

export type MessageBlockItem = {
  id: string;
  type: "message";
  role: "assistant" | "user";
  content: string;
  streaming?: boolean;
  /** Epoch ms — user send time, or assistant completion time. */
  createdAt?: number;

  /** User only: images attached to the prompt. */
  attachments?: PromptImageAttachment[];
  /** User only: context chips attached to the prompt (shown in the bubble). */
  contextChips?: MessageContextChip[];
  /** User only: original context items for edit-and-resend. */
  contextItems?: ContextItem[];
  /** User only: selected skills attached to the prompt. */
  skills?: SkillSelection[];

  editable?: boolean;
};

export type ToolBlockItem = {
  id: string;
  type: "tool";
  name: string;
  label?: string;
  parentToolCallId?: string;
  args?: unknown;
  output: string;
  images?: ImageContent[];
  details?: unknown;
  isComplete?: boolean;
  isError?: boolean;
};

export type ThoughtBlockItem = {
  id: string;
  type: "thought";
  text: string;
  /** True while the segment is still being produced. */
  streaming?: boolean;
};

export type RunBlockItem = {
  id: string;
  type: "run";
  runId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  delivery?: string;
  body?: string;
  startedAt: number;
  executionStartedAt?: number;
  executionCompletedAt?: number;
  completedAt?: number;
  /**
   * The whole turn's aggregated assistant markdown, attached once the run
   * settles. The turn footer is the single copy surface for the answer (there
   * is no separate per-message footer), so this powers its "Copy response"
   * button. Absent when the turn produced no assistant text.
   */
  answer?: string;
};

type NoticeBlockItem = {
  id: string;
  type: "notice";
  title: string;
  body: string;
  isError?: boolean;
};

export type CompactionBlockItem = {
  id: string;
  type: "compaction";
  reason: CompactionReason | undefined;
  status: "running" | "done" | "aborted" | "error";
  /** Trailing status text (reason while running; ended/aborted/error detail when settled). */
  detail?: string;
};

export type RequestStatusBlockItem = {
  id: string;
  type: "request-status";
  status: "retrying" | "done" | "failed" | "cancelled";
  attempt?: number;
  maxAttempts?: number;
  nextAt?: number;
  detail?: string;
  recovered?: boolean;
};

export type WorkActivityItem = ThoughtBlockItem | ToolBlockItem | CompactionBlockItem;

export type WorkActivityGroupItem = {
  id: string;
  type: "work-activity-group";
  items: WorkActivityItem[];
};

export type WorkImageGroupItem = {
  id: string;
  type: "work-image-group";
  items: ToolBlockItem[];
};

export type WorkFoldItem =
  | WorkActivityGroupItem
  | WorkImageGroupItem
  | NoticeBlockItem
  | MessageBlockItem
  | RequestStatusBlockItem;

/**
 * One turn's work under a single Cursor-style fold (Working for… / Worked for…).
 * Built by {@link groupTurnWork} from the run block + in-turn work items.
 */
export type WorkFoldBlockItem = {
  id: string;
  type: "work-fold";
  run: RunBlockItem;
  items: WorkFoldItem[];
};

export type TimelineBlock =
  | MessageBlockItem
  | ToolBlockItem
  | ThoughtBlockItem
  | RunBlockItem
  | NoticeBlockItem
  | CompactionBlockItem
  | WorkFoldBlockItem
  | RequestStatusBlockItem;

export function buildBlocks(agentEvents: AgentEventItem[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  const blockById = new Map<string, TimelineBlock>();
  /** Open compaction row id so started/ended upsert into one tool-like line. */
  let openCompactionId: string | undefined;
  let order = 0;
  let activeAssistantMessageId: string | undefined;
  let activeRunId: string | undefined;
  let requestStatus: RequestStatusBlockItem | undefined;
  function statusRow(id: string): RequestStatusBlockItem {
    if (!requestStatus) {
      requestStatus = { id, type: "request-status", status: "done" };
      blocks.push(requestStatus);
    }
    return requestStatus;
  }
  const loopStartedAtByRun = new Map<string, number>();
  let lastUserMessageBlock: MessageBlockItem | undefined;
  /** Thinking now streams as its own ordered block, keyed by its message. */
  const thoughtByMessage = new Map<string, ThoughtBlockItem>();
  const assistantSegmentByMessage = new Map<string, MessageBlockItem>();
  const assistantSegmentCountByMessage = new Map<string, number>();
  function appendMessageBlock(block: MessageBlockItem): MessageBlockItem {
    blocks.push(block);
    blockById.set(block.id, block);
    if (block.role === "assistant") {
      activeAssistantMessageId = block.id;
      assistantSegmentByMessage.set(block.id, block);
      assistantSegmentCountByMessage.set(block.id, 0);
    } else {
      lastUserMessageBlock = block;
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
    });
  }

  function assistantTextSegment(messageId: string): MessageBlockItem {
    const current = assistantSegmentByMessage.get(messageId);
    if (!current) {
      return ensureAssistantMessageBlock(messageId);
    }
    if (blocks.at(-1) === current) {
      activeAssistantMessageId = messageId;
      return current;
    }
    const next = (assistantSegmentCountByMessage.get(messageId) ?? 0) + 1;
    assistantSegmentCountByMessage.set(messageId, next);
    const segment: MessageBlockItem = {
      id: `${messageId}:segment:${next}`,
      type: "message",
      role: "assistant",
      content: "",
    };
    blocks.push(segment);
    blockById.set(segment.id, segment);
    blockById.set(messageId, segment);
    assistantSegmentByMessage.set(messageId, segment);
    activeAssistantMessageId = messageId;
    return segment;
  }

  function upsertToolBlock(toolCallId: string, toolName: string, args: unknown): ToolBlockItem {
    const existing = blockById.get(toolCallId);
    if (existing?.type === "tool") {
      existing.args = args;
      return existing;
    }
    const block: ToolBlockItem = {
      id: toolCallId,
      type: "tool",
      name: toolName,
      args,
      output: "",
    };
    blocks.push(block);
    blockById.set(toolCallId, block);
    return block;
  }

  for (const item of agentEvents) {
    const { id, event } = item;
    const eventAt = eventTime(item.createdAt, order);
    if (event.type === "run.started") {
      requestStatus = undefined;
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
      const anchorBlock = event.userMessageId
        ? blockById.get(event.userMessageId)
        : lastUserMessageBlock;
      if (anchorBlock?.type === "message" && anchorBlock.role === "user") {
        anchorBlock.editable = event.delivery === "normal";
      }
      continue;
    }

    if (event.type === "session.status" && event.status.type === "retry") {
      const row = statusRow(`retry:${id}`);
      row.status = "retrying";
      row.attempt = event.status.attempt;
      row.maxAttempts = event.status.maxAttempts;
      row.nextAt = event.status.nextAt;
      row.detail = event.status.message;
      continue;
    }

    if (event.type === "retry.ended") {
      if (requestStatus) {
        requestStatus.status = "done";
        if (event.success !== undefined) requestStatus.recovered = event.success;
        if (event.finalError) requestStatus.detail = event.finalError;
        if (event.success) requestStatus = undefined;
      }
      continue;
    }

    if (event.type === "agent.started") {
      if (activeRunId && !loopStartedAtByRun.has(activeRunId))
        loopStartedAtByRun.set(activeRunId, eventAt);
      continue;
    }

    if (event.type === "turn.started" || event.type === "agent.ended") {
      const run = activeRunId ? blockById.get(activeRunId) : undefined;
      if (run?.type === "run") {
        if (event.type === "turn.started") run.executionStartedAt ??= eventAt;
        else run.executionCompletedAt = eventAt;
      }
      continue;
    }

    if (event.type === "run.completed") {
      if (requestStatus?.status === "retrying") {
        requestStatus.status = "done";
        requestStatus.recovered = true;
      }
      const block = blockById.get(event.runId);
      if (block?.type === "run") {
        block.status = "completed";
        const loopStartedAt = loopStartedAtByRun.get(event.runId);
        if (loopStartedAt !== undefined) block.executionStartedAt ??= loopStartedAt;
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
      // Per-turn file stats stay on ChangesStrip above the composer (Review),
      // not as an end-of-turn card in the timeline.
      if (activeRunId === event.runId) {
        activeRunId = undefined;
      }
      continue;
    }

    if (event.type === "run.failed") {
      const row = statusRow(`failure:${event.runId}`);
      row.status = "failed";
      row.detail = event.message;
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

    if (event.type === "run.cancelled") {
      if (requestStatus) requestStatus.status = "cancelled";
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
      if (event.role === "user" && !activeRunId) requestStatus = undefined;
      const contextChips = event.contextChips?.filter(
        (chip): chip is NonNullable<(typeof event.contextChips)[number]> =>
          chip != null && typeof chip.kind === "string",
      );
      const block: MessageBlockItem = {
        id: event.messageId,
        type: "message",
        role: event.role,
        content: "",
        createdAt: eventAt,
        ...(event.attachments && event.attachments.length > 0
          ? { attachments: event.attachments }
          : {}),
        ...(contextChips && contextChips.length > 0 ? { contextChips } : {}),
        ...(event.contextItems && event.contextItems.length > 0
          ? { contextItems: event.contextItems }
          : {}),
        ...(event.skills && event.skills.length > 0 ? { skills: event.skills } : {}),
      };
      appendMessageBlock(block);
      continue;
    }

    if (event.type === "message.delta") {
      const block = blockById.get(event.messageId);
      if (block?.type === "message" && block.role === "user") {
        block.content += event.delta;
      } else if (block?.type === "message" && block.role === "assistant") {
        assistantTextSegment(event.messageId).content += event.delta;
      } else if (activeAssistantMessageId) {
        assistantTextSegment(activeAssistantMessageId).content += event.delta;
      } else {
        assistantTextSegment(event.messageId).content += event.delta;
      }
      continue;
    }

    if (event.type === "thinking.delta") {
      // Route to a dedicated thought block (orphan deltas from old logs attach to
      // the active assistant message). Keep thoughts above their sibling answer
      // by splicing in just before the message block when it already exists.
      const targetId = blockById.has(event.messageId)
        ? event.messageId
        : (activeAssistantMessageId ?? event.messageId);
      let thought = thoughtByMessage.get(targetId);
      if (!thought) {
        thought = {
          id: `thought:${targetId}`,
          type: "thought",
          text: "",
          streaming: true,
        };
        thoughtByMessage.set(targetId, thought);
        blockById.set(thought.id, thought);
        const sibling = blockById.get(targetId);
        const siblingIndex = sibling ? blocks.indexOf(sibling) : -1;
        if (siblingIndex >= 0) {
          blocks.splice(siblingIndex, 0, thought);
        } else {
          blocks.push(thought);
        }
      }
      thought.text += event.delta;
      thought.streaming = true;
      continue;
    }

    if (event.type === "thinking.completed") {
      const thought = thoughtByMessage.get(event.messageId);
      if (thought) {
        thought.streaming = false;
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

    if (event.type === "tool.delta") {
      const deltaKind = toolRenderKind(event.toolName);

      // Diff tools bind live partial args; title-facing tools wait for tool.started.
      if (deltaKind === "diff") {
        upsertToolBlock(event.toolCallId, event.toolName, event.args);
      }
      continue;
    }

    if (event.type === "tool.started") {
      // Idempotent: a live `tool.delta` may have already created the block.
      // Refresh its args with the authoritative ones rather than forking a
      // duplicate card.
      const block = upsertToolBlock(event.toolCallId, event.toolName, event.args);
      if (event.parentToolCallId) block.parentToolCallId = event.parentToolCallId;
      if (event.label) block.label = event.label;
      continue;
    }

    if (event.type === "tool.output") {
      const block = blockById.get(event.toolCallId);
      if (block?.type === "tool") {
        // Pi's tool_execution_update carries the full partialResult each time —
        // replace, don't append, or progress frames concatenate and final labels break.
        block.output = event.output;
        block.details = event.details;
        if (event.images) block.images = event.images;
        else delete block.images;
      }
      continue;
    }

    if (event.type === "tool.ended") {
      const block = blockById.get(event.toolCallId);
      if (block?.type === "tool") {
        block.isComplete = true;
        block.isError = event.isError;
        if (event.output !== undefined) block.output = event.output;
        block.details = event.details;
        if (event.images) block.images = event.images;
        else if (event.output !== undefined) delete block.images;
      }

      continue;
    }

    if (event.type === "extension.notice") {
      continue;
    }

    if (event.type === "runtime.error") {
      const row = statusRow(`failure:${id}`);
      row.status = "failed";
      row.detail = event.message;
      continue;
    }

    if (event.type === "queue.updated") {
      // Pi queue noise (steer/follow-up envelopes) — not a user-facing notice.
      continue;
    }

    if (event.type === "compaction.started") {
      const compactionId = `compaction:${id}`;
      openCompactionId = compactionId;
      const block: CompactionBlockItem = {
        id: compactionId,
        type: "compaction",
        reason: event.reason,
        status: "running",
        detail: event.reason,
      };
      blocks.push(block);
      blockById.set(compactionId, block);
      continue;
    }

    if (event.type === "compaction.ended") {
      const existing = openCompactionId ? blockById.get(openCompactionId) : undefined;
      const status = event.aborted ? "aborted" : event.failed ? "error" : "done";
      const detail = event.aborted
        ? "Context compaction stopped"
        : event.failed
          ? (event.summary ?? "Context compaction failed")
          : "Context compacted";
      if (existing?.type === "compaction") {
        existing.reason = event.reason;
        existing.status = status;
        existing.detail = detail;
      } else {
        const compactionId = `compaction:${id}`;
        const block: CompactionBlockItem = {
          id: compactionId,
          type: "compaction",
          reason: event.reason,
          status,
          detail,
        };
        blocks.push(block);
        blockById.set(compactionId, block);
      }
      openCompactionId = undefined;
    }
  }

  const runStillRunning =
    activeRunId !== undefined &&
    (() => {
      const runBlock = blockById.get(activeRunId);
      return runBlock?.type === "run" && runBlock.status === "running";
    })();

  if (runStillRunning && activeAssistantMessageId) {
    const activeBlock = blockById.get(activeAssistantMessageId);
    if (activeBlock?.type === "message" && activeBlock.role === "assistant") {
      activeBlock.streaming = true;
    }
  }

  if (!runStillRunning) {
    for (const thought of thoughtByMessage.values()) {
      thought.streaming = false;
    }
  }

  return blocks;
}

/**
 * A single agent turn (one run) can produce SEVERAL assistant message segments
 * interleaved with tool calls. We want exactly one copy surface per turn — so we
 * aggregate the whole turn's assistant markdown onto the turn's RUN block
 * (`answer`) once it has settled. The turn footer copies from that answer.
 */
export function attachTurnActions(blocks: TimelineBlock[]): TimelineBlock[] {
  let run: RunBlockItem | undefined;
  let parts: string[] = [];

  const seal = (): void => {
    if (run && run.status !== "running" && parts.length > 0) {
      run.answer = parts.join("\n\n");
    }
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

export type TimelineTurn = {
  key: string;
  blocks: Array<{ block: TimelineBlock; key: string }>;
};

/**
 * A user message opens a turn; everything after it belongs to that turn until
 * the next one.
 */
export function segmentTurns(blocks: TimelineBlock[], keys: string[]): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  blocks.forEach((block, index) => {
    const key = keys[index] ?? block.id;
    if (turns.length === 0 || (block.type === "message" && block.role === "user")) {
      turns.push({ key, blocks: [] });
    }
    turns.at(-1)?.blocks.push({ block, key });
  });
  return turns;
}

function isWorkAnchor(block: TimelineBlock): boolean {
  return (
    block.type === "tool" ||
    block.type === "thought" ||
    (block.type === "compaction" && block.reason !== "manual") ||
    block.type === "request-status" ||
    block.type === "notice"
  );
}

function isWorkActivity(block: TimelineBlock): block is WorkActivityItem {
  return block.type === "tool" || block.type === "thought" || block.type === "compaction";
}

/** Messages and notices bound local activity folds. */
export function groupWorkItems(
  items: Array<WorkActivityItem | NoticeBlockItem | MessageBlockItem | RequestStatusBlockItem>,
): WorkFoldItem[] {
  const result: WorkFoldItem[] = [];
  for (const item of items) {
    if (item.type === "tool" && item.images?.length) {
      const current = result.at(-1);
      if (current?.type === "work-image-group") current.items.push(item);
      else result.push({ id: `work-images:${item.id}`, type: "work-image-group", items: [item] });
      continue;
    }
    if (!isWorkActivity(item)) {
      result.push(item);
      continue;
    }
    const current = result.at(-1);
    if (current?.type === "work-activity-group") current.items.push(item);
    else
      result.push({ id: `work-activity:${item.id}`, type: "work-activity-group", items: [item] });
  }
  return result;
}

/**
 * Fold an entire run's work into one Cursor-style WorkFold.
 *
 * Authority: `run.status` + turn boundary (next run, or next user when settled).
 * Settled final text follows the last work anchor. While a run is active its
 * assistant segments stay in the fold, so later tools cannot reparent them.
 */
export function groupTurnWork(blocks: TimelineBlock[]): TimelineBlock[] {
  const result: TimelineBlock[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];
    if (!block) {
      index += 1;
      continue;
    }

    if (block.type !== "run") {
      result.push(block);
      index += 1;
      continue;
    }

    const run = block;
    index += 1;
    const turnContent: TimelineBlock[] = [];
    while (index < blocks.length) {
      const next = blocks[index];
      if (!next) break;
      if (next.type === "run") break;
      if (next.type === "message" && next.role === "user" && run.status !== "running") {
        break;
      }
      turnContent.push(next);
      index += 1;
    }

    const active = run.status === "running";
    let lastWork = -1;
    for (let j = 0; j < turnContent.length; j += 1) {
      const candidate = turnContent[j];
      if (candidate && isWorkAnchor(candidate)) {
        lastWork = j;
      }
    }

    const items: Array<
      WorkActivityItem | NoticeBlockItem | MessageBlockItem | RequestStatusBlockItem
    > = [];
    const after: TimelineBlock[] = [];

    for (let j = 0; j < turnContent.length; j += 1) {
      const entry = turnContent[j];
      if (!entry) continue;

      if (entry.type === "compaction" && entry.reason === "manual") {
        after.push(entry);
        continue;
      }

      if (entry.type === "message" && entry.role === "assistant") {
        if (!entry.content.trim()) continue;
        if (active || j <= lastWork) items.push(entry);
        else after.push(entry);
        continue;
      }

      if (entry.type === "message" && entry.role === "user") {
        items.push(entry);
        continue;
      }

      if (
        isWorkActivity(entry) ||
        entry.type === "notice" ||
        entry.type === "message" ||
        entry.type === "request-status"
      ) {
        items.push(entry);
      } else {
        after.push(entry);
      }
    }

    if (items.length > 0 || active) {
      result.push({
        id: `work-fold:${run.runId}`,
        type: "work-fold",
        run,
        items: groupWorkItems(items),
      });
    }
    result.push(...after);
  }

  return result;
}

export function visibleTimelineBlocks(blocks: TimelineBlock[]): TimelineBlock[] {
  return blocks.filter((block) => {
    if (block.type === "thought") {
      return block.text.trim().length > 0;
    }
    if (block.type === "work-fold") {
      return true;
    }
    if (block.type !== "message") {
      return true;
    }
    return block.content.trim().length > 0 || Boolean(block.attachments?.length);
  });
}

export function buildVisibleTimelineBlocks(agentEvents: AgentEventItem[]): TimelineBlock[] {
  return visibleTimelineBlocks(groupTurnWork(attachTurnActions(buildBlocks(agentEvents))));
}

function Notice({ body, isError = false, title }: NoticeBlockItem) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm text-fg-subtle">
      <IconAlertCircle
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

function TurnFooter({ turn }: { turn: TimelineTurn }) {
  const fold = turn.blocks.find(({ block }) => block.type === "work-fold")?.block;
  if (fold?.type !== "work-fold" || !fold.run.answer) {
    return null;
  }
  const clock = formatClock(fold.run.completedAt);
  return (
    <div className="pointer-events-none flex h-6 w-full items-center gap-1 px-8 opacity-0 transition-opacity duration-150 group-hover/turn:pointer-events-auto group-hover/turn:opacity-100 group-focus-within/turn:pointer-events-auto group-focus-within/turn:opacity-100">
      <CopyButton label="Copy response" text={fold.run.answer} />
      {clock && fold.run.completedAt !== undefined ? (
        <time
          className="text-2xs text-fg-faint tabular-nums"
          dateTime={new Date(fold.run.completedAt).toISOString()}
        >
          {clock}
        </time>
      ) : null}
    </div>
  );
}

export function Timeline({
  sessionId,
  blocks,
  preparing = false,
  enteringMessageId,
  onMessageEntered,
  cwd,
  model,
  models,
  workspaceId,
  onEditResend,
  onOpenFile,
}: TimelineProps) {
  const renderKeys = useMemo(() => blockRenderKeys(blocks), [blocks]);
  const turns = useMemo(() => segmentTurns(blocks, renderKeys), [blocks, renderKeys]);

  if (blocks.length === 0 && !preparing) {
    return null;
  }

  return (
    <div className="min-w-0 w-full max-w-full px-4 pt-8 pb-24">
      {/* Same .chat-column token as ChatPane's composer wrapper — one width authority,
          shared by content only. The scroll container above stays full-bleed. */}
      <div className="chat-column relative">
        {turns.map((turn) => (
          <section
            className="group/turn timeline-block w-full min-w-0 space-y-6 pb-6"
            data-turn={turn.key}
            key={turn.key}
          >
            {turn.blocks.map(({ block, key }) => {
              if (block.type === "message" && block.role === "user") {
                return (
                  <MessageBlock
                    animateEntry={block.id === enteringMessageId}
                    {...(block.id === enteringMessageId && onMessageEntered
                      ? { onEntryComplete: () => onMessageEntered(block.id) }
                      : {})}
                    sessionId={sessionId}
                    key={key}
                    {...(block.attachments ? { attachments: block.attachments } : {})}
                    {...(block.contextChips ? { contextChips: block.contextChips } : {})}
                    {...(block.contextItems ? { contextItems: block.contextItems } : {})}
                    {...(block.skills ? { skills: block.skills } : {})}
                    content={block.content}
                    cwd={cwd}
                    {...(onOpenFile ? { onOpenFile } : {})}
                    editable={block.editable ?? false}
                    messageId={block.id}
                    {...(onEditResend ? { onEditResend } : {})}
                    {...(model ? { model } : {})}
                    {...(models ? { models } : {})}
                    messageRole={block.role}
                    streaming={block.streaming ?? false}
                    workspaceId={workspaceId}
                  />
                );
              }

              return (
                <div className="w-full px-8" key={key}>
                  {block.type === "work-fold" ? (
                    <WorkFold
                      enteringMessageId={enteringMessageId}
                      {...(onMessageEntered ? { onMessageEntered } : {})}
                      items={block.items}
                      run={block.run}
                      {...(onOpenFile ? { onOpenFile } : {})}
                    />
                  ) : null}
                  {block.type === "message" ? (
                    <MessageBlock
                      sessionId={sessionId}
                      {...(block.attachments ? { attachments: block.attachments } : {})}
                      {...(block.contextChips ? { contextChips: block.contextChips } : {})}
                      {...(block.contextItems ? { contextItems: block.contextItems } : {})}
                      {...(block.skills ? { skills: block.skills } : {})}
                      content={block.content}
                      cwd={cwd}
                      {...(onOpenFile ? { onOpenFile } : {})}
                      editable={block.editable ?? false}
                      messageId={block.id}
                      {...(onEditResend ? { onEditResend } : {})}
                      messageRole={block.role}
                      streaming={block.streaming ?? false}
                      workspaceId={workspaceId}
                    />
                  ) : null}
                  {block.type === "notice" ? <Notice {...block} /> : null}
                  {block.type === "request-status" ? <RequestStatusRow item={block} /> : null}
                  {isWorkActivity(block) ? (
                    <WorkActivityRow item={block} {...(onOpenFile ? { onOpenFile } : {})} />
                  ) : null}
                </div>
              );
            })}
            <TurnFooter turn={turn} />
          </section>
        ))}
        {preparing ? (
          <div className="px-8">
            <PreparingRow />
          </div>
        ) : null}
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

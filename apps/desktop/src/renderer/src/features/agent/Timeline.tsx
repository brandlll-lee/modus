import { IconAlertCircle, IconCircleDashed, IconListCheck } from "@tabler/icons-react";
import { useMemo } from "react";
import type { AgentEventItem } from "../../../../shared/agent-events";
import type {
  CompactionReason,
  ContextItem,
  MessageContextChip,
  ModelInfo,
  PlanRef,
  PromptImageAttachment,
  QuestionAnswer,
  QuestionRequest,
  SkillSelection,
  SubagentActivity,
  SubagentStatus,
  TodoItem,
} from "../../../../shared/contracts";
import { getToolUiMeta, toolRenderKind } from "../../../../shared/tools";
import { WorkActivityRow, WorkFold } from "./ActivityGroup";
import { MessageBlock } from "./MessageBlock";

type TimelineProps = {
  agentEvents: AgentEventItem[];
  precomputedBlocks?: TimelineBlock[];
  /** Session cwd — file chips / markdown file nav resolve against the workspace. */
  cwd?: string | undefined;
  /** Active pane model — needed so inline edit can mount the shared Composer. */
  model?: string | undefined;
  models?: ModelInfo[];
  onRestoreCheckpoint?(checkpointId: string): Promise<void> | void;
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
  onOpenSubagent?(childSessionId: string): void;
  onOpenPlan?(plan: PlanRef): void;
  /** Open a workspace file path in the Files inspector. */
  onOpenFile?(path: string): void;
  workspaceId?: string | undefined;
  /** Tighter padding when embedded in the subagent preview sheet (no composer clearance). */
  embedded?: boolean | undefined;
};

export type MessageBlockItem = {
  id: string;
  type: "message";
  role: "assistant" | "user";
  content: string;
  streaming?: boolean;
  /** Epoch ms — user send time, or assistant completion time. */
  createdAt?: number;
  /** User only: pre-run snapshot this message can roll the files back to. */
  checkpointId?: string;
  /** User only: images attached to the prompt. */
  attachments?: PromptImageAttachment[];
  /** User only: context chips attached to the prompt (shown in the bubble). */
  contextChips?: MessageContextChip[];
  /** User only: original context items for edit-and-resend. */
  contextItems?: ContextItem[];
  /** User only: selected skills attached to the prompt. */
  skills?: SkillSelection[];
  /**
   * User only: present when this message is a "Build this plan" action — the
   * timeline renders a compact Build card (title + N To-dos) instead of the raw
   * build instruction text.
   */
  planBuild?: { planId: string; title: string; todoCount: number };
  /**
   * User only: this message anchored a normal-delivery run, so it can be
   * edited & resent (rolling the session back to this point). Steered and
   * queued follow-up messages have no stable rollback anchor.
   */
  editable?: boolean;
};

export type ToolBlockItem = {
  id: string;
  type: "tool";
  name: string;
  args?: unknown;
  output: string;
  isComplete?: boolean;
  isError?: boolean;
  questionRequest?: QuestionRequest;
  questionAnswers?: QuestionAnswer[];
  questionSkipped?: boolean;
  plan?: PlanRef;
};

export type ThoughtBlockItem = {
  id: string;
  type: "thought";
  text: string;
  /** True while the segment is still being produced — label shimmers, body live. */
  streaming?: boolean;
  /** Wall-clock from first / last thinking.delta (via event createdAt/updatedAt). */
  startedAt?: number;
  completedAt?: number;
};

export type RunBlockItem = {
  id: string;
  type: "run";
  runId: string;
  status: "running" | "completed" | "failed" | "blocked" | "cancelled";
  delivery?: string;
  body?: string;
  startedAt: number;
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
  reason: CompactionReason;
  status: "running" | "done" | "aborted" | "error";
  /** Trailing status text (reason while running; ended/aborted/error detail when settled). */
  detail?: string;
};

type TodosBlockItem = {
  id: string;
  type: "todos";
  todos: TodoItem[];
  /** A todo_write call is in flight — the card shows "Updating to-dos…". */
  updating: boolean;
};

export type SubagentBlockItem = {
  id: string;
  type: "subagent";
  childSessionId: string;
  task: string;
  subagentType: string;
  status: SubagentStatus;
  model?: string;
  activity?: SubagentActivity;
};

export type WorkActivityItem =
  | ThoughtBlockItem
  | ToolBlockItem
  | TodosBlockItem
  | SubagentBlockItem
  | CompactionBlockItem;

export type GroupedWorkActivityItem = ToolBlockItem | CompactionBlockItem;

export type WorkActivityGroupItem = {
  id: string;
  type: "work-activity-group";
  items: GroupedWorkActivityItem[];
};

export type WorkFoldItem =
  | WorkActivityGroupItem
  | WorkActivityItem
  | NoticeBlockItem
  | MessageBlockItem;

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
  | TodosBlockItem
  | SubagentBlockItem;

export function buildBlocks(agentEvents: TimelineProps["agentEvents"]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  const blockById = new Map<string, TimelineBlock>();
  /** todo_write tool calls render through the TodosCard, not as tool rows. */
  const todoToolCallIds = new Set<string>();
  const subagentToolCallIds = new Set<string>();
  const subagentsByChild = new Map<string, SubagentBlockItem>();
  /** Open compaction row id so started/ended upsert into one tool-like line. */
  let openCompactionId: string | undefined;
  const questionToolByRequest = new Map<string, string>();
  const visualToolById = new Map<string, ToolBlockItem>();
  const planToolByHash = new Map<string, ToolBlockItem>();
  let activeQuestionToolId: string | undefined;
  let activePlanToolId: string | undefined;
  let latestTodosBlock: TodosBlockItem | undefined;
  let todoLifecycleOpen = false;
  let hasRenderedAnyTodoBlock = false;
  let todoUpdatesInFlight = 0;
  let order = 0;
  let activeAssistantMessageId: string | undefined;
  let activeRunId: string | undefined;
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
    const visualId = toolRenderKind(toolName) === "visual" ? visualIdFromArgs(args) : undefined;
    const existing = blockById.get(toolCallId);
    if (existing?.type === "tool") {
      existing.args = args;
      if (visualId) {
        visualToolById.set(visualId, existing);
      }
      return existing;
    }
    const visualBlock = visualId ? visualToolById.get(visualId) : undefined;
    if (visualBlock) {
      visualBlock.args = args;
      visualBlock.output = "";
      visualBlock.isComplete = false;
      visualBlock.isError = false;
      blockById.set(toolCallId, visualBlock);
      return visualBlock;
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
    if (visualId) {
      visualToolById.set(visualId, block);
    }
    return block;
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
      // Mark the user message this run answers as editable (edit & resend
      // rolls back to it). Only normal-delivery runs have a rollback anchor.
      const anchorBlock = event.userMessageId
        ? blockById.get(event.userMessageId)
        : lastUserMessageBlock;
      if (anchorBlock?.type === "message" && anchorBlock.role === "user") {
        anchorBlock.editable = event.delivery === "normal";
      }
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
      // Per-turn file stats stay on ChangesStrip above the composer (Review),
      // not as an end-of-turn card in the timeline.
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
        ...(event.planBuild ? { planBuild: event.planBuild } : {}),
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
      const eventEndAt = eventTime(item.updatedAt ?? item.createdAt, order);
      let thought = thoughtByMessage.get(targetId);
      if (!thought) {
        thought = {
          id: `thought:${targetId}`,
          type: "thought",
          text: "",
          streaming: true,
          startedAt: eventAt,
          completedAt: eventEndAt,
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
      thought.completedAt = eventEndAt;
      continue;
    }

    if (event.type === "thinking.completed") {
      const thought = thoughtByMessage.get(event.messageId);
      if (thought) {
        thought.streaming = false;
        thought.completedAt = eventAt;
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
      if (deltaKind === "todo") {
        if (!todoToolCallIds.has(event.toolCallId)) {
          todoToolCallIds.add(event.toolCallId);
          todoUpdatesInFlight += 1;
        }
        continue;
      }
      if (deltaKind === "subagent") {
        subagentToolCallIds.add(event.toolCallId);
        continue;
      }
      if (deltaKind === "question") {
        activeQuestionToolId = event.toolCallId;
      }
      if (deltaKind === "plan") {
        activePlanToolId = event.toolCallId;
      }
      // Diff/visual bind live partial args; title-facing tools wait for tool.started.
      if (deltaKind === "diff" || deltaKind === "visual") {
        upsertToolBlock(event.toolCallId, event.toolName, event.args);
      }
      continue;
    }

    if (event.type === "tool.started") {
      // todo_write surfaces through TodosCard snapshots instead of a tool row.
      if (toolRenderKind(event.toolName) === "todo") {
        if (!todoToolCallIds.has(event.toolCallId)) {
          todoToolCallIds.add(event.toolCallId);
          todoUpdatesInFlight += 1;
        }
        continue;
      }
      if (toolRenderKind(event.toolName) === "subagent") {
        subagentToolCallIds.add(event.toolCallId);
        continue;
      }
      if (toolRenderKind(event.toolName) === "question") {
        activeQuestionToolId = event.toolCallId;
      }
      if (toolRenderKind(event.toolName) === "plan") {
        activePlanToolId = event.toolCallId;
      }
      // Idempotent: a live `tool.delta` may have already created the block.
      // Refresh its args with the authoritative ones rather than forking a
      // duplicate card.
      upsertToolBlock(event.toolCallId, event.toolName, event.args);
      continue;
    }

    if (event.type === "tool.output") {
      if (todoToolCallIds.has(event.toolCallId)) {
        continue;
      }
      if (subagentToolCallIds.has(event.toolCallId)) {
        continue;
      }
      const block = blockById.get(event.toolCallId);
      if (block?.type === "tool") {
        // Pi's tool_execution_update carries the full partialResult each time —
        // replace, don't append, or progress frames concatenate and final labels break.
        block.output = event.output;
      }
      continue;
    }

    if (event.type === "tool.ended") {
      if (todoToolCallIds.has(event.toolCallId)) {
        todoToolCallIds.delete(event.toolCallId);
        todoUpdatesInFlight = Math.max(0, todoUpdatesInFlight - 1);
        if (latestTodosBlock) {
          latestTodosBlock.updating = todoUpdatesInFlight > 0;
        }
        continue;
      }
      if (subagentToolCallIds.has(event.toolCallId)) {
        subagentToolCallIds.delete(event.toolCallId);
        continue;
      }
      const block = blockById.get(event.toolCallId);
      if (block?.type === "tool") {
        block.isComplete = true;
        block.isError = event.isError;
      }
      if (activeQuestionToolId === event.toolCallId) {
        activeQuestionToolId = undefined;
      }
      if (activePlanToolId === event.toolCallId) {
        activePlanToolId = undefined;
      }
      continue;
    }

    if (event.type === "plan.updated") {
      const source = blockById.get(event.toolCallId ?? activePlanToolId ?? "");
      const block =
        source?.type === "tool" && toolRenderKind(source.name) === "plan"
          ? source
          : planToolByHash.get(event.plan.hash);
      if (block) {
        block.plan = event.plan;
        planToolByHash.set(event.plan.hash, block);
      }
      continue;
    }

    if (event.type === "question.requested") {
      const block = activeQuestionToolId ? blockById.get(activeQuestionToolId) : undefined;
      if (block?.type === "tool" && toolRenderKind(block.name) === "question") {
        block.questionRequest = event.request;
        questionToolByRequest.set(event.request.id, block.id);
      }
      continue;
    }

    if (event.type === "question.resolved") {
      const toolId = questionToolByRequest.get(event.requestId);
      const block = toolId ? blockById.get(toolId) : undefined;
      if (block?.type === "tool") {
        block.questionAnswers = event.answers;
        block.questionSkipped = event.skipped;
      }
      continue;
    }

    if (event.type === "todos.updated") {
      const allComplete =
        event.todos.length > 0 && event.todos.every((todo) => todo.status === "completed");
      const shouldRenderTodos = todoLifecycleOpen
        ? allComplete
        : !allComplete || !hasRenderedAnyTodoBlock;

      if (shouldRenderTodos) {
        latestTodosBlock = {
          id: `todos:${id}`,
          type: "todos",
          todos: event.todos,
          updating: todoUpdatesInFlight > 0,
        };
        blocks.push(latestTodosBlock);
        hasRenderedAnyTodoBlock = true;
        todoLifecycleOpen = !allComplete;
      }
      continue;
    }

    if (event.type === "subagent.started") {
      const block: SubagentBlockItem = {
        id: `subagent:${event.childSessionId}`,
        type: "subagent",
        childSessionId: event.childSessionId,
        task: event.task,
        subagentType: event.subagentType,
        status: "running",
        ...(event.model ? { model: event.model } : {}),
      };
      subagentsByChild.set(event.childSessionId, block);
      blocks.push(block);
      blockById.set(block.id, block);
      continue;
    }

    if (event.type === "subagent.updated") {
      let block = subagentsByChild.get(event.childSessionId);
      if (!block) {
        block = {
          id: `subagent:${event.childSessionId}`,
          type: "subagent",
          childSessionId: event.childSessionId,
          task: "Subagent",
          subagentType: "worker",
          status: event.status,
        };
        subagentsByChild.set(event.childSessionId, block);
        blocks.push(block);
        blockById.set(block.id, block);
      }
      block.status = event.status;
      if (event.activity) {
        block.activity = event.activity;
      }
      continue;
    }

    if (event.type === "permission.requested" || event.type === "permission.resolved") continue;

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

    if (event.type === "checkpoint.created") {
      // Auto checkpoints anchor a restore action on the user message they
      // precede; restore backups never surface in the timeline.
      const anchorId = event.checkpoint.userMessageId;
      if (event.checkpoint.kind === "auto" && anchorId) {
        const block = blockById.get(anchorId);
        if (block?.type === "message" && block.role === "user") {
          block.checkpointId = event.checkpoint.id;
        }
      }
      continue;
    }

    if (event.type === "checkpoint.restored") {
      blocks.push({
        body: "Files rolled back to the snapshot taken before this point.",
        id,
        title: "checkpoint restored",
        type: "notice",
      });
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
        ? "aborted"
        : event.failed
          ? (event.summary ?? "failed")
          : "ended";
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
 * (`answer`) once it has settled. WorkFold exposes Copy from that answer.
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

/**
 * Authority: in-flight stream/work on the turn. Live turns skip
 * content-visibility so rapid height growth doesn't fight layout.
 */
export function turnHasLiveStream(turn: TimelineTurn): boolean {
  for (const { block } of turn.blocks) {
    if (block.type === "message" && block.streaming) {
      return true;
    }
    if (block.type === "thought" && block.streaming) {
      return true;
    }
    if (block.type === "work-fold" && block.run.status === "running") {
      return true;
    }
    if (block.type === "tool" && block.isComplete === false) {
      return true;
    }
    if (block.type === "todos" && block.updating) {
      return true;
    }
  }
  return false;
}

function isWorkAnchor(block: TimelineBlock): boolean {
  return (
    block.type === "tool" ||
    block.type === "thought" ||
    block.type === "todos" ||
    block.type === "subagent" ||
    block.type === "compaction" ||
    block.type === "notice"
  );
}

function isWorkActivity(block: TimelineBlock): block is WorkActivityItem {
  return (
    block.type === "tool" ||
    block.type === "thought" ||
    block.type === "todos" ||
    block.type === "subagent" ||
    block.type === "compaction"
  );
}

function isGroupedWorkActivity(item: TimelineBlock): item is GroupedWorkActivityItem {
  if (item.type === "tool") return getToolUiMeta(item.name)?.groupInTimeline !== false;
  return item.type === "compaction";
}

/** Messages, notices, and standalone activities bound local activity folds. */
export function groupWorkItems(
  items: Array<WorkActivityItem | NoticeBlockItem | MessageBlockItem>,
): WorkFoldItem[] {
  const result: WorkFoldItem[] = [];
  for (const item of items) {
    if (!isGroupedWorkActivity(item)) {
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
      if (
        next.type === "message" &&
        next.role === "user" &&
        run.status !== "running" &&
        run.status !== "blocked"
      ) {
        break;
      }
      turnContent.push(next);
      index += 1;
    }

    const active = run.status === "running" || run.status === "blocked";
    let lastWork = -1;
    for (let j = 0; j < turnContent.length; j += 1) {
      const candidate = turnContent[j];
      if (candidate && isWorkAnchor(candidate)) {
        lastWork = j;
      }
    }

    const items: Array<WorkActivityItem | NoticeBlockItem | MessageBlockItem> = [];
    const after: TimelineBlock[] = [];

    for (let j = 0; j < turnContent.length; j += 1) {
      const entry = turnContent[j];
      if (!entry) continue;

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

      if (isWorkActivity(entry) || entry.type === "notice" || entry.type === "message") {
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
    return block.content.trim().length > 0;
  });
}

export function buildVisibleTimelineBlocks(
  agentEvents: TimelineProps["agentEvents"],
): TimelineBlock[] {
  return visibleTimelineBlocks(groupTurnWork(attachTurnActions(buildBlocks(agentEvents))));
}

/** Spell a duration ("1 second" / "37 seconds" / "2m 5s"). */
export function formatElapsedVerbose(end: number, start: number): string {
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${minutes}m ${rest}s`;
}

/**
 * Compact "Build this plan" card: the user message for a build action renders
 * as a single line — list glyph, "Build {title}", and to-do count — instead of
 * the raw build instruction text.
 */
function PlanBuildCard({ planBuild }: { planBuild: NonNullable<MessageBlockItem["planBuild"]> }) {
  return (
    <div className="timeline-wire overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <IconListCheck className="shrink-0 text-fg-subtle" size={15} stroke={1.7} />
        <span className="shrink-0 font-medium text-build text-sm">Build</span>
        <span className="min-w-0 truncate text-fg text-sm">{planBuild.title}</span>
      </div>
      <div className="flex items-center gap-2 border-hairline border-t px-3 py-2 text-fg-subtle text-xs">
        <IconCircleDashed className="shrink-0 text-fg-faint" size={14} stroke={1.6} />
        {planBuild.todoCount} To-dos
      </div>
    </div>
  );
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

export function Timeline({
  agentEvents,
  precomputedBlocks,
  cwd,
  model,
  models,
  workspaceId,
  onRestoreCheckpoint,
  onEditResend,
  onOpenSubagent,
  onOpenPlan,
  onOpenFile,
  embedded = false,
}: TimelineProps) {
  const visibleBlocks = useMemo(
    () => precomputedBlocks ?? buildVisibleTimelineBlocks(agentEvents),
    [agentEvents, precomputedBlocks],
  );
  const renderKeys = useMemo(() => blockRenderKeys(visibleBlocks), [visibleBlocks]);
  const turns = useMemo(() => segmentTurns(visibleBlocks, renderKeys), [visibleBlocks, renderKeys]);

  if (visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div
      className={
        embedded
          ? "min-w-0 w-full max-w-full px-4 pt-4 pb-6"
          : "min-w-0 w-full max-w-full px-4 pt-8 pb-24"
      }
    >
      {/* Same .chat-column token as ChatPane's composer wrapper — one width authority,
          shared by content only. The scroll container above stays full-bleed. */}
      <div className="chat-column relative">
        {turns.map((turn) => (
          <section
            className={
              turnHasLiveStream(turn)
                ? "timeline-block timeline-block--live w-full min-w-0 space-y-6 pb-6"
                : "timeline-block w-full min-w-0 space-y-6 pb-6"
            }
            data-turn={turn.key}
            key={turn.key}
          >
            {turn.blocks.map(({ block, key }) => {
              if (block.type === "message" && block.role === "user") {
                if (block.planBuild) {
                  return <PlanBuildCard key={key} planBuild={block.planBuild} />;
                }
                return (
                  <MessageBlock
                    key={key}
                    {...(block.attachments ? { attachments: block.attachments } : {})}
                    {...(block.contextChips ? { contextChips: block.contextChips } : {})}
                    {...(block.contextItems ? { contextItems: block.contextItems } : {})}
                    {...(block.skills ? { skills: block.skills } : {})}
                    {...(block.checkpointId !== undefined
                      ? { checkpointId: block.checkpointId }
                      : {})}
                    {...(onRestoreCheckpoint ? { onRestoreCheckpoint } : {})}
                    {...(embedded ? { compactClip: true } : {})}
                    content={block.content}
                    cwd={cwd}
                    {...(onOpenFile ? { onOpenFile } : {})}
                    {...(block.createdAt !== undefined ? { createdAt: block.createdAt } : {})}
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
                      formatElapsed={formatElapsedVerbose}
                      items={block.items}
                      {...(models ? { models } : {})}
                      run={block.run}
                      {...(onOpenFile ? { onOpenFile } : {})}
                      {...(onOpenPlan ? { onOpenPlan } : {})}
                      {...(onOpenSubagent ? { onOpenSubagent } : {})}
                    />
                  ) : null}
                  {block.type === "message" ? (
                    <MessageBlock
                      {...(block.attachments ? { attachments: block.attachments } : {})}
                      {...(block.contextChips ? { contextChips: block.contextChips } : {})}
                      {...(block.contextItems ? { contextItems: block.contextItems } : {})}
                      {...(block.skills ? { skills: block.skills } : {})}
                      {...(block.checkpointId !== undefined
                        ? { checkpointId: block.checkpointId }
                        : {})}
                      {...(onRestoreCheckpoint ? { onRestoreCheckpoint } : {})}
                      content={block.content}
                      cwd={cwd}
                      {...(onOpenFile ? { onOpenFile } : {})}
                      {...(block.createdAt !== undefined ? { createdAt: block.createdAt } : {})}
                      editable={block.editable ?? false}
                      messageId={block.id}
                      {...(onEditResend ? { onEditResend } : {})}
                      messageRole={block.role}
                      streaming={block.streaming ?? false}
                      workspaceId={workspaceId}
                    />
                  ) : null}
                  {block.type === "notice" ? <Notice {...block} /> : null}
                  {isWorkActivity(block) ? (
                    <WorkActivityRow
                      formatElapsed={formatElapsedVerbose}
                      item={block}
                      {...(models ? { models } : {})}
                      {...(onOpenFile ? { onOpenFile } : {})}
                      {...(onOpenPlan ? { onOpenPlan } : {})}
                      {...(onOpenSubagent ? { onOpenSubagent } : {})}
                    />
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function visualIdFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>).visualId;
  const visualId = typeof value === "string" ? value.trim() : "";
  return visualId || undefined;
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

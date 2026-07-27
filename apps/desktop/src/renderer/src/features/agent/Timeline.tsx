import { IconAlertCircle, IconCircleDashed, IconListCheck } from "@tabler/icons-react";
import { m } from "motion/react";
import { useMemo } from "react";
import type {
  AgentEvent,
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
import {
  APP_TOOL_NAMES,
  ASK_USER_TOOL_NAME,
  BROWSER_TOOL_NAMES,
  isMcpToolName,
  MCP_TOOL_PREFIX,
  PLAN_TOOL_NAME,
  TERMINAL_TOOL_NAMES,
  TODO_TOOL_NAME,
  toolRenderKind,
  WEB_TOOL_NAMES,
} from "../../../../shared/tools";
import { ModusBot } from "../../components/ui/ModusBot";
import { ShinyText } from "../../components/ui/ShinyText";
import { ThoughtRow, WorkFold } from "./ActivityGroup";
import { MessageBlock } from "./MessageBlock";
import { subagentColor } from "./subagentUi";
import { TodosCard } from "./TodosCard";
import { ToolCard } from "./ToolCard";

type TimelineProps = {
  agentEvents: Array<{ id: string; event: AgentEvent; createdAt?: string }>;
  precomputedBlocks?: TimelineBlock[];
  /** Session cwd, threaded to diff tool cards so they can open edited files. */
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
  /** Run that produced this thinking segment, when known. */
  runId?: string;
  text: string;
  /** True while the segment is still being produced — label shimmers, body live. */
  streaming?: boolean;
};

/**
 * The current in-flight phase of an active run, captured from the authoritative
 * event stream (latest signal wins). It drives the live status label in the
 * turn footer — "Reading files" / "Thinking" / "Writing the response" — and is
 * meaningful only while `status === "running"`.
 */
export type RunActivity =
  | { kind: "tool"; name: string }
  | { kind: "thinking" }
  | { kind: "writing" };

export type RunBlockItem = {
  id: string;
  type: "run";
  runId: string;
  status: "running" | "completed" | "failed" | "blocked" | "cancelled";
  delivery?: string;
  body?: string;
  startedAt: number;
  completedAt?: number;
  /** Live phase of a still-running turn; ignored once the run settles. */
  activity?: RunActivity;
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
  background: boolean;
  model?: string;
  activity?: SubagentActivity;
};

/** Block kinds that can live inside a {@link WorkFoldBlockItem}. */
export type WorkFoldItem =
  | ThoughtBlockItem
  | ToolBlockItem
  | TodosBlockItem
  | SubagentBlockItem
  | NoticeBlockItem
  | MessageBlockItem;

/** @deprecated Use WorkFoldItem */
export type ActivityItem = ThoughtBlockItem | ToolBlockItem;

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
  let activeThoughtId: string | undefined;

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

  /**
   * Record the live phase of the active run from the event currently being
   * processed. Latest signal wins (events are in order), and only a still-running
   * run is touched — settled runs no longer surface an activity label. This is
   * the authoritative feed for the live turn footer's status text.
   */
  function setRunActivity(activity: RunActivity): void {
    if (activeRunId === undefined) {
      return;
    }
    const runBlock = blockById.get(activeRunId);
    if (runBlock?.type === "run" && runBlock.status === "running") {
      runBlock.activity = activity;
    }
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
      const block: MessageBlockItem = {
        id: event.messageId,
        type: "message",
        role: event.role,
        content: "",
        createdAt: eventAt,
        ...(event.attachments && event.attachments.length > 0
          ? { attachments: event.attachments }
          : {}),
        ...(event.contextChips && event.contextChips.length > 0
          ? { contextChips: event.contextChips }
          : {}),
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
      setRunActivity({ kind: "writing" });
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
      setRunActivity({ kind: "thinking" });
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
          ...(activeRunId !== undefined ? { runId: activeRunId } : {}),
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
      activeThoughtId = thought.id;
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
      setRunActivity({ kind: "tool", name: event.toolName });
      // Live streaming of a tool call before it executes: show the card now and
      // keep its args fresh so the diff grows in real time.
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
      upsertToolBlock(event.toolCallId, event.toolName, event.args);
      continue;
    }

    if (event.type === "tool.started") {
      setRunActivity({ kind: "tool", name: event.toolName });
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
        block.output += event.output;
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
        background: event.background,
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
          background: true,
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

  // Finalize thought streaming: only the live thought of a still-running turn
  // whose answer hasn't begun keeps shimmering ("Thinking"); everything else
  // settles to a foldable "Thought for Xs".
  for (const thought of thoughtByMessage.values()) {
    thought.streaming = false;
  }
  if (runStillRunning && activeThoughtId) {
    const live = blockById.get(activeThoughtId);
    const sibling = blockById.get(activeThoughtId.slice("thought:".length));
    const hasAnswer = sibling?.type === "message" && sibling.content.trim().length > 0;
    if (live?.type === "thought" && !hasAnswer) {
      live.streaming = true;
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

function isWorkAnchor(block: TimelineBlock): boolean {
  return (
    block.type === "tool" ||
    block.type === "thought" ||
    block.type === "todos" ||
    block.type === "subagent" ||
    block.type === "notice"
  );
}

/**
 * Fold an entire run's work into one Cursor-style WorkFold.
 *
 * Authority: `run.status` + turn boundary (next run, or next user when settled).
 * Final assistant text = messages after the last work anchor; earlier assistant
 * segments ride inside the fold. Steered user mid-run stays inside the fold.
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

    let lastWork = -1;
    for (let j = 0; j < turnContent.length; j += 1) {
      const candidate = turnContent[j];
      if (candidate && isWorkAnchor(candidate)) {
        lastWork = j;
      }
    }

    const items: WorkFoldItem[] = [];
    const after: TimelineBlock[] = [];

    for (let j = 0; j < turnContent.length; j += 1) {
      const entry = turnContent[j];
      if (!entry) continue;

      if (entry.type === "message" && entry.role === "assistant") {
        if (!entry.content.trim()) continue;
        if (j > lastWork) after.push(entry);
        else items.push(entry);
        continue;
      }

      if (entry.type === "message" && entry.role === "user") {
        items.push(entry);
        continue;
      }

      if (isWorkAnchor(entry) || entry.type === "message") {
        items.push(entry as WorkFoldItem);
      } else {
        after.push(entry);
      }
    }

    const active = run.status === "running" || run.status === "blocked";
    if (items.length > 0 || active) {
      result.push({
        id: `work-fold:${run.runId}`,
        type: "work-fold",
        run,
        items,
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

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Turn a tool identifier into a present-tense gerund phrase: "list_integrations"
 * → "Listing integrations", "mcp_devin_create_pr" → "Creating pr". Used for MCP
 * and custom tools that have no curated category phrase.
 */
function gerundFromToolName(name: string): string {
  let rest = name;
  if (isMcpToolName(name)) {
    const afterPrefix = name.slice(MCP_TOOL_PREFIX.length);
    const separator = afterPrefix.indexOf("_");
    rest = separator > 0 ? afterPrefix.slice(separator + 1) : afterPrefix;
  }
  const words = rest.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) {
    return "Working";
  }
  const [verb, ...others] = words;
  const lower = (verb ?? "").toLowerCase();
  const irregular: Record<string, string> = {
    list: "Listing",
    get: "Getting",
    set: "Setting",
    run: "Running",
    add: "Adding",
    put: "Putting",
  };
  const head =
    irregular[lower] ??
    (lower.endsWith("e") && lower.length > 2
      ? `${capitalize(lower.slice(0, -1))}ing`
      : `${capitalize(lower)}ing`);
  return [head, ...others].join(" ");
}

/**
 * Present-tense status phrase for a running tool. Hybrid by design: builtin /
 * known-capability tools get curated category phrases (routed by the
 * authoritative tool-name sets, never guessed), while MCP and custom tools are
 * humanized from their own name.
 */
function toolActivityLabel(name: string): string {
  if (isMcpToolName(name)) {
    return gerundFromToolName(name);
  }
  switch (name) {
    case "read":
      return "Reading files";
    case "grep":
    case "find":
      return "Searching the codebase";
    case "ls":
      return "Listing files";
    case "edit":
    case "write":
      return "Editing files";
    case "bash":
      return "Running commands";
    case "web_search":
      return "Searching the web";
    case "web_fetch":
      return "Reading a page";
    case TODO_TOOL_NAME:
      return "Updating the to-dos";
    case PLAN_TOOL_NAME:
      return "Writing the plan";
    case ASK_USER_TOOL_NAME:
      return "Asking a question";
    default:
      break;
  }
  if ((TERMINAL_TOOL_NAMES as readonly string[]).includes(name)) {
    return "Working in the terminal";
  }
  if ((WEB_TOOL_NAMES as readonly string[]).includes(name)) {
    return "Searching the web";
  }
  if ((BROWSER_TOOL_NAMES as readonly string[]).includes(name)) {
    return "Using the browser";
  }
  if ((APP_TOOL_NAMES as readonly string[]).includes(name)) {
    return "Launching an app";
  }
  return gerundFromToolName(name);
}

function subagentStatusLabel(block: SubagentBlockItem): string {
  if (block.status === "running") {
    if (!block.activity || block.activity.kind === "thinking") {
      return "Thinking";
    }
    if (block.activity.kind === "writing") {
      return "Writing the response";
    }
    return toolActivityLabel(block.activity.name);
  }
  if (block.status === "blocked") {
    return "Waiting for approval";
  }
  if (block.status === "failed") {
    return "Subagent stopped";
  }
  if (block.status === "cancelled") {
    return "Stopped";
  }
  return "Completed";
}

/**
 * Status / duration helper (kept for tests). WorkFold builds Working/Worked labels itself.
 */
export function runStatusLabel(block: RunBlockItem): string {
  switch (block.status) {
    case "running":
      return `Working for ${formatElapsedVerbose(Date.now(), block.startedAt)}`;
    case "blocked":
      return "Waiting for approval";
    case "failed":
      return "Modus stopped";
    case "cancelled":
      return "Stopped by you";
    default:
      return `Worked for ${formatElapsedVerbose(block.completedAt ?? block.startedAt, block.startedAt)}`;
  }
}

/**
 * Compact "Build this plan" card (Cursor parity, figure 4): the user message
 * for a build action renders as a single line — a list glyph, "Build {title}",
 * and the to-do count — instead of the raw build instruction text.
 */
function PlanBuildCard({ planBuild }: { planBuild: NonNullable<MessageBlockItem["planBuild"]> }) {
  return (
    <div className="rounded-lg border border-hairline-soft bg-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <IconListCheck className="shrink-0 text-fg-subtle" size={15} stroke={1.7} />
        <span className="shrink-0 font-medium text-build text-sm">Build</span>
        <span className="min-w-0 truncate text-fg text-sm">{planBuild.title}</span>
      </div>
      <div className="flex items-center gap-2 border-hairline-soft border-t px-3 py-2 text-fg-subtle text-xs">
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
}: TimelineProps) {
  const visibleBlocks = useMemo(
    () => precomputedBlocks ?? buildVisibleTimelineBlocks(agentEvents),
    [agentEvents, precomputedBlocks],
  );
  const renderKeys = useMemo(() => blockRenderKeys(visibleBlocks), [visibleBlocks]);
  const turns = useMemo(
    () => segmentTurns(visibleBlocks, renderKeys),
    [visibleBlocks, renderKeys],
  );

  if (visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 w-full max-w-full px-4 pt-8 pb-24">
      {/* max-w-5xl matches Composer chrome — user bubbles fill this column.
          Assistant / tools / cards use max-w-[60rem] (960px): wider than 4xl,
          still ~4rem under the 5xl input frame so the reply stays inset. */}
      <div className="relative mx-auto min-w-0 w-full max-w-5xl">
        {turns.map((turn) => (
          <section
            className="timeline-block w-full min-w-0 space-y-2.5 pb-2.5"
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
                    content={block.content}
                    cwd={cwd}
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
                <m.div
                  animate={{ opacity: 1 }}
                  className="mx-auto min-w-0 w-full max-w-[60rem]"
                  initial={{ opacity: 0 }}
                  key={key}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                >
                  {block.type === "work-fold" ? (
                    <WorkFold
                      formatElapsed={formatElapsedVerbose}
                      items={block.items}
                      run={block.run}
                      {...(cwd ? { cwd } : {})}
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
                      {...(block.createdAt !== undefined ? { createdAt: block.createdAt } : {})}
                      editable={block.editable ?? false}
                      messageId={block.id}
                      {...(onEditResend ? { onEditResend } : {})}
                      messageRole={block.role}
                      streaming={block.streaming ?? false}
                      workspaceId={workspaceId}
                    />
                  ) : null}
                  {block.type === "tool" ? (
                    <ToolCard
                      args={block.args}
                      cwd={cwd}
                      isComplete={block.isComplete ?? false}
                      isError={block.isError ?? false}
                      name={block.name}
                      {...(onOpenPlan ? { onOpenPlan } : {})}
                      output={block.output}
                      {...(block.plan ? { plan: block.plan } : {})}
                      {...(block.questionAnswers
                        ? { questionAnswers: block.questionAnswers }
                        : {})}
                      {...(block.questionRequest
                        ? { questionRequest: block.questionRequest }
                        : {})}
                      {...(block.questionSkipped !== undefined
                        ? { questionSkipped: block.questionSkipped }
                        : {})}
                    />
                  ) : null}
                  {block.type === "thought" ? (
                    <ThoughtRow streaming={block.streaming ?? false} text={block.text} />
                  ) : null}
                  {block.type === "notice" ? <Notice {...block} /> : null}
                  {block.type === "todos" ? (
                    <TodosCard todos={block.todos} updating={block.updating} />
                  ) : null}
                  {block.type === "subagent" ? (
                    <SubagentCard
                      block={block}
                      {...(onOpenSubagent ? { onOpenSubagent } : {})}
                    />
                  ) : null}
                  </m.div>
                );
              })}
            </section>
        ))}
      </div>
    </div>
  );
}

function SubagentCard({
  block,
  onOpenSubagent,
}: {
  block: SubagentBlockItem;
  onOpenSubagent?: (childSessionId: string) => void;
}) {
  const active = block.status === "running";
  const label = subagentStatusLabel(block);
  return (
    <button
      className="flex min-w-0 w-full items-start gap-3 rounded-lg border border-hairline-soft bg-card px-3 py-2.5 text-left transition-colors hover:bg-hover"
      onClick={() => onOpenSubagent?.(block.childSessionId)}
      type="button"
    >
      <ModusBot
        active={active}
        busy={active}
        className="mt-0.5 size-6 shrink-0"
        color={subagentColor(block.childSessionId)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-fg">{block.task}</span>
          <span className="shrink-0 rounded-sm bg-fill px-1.5 py-0.5 text-2xs text-fg-faint">
            {block.model ?? block.subagentType}
          </span>
        </div>
        <div className="mt-1 min-w-0 truncate text-xs text-fg-subtle">
          {active ? <ShinyText>{label}</ShinyText> : label}
        </div>
      </div>
    </button>
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

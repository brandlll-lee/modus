import { IconAlertCircle, IconCircleDashed, IconListCheck } from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { useMemo } from "react";
import type {
  AgentEvent,
  ContextItem,
  MessageContextChip,
  PromptImageAttachment,
  QuestionAnswer,
  QuestionRequest,
  SkillSelection,
  SubagentActivity,
  SubagentStatus,
  TodoItem,
  WorkingChangeStats,
} from "../../../../shared/contracts";
import {
  APP_TOOL_NAMES,
  ASK_USER_TOOL_NAME,
  BROWSER_TOOL_NAMES,
  getToolUiMeta,
  isMcpToolName,
  MCP_TOOL_PREFIX,
  PLAN_TOOL_NAME,
  TERMINAL_TOOL_NAMES,
  TODO_TOOL_NAME,
  toolRenderKind,
  WEB_TOOL_NAMES,
} from "../../../../shared/tools";
import { CopyButton } from "../../components/ui/CopyButton";
import { ModusBot } from "../../components/ui/ModusBot";
import { ShinyText } from "../../components/ui/ShinyText";
import { formatClock } from "../../lib/formatClock";
import { ActivityGroup, ThoughtRow } from "./ActivityGroup";
import { TurnChangesCard } from "./changes/ChangeStats";
import { MessageBlock } from "./MessageBlock";
import { subagentColor } from "./subagentUi";
import { TodosCard } from "./TodosCard";
import { ToolCard } from "./ToolCard";

type TimelineProps = {
  agentEvents: Array<{ id: string; event: AgentEvent; createdAt?: string }>;
  precomputedBlocks?: TimelineBlock[];
  /** Session cwd, threaded to diff tool cards so they can open edited files. */
  cwd?: string | undefined;
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
  botColor?: string;
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

/** Block kinds that can live inside an {@link ActivityGroupBlockItem}. */
export type ActivityItem = ThoughtBlockItem | ToolBlockItem;

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

type ChangesBlockItem = {
  id: string;
  type: "changes";
  runId: string;
  stats: WorkingChangeStats;
  /** Pre-run snapshot — powers the card's Undo. */
  checkpointId?: string;
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

type ActivityGroupBlockItem = {
  id: string;
  type: "activity-group";
  /** Read-only exploration, shell, or in-app browser control — drives label + summary. */
  kind: "explore" | "browser" | "shell";
  /** Still streaming → forced open, fixed-height fade viewport, shimmering label. */
  active: boolean;
  /** Sealed digest of the folded run, e.g. "Explored 4 files, 6 searches". */
  summary: string;
  /** Interleaved members in stream order: thoughts and tools. */
  items: ActivityItem[];
};

export type TimelineBlock =
  | MessageBlockItem
  | ToolBlockItem
  | ThoughtBlockItem
  | RunBlockItem
  | NoticeBlockItem
  | ActivityGroupBlockItem
  | ChangesBlockItem
  | TodosBlockItem
  | SubagentBlockItem;

export function buildBlocks(agentEvents: TimelineProps["agentEvents"]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  const blockById = new Map<string, TimelineBlock>();
  const checkpointByRun = new Map<string, string>();
  /** todo_write tool calls render through the TodosCard, not as tool rows. */
  const todoToolCallIds = new Set<string>();
  const subagentToolCallIds = new Set<string>();
  const subagentsByChild = new Map<string, SubagentBlockItem>();
  const questionToolByRequest = new Map<string, string>();
  const visualToolById = new Map<string, ToolBlockItem>();
  let activeQuestionToolId: string | undefined;
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
   * run is touched — settled runs show "worked for Xs", not an activity. This is
   * the authoritative feed for the turn footer's status text.
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
      // End-of-turn changes card (Codex-style "N files changed").
      if (event.changes && event.changes.fileCount > 0) {
        const checkpointId = checkpointByRun.get(event.runId);
        blocks.push({
          id: `changes:${event.runId}`,
          type: "changes",
          runId: event.runId,
          stats: event.changes,
          ...(checkpointId !== undefined ? { checkpointId } : {}),
        });
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
      if (event.checkpoint.kind === "auto" && event.checkpoint.runId) {
        checkpointByRun.set(event.checkpoint.runId, event.checkpoint.id);
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
 * Read-only exploration, shell, and browser tools fold into Cursor-style groups.
 * Side-effect file writes, first-class output, MCP, todo, and app tools stand
 * alone unless their catalog declares a foldable renderer.
 */
const EXPLORE_TOOLS = new Set(["read", "grep", "find", "ls", "terminal_list", "web_search"]);
const BROWSER_TOOLS = new Set<string>(BROWSER_TOOL_NAMES);

/** Which fold a tool joins, or undefined when it always stands alone. */
function activityKind(name: string): "explore" | "browser" | "shell" | undefined {
  const activity = getToolUiMeta(name)?.activity;
  if (activity) return activity;
  if (toolRenderKind(name) === "terminal") return "shell";
  if (BROWSER_TOOLS.has(name)) return "browser";
  if (EXPLORE_TOOLS.has(name)) return "explore";
  return undefined;
}

/** Build the folded run's digest from its members. Exported for tests. */
export function buildExploreSummary(tools: ToolBlockItem[]): string {
  const readPaths = new Set<string>();
  let reads = 0;
  let searches = 0;
  let listings = 0;
  let terminalChecks = 0;
  let webLookups = 0;

  for (const tool of tools) {
    const args = (tool.args && typeof tool.args === "object" ? tool.args : {}) as Record<
      string,
      unknown
    >;
    switch (tool.name) {
      case "read": {
        reads += 1;
        const path = typeof args.path === "string" ? args.path : `#${reads}`;
        readPaths.add(path);
        break;
      }
      case "grep":
      case "find":
        searches += 1;
        break;
      case "ls":
        listings += 1;
        break;
      case "terminal_list":
        terminalChecks += 1;
        break;
      case "web_search":
        webLookups += 1;
        break;
      default:
        break;
    }
  }

  const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
    `${count} ${count === 1 ? singular : pluralForm}`;
  const parts: string[] = [];
  if (reads > 0) parts.push(plural(readPaths.size, "file"));
  if (searches > 0) parts.push(plural(searches, "search", "searches"));
  if (listings > 0) parts.push(plural(listings, "listing"));
  if (terminalChecks > 0) parts.push(plural(terminalChecks, "terminal check"));
  if (webLookups > 0) parts.push(plural(webLookups, "web lookup"));
  return parts.length > 0 ? `Explored ${parts.join(", ")}` : `Explored ${tools.length} steps`;
}

/** Sealed digest for a browser-control run, e.g. "Browser used 2 pages, 3 clicks". */
export function buildBrowserSummary(tools: ToolBlockItem[]): string {
  let commands = 0;
  let captures = 0;
  let events = 0;
  let tabs = 0;

  for (const tool of tools) {
    switch (tool.name) {
      case "browser_cdp":
        commands += 1;
        break;
      case "browser_screenshot":
        captures += 1;
        break;
      case "browser_events":
        events += 1;
        break;
      case "browser_tabs":
        tabs += 1;
        break;
      default:
        break;
    }
  }

  const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
    `${count} ${count === 1 ? singular : pluralForm}`;
  const parts: string[] = [];
  if (commands > 0) parts.push(plural(commands, "CDP command"));
  if (captures > 0) parts.push(plural(captures, "capture"));
  if (events > 0) parts.push(plural(events, "event drain"));
  if (tabs > 0) parts.push(plural(tabs, "tab action"));
  return parts.length > 0
    ? `Browser used ${parts.join(", ")}`
    : `Browser used ${tools.length} steps`;
}

export function buildShellSummary(tools: ToolBlockItem[]): string {
  if (tools.some((tool) => !tool.isComplete)) {
    return tools.length > 1 ? "Running commands…" : "Running command…";
  }
  return `Ran ${tools.length} ${tools.length === 1 ? "command" : "commands"}`;
}

/**
 * A single agent turn (one run) can produce SEVERAL assistant message segments
 * interleaved with tool calls. We want exactly one copy/timestamp surface per
 * turn, merged into its bottom status footer — so we aggregate the whole turn's
 * assistant markdown onto the turn's RUN block (`answer`) once it has settled.
 * The run block is relocated to the turn's end downstream, where the footer
 * renders that answer's copy button alongside the "worked for Xs" status and the
 * completion clock. While a run is still streaming, nothing is attached.
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

/** Thoughts ride inside an activity fold; assistant text is always full-width. */
function isFoldableFiller(block: TimelineBlock): block is ThoughtBlockItem {
  return block.type === "thought";
}

/**
 * Collapse contiguous read-only exploration (or browser-control) activity into a
 * single Cursor-style fold. A fold absorbs its same-kind tools plus the thoughts
 * interleaved with them. Assistant text always stays OUTSIDE, full-width, and
 * breaks the chain between activity groups. Single tools fold too, so any
 * foldable call surfaces as a group.
 *
 * While the run is live the fold is left `active` (the component forces it open
 * with a fading viewport) and keeps "listening" across the whole exploration —
 * interleaved thoughts never seal it. Once sealed it collapses to a one-line
 * digest.
 *
 * Seal contract (authoritative signals only — never a guess):
 *   1. the chain is BROKEN — the forward scan stopped before the end because a
 *      block it cannot absorb came next: assistant text, a side-effect /
 *      different-kind tool, a changes/notice/todos block, the next run …, or
 *   2. the run is no longer active.
 */
export function groupActivity(blocks: TimelineBlock[]): TimelineBlock[] {
  const hasActiveRun = blocks.some((block) => block.type === "run" && block.status === "running");
  const result: TimelineBlock[] = [];
  let index = 0;

  while (index < blocks.length) {
    const start = blocks[index];
    if (!start) {
      index += 1;
      continue;
    }

    const startKind = start.type === "tool" ? activityKind(start.name) : undefined;
    if (!startKind) {
      result.push(start);
      index += 1;
      continue;
    }

    // Pull back leading thoughts already emitted so they
    // sit inside the fold, above the first tool (Cursor-style).
    const leading: TimelineBlock[] = [];
    while (result.length > 0) {
      const prev = result[result.length - 1];
      if (prev && isFoldableFiller(prev)) {
        leading.unshift(prev);
        result.pop();
      } else {
        break;
      }
    }

    // Scan forward over same-kind tools and the thoughts interleaved with them.
    const window: TimelineBlock[] = [...leading];
    let assistantBreak: MessageBlockItem | undefined;
    let lastToolOffset = -1;
    let cursor = index;
    while (cursor < blocks.length) {
      const candidate = blocks[cursor];
      if (!candidate) break;
      if (candidate.type === "tool") {
        if (activityKind(candidate.name) !== startKind) break;
        lastToolOffset = window.length;
        window.push(candidate);
        cursor += 1;
      } else if (candidate.type === "message" && candidate.role === "assistant") {
        if (!candidate.content.trim()) {
          cursor += 1;
          continue;
        }
        assistantBreak = candidate;
        break;
      } else if (isFoldableFiller(candidate)) {
        window.push(candidate);
        cursor += 1;
      } else {
        break;
      }
    }

    // Keep trailing thoughts in the fold.
    let groupEnd = lastToolOffset;
    for (let offset = lastToolOffset + 1; offset < window.length; offset += 1) {
      if (window[offset]?.type === "thought") {
        groupEnd = offset;
      } else {
        break;
      }
    }
    const groupItems = window.slice(0, groupEnd + 1);
    const trailing = window.slice(groupEnd + 1);

    const tools = groupItems.filter((item): item is ToolBlockItem => item.type === "tool");
    const firstTool = tools[0];
    const allComplete = tools.every((tool) => tool.isComplete);
    // Assistant narration is a hard phase boundary: close the previous fold
    // immediately, even if the tool result is still catching up.
    const chainBroken = cursor < blocks.length;
    const sealed = assistantBreak !== undefined || (allComplete && (chainBroken || !hasActiveRun));

    if (firstTool) {
      result.push({
        id: `activity-group:${firstTool.id}`,
        type: "activity-group",
        kind: startKind,
        active: !sealed,
        summary:
          startKind === "browser"
            ? buildBrowserSummary(tools)
            : startKind === "shell"
              ? buildShellSummary(tools)
              : buildExploreSummary(tools),
        items: groupItems as ActivityItem[],
      });
    } else {
      result.push(...groupItems);
    }
    result.push(...trailing);
    if (assistantBreak) {
      result.push(assistantBreak);
      index = cursor + 1;
    } else {
      index = cursor;
    }
  }

  return result;
}

/**
 * Relocate each run block to the END of its turn so the run status renders as a
 * footer BENEATH the turn's content (Devin-style: animated logo + live activity
 * label while working, "Modus has worked for N seconds" once settled) instead of
 * a header above it.
 *
 * Runs LAST in the pipeline — after grouping and turn-action sealing have already
 * consumed the original (turn-leading) run positions — so it only reorders the
 * final render list and changes nothing upstream. A footer is emitted when its
 * turn ends: at the next run, or at the user message that opens the next turn.
 * A STEERED/queued user message mid-run (its run still `running`) is NOT a turn
 * boundary, so it stays inside the turn and the live footer remains at the very
 * bottom.
 */
export function relocateRunFooters(blocks: TimelineBlock[]): TimelineBlock[] {
  const result: TimelineBlock[] = [];
  let pendingRun: RunBlockItem | undefined;

  const emit = (): void => {
    if (pendingRun) {
      result.push(pendingRun);
      pendingRun = undefined;
    }
  };

  for (const block of blocks) {
    if (block.type === "run") {
      emit();
      pendingRun = block;
      continue;
    }
    if (block.type === "message" && block.role === "user" && pendingRun?.status !== "running") {
      emit();
    }
    result.push(block);
  }
  emit();
  return result;
}

export function visibleTimelineBlocks(blocks: TimelineBlock[]): TimelineBlock[] {
  return blocks.filter((block) => {
    if (block.type === "thought") {
      return block.text.trim().length > 0;
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
  return visibleTimelineBlocks(
    relocateRunFooters(groupActivity(attachTurnActions(buildBlocks(agentEvents)))),
  );
}

/** Spell a run's duration for the settled footer ("1 second" / "37 seconds" / "2m 5s"). */
function formatElapsedVerbose(end: number, start: number): string {
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

/** Live phrase for a running turn, from its captured {@link RunActivity}. */
function runningActivityLabel(activity: RunActivity | undefined): string {
  if (!activity || activity.kind === "thinking") {
    return "Thinking";
  }
  if (activity.kind === "writing") {
    return "Writing the response";
  }
  return toolActivityLabel(activity.name);
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
 * The single status line for a turn footer. While running it tracks the live
 * activity; once the run settles it reports the duration (or terminal reason).
 * Authoritative — driven only by the run's status + captured phase.
 */
export function runStatusLabel(block: RunBlockItem): string {
  switch (block.status) {
    case "running":
      return runningActivityLabel(block.activity);
    case "blocked":
      return "Waiting for approval";
    case "failed":
      return "Modus stopped";
    case "cancelled":
      return "Stopped by you";
    default:
      return `Modus has worked for ${formatElapsedVerbose(
        block.completedAt ?? block.startedAt,
        block.startedAt,
      )}`;
  }
}

/**
 * Cursor/Devin-style turn footer: the Modus mascot + a single status line on the
 * turn's last line. The mascot walks while the run is live and settles to rest
 * once done; the label crossfades between phases so the text never pops. No
 * separator rule — it reads as part of the turn, not a header.
 *
 * Once the turn settles this same line is also its only copy/timestamp surface:
 * the "Copy response" button and completion clock fade in on hover at the end of
 * the row (reserved space, so revealing them never reflows the layout). There is
 * no longer a separate per-message footer — the two lines are merged into one.
 */
function TurnStatusFooter({ block, botColor }: { block: RunBlockItem; botColor?: string }) {
  const active = block.status === "running" || block.status === "blocked";
  const isError = block.status === "failed";
  const label = runStatusLabel(block);
  const settledColor = isError ? "text-danger" : "text-fg-subtle";
  const answer = !active ? block.answer : undefined;
  return (
    <div className="group flex min-w-0 items-center gap-2 text-sm">
      <ModusBot
        active={active}
        busy={active}
        className="size-[18px] shrink-0"
        {...(botColor ? { color: botColor } : {})}
      />
      <AnimatePresence initial={false} mode="wait">
        <m.span
          animate={{ opacity: 1, y: 0 }}
          className={`min-w-0 truncate ${active ? "" : settledColor}`}
          exit={{ opacity: 0, y: -3 }}
          initial={{ opacity: 0, y: 3 }}
          key={label}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          {active ? <ShinyText>{label}</ShinyText> : label}
        </m.span>
      </AnimatePresence>
      {answer !== undefined ? (
        <div className="flex h-6 shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <CopyButton label="Copy response" text={answer} />
          {block.completedAt !== undefined ? (
            <span className="text-2xs text-fg-faint tabular-nums">
              {formatClock(block.completedAt)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact "Build this plan" card (Cursor parity, figure 4): the user message
 * for a build action renders as a single line — a list glyph, "Build {title}",
 * and the to-do count — instead of the raw build instruction text.
 */
function PlanBuildCard({ planBuild }: { planBuild: NonNullable<MessageBlockItem["planBuild"]> }) {
  return (
    <div className="rounded-lg border border-hairline-soft bg-panel">
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
  workspaceId,
  onRestoreCheckpoint,
  onEditResend,
  onOpenSubagent,
  botColor,
}: TimelineProps) {
  const visibleBlocks = useMemo(
    () => precomputedBlocks ?? buildVisibleTimelineBlocks(agentEvents),
    [agentEvents, precomputedBlocks],
  );
  const renderKeys = useMemo(() => blockRenderKeys(visibleBlocks), [visibleBlocks]);

  if (visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div className="relative mx-auto min-w-0 w-full max-w-5xl px-6 pt-8 pb-24">
      <div className="min-w-0 w-full max-w-full space-y-4">
        {visibleBlocks.map((block, index) => (
          <m.div
            animate={{ opacity: 1 }}
            className="timeline-block min-w-0 w-full max-w-full"
            initial={{ opacity: 0 }}
            key={renderKeys[index]}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {block.type === "message" ? (
              block.planBuild ? (
                <PlanBuildCard planBuild={block.planBuild} />
              ) : (
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
              )
            ) : null}
            {block.type === "tool" ? (
              <ToolCard
                args={block.args}
                cwd={cwd}
                isComplete={block.isComplete ?? false}
                isError={block.isError ?? false}
                name={block.name}
                output={block.output}
                {...(block.questionAnswers ? { questionAnswers: block.questionAnswers } : {})}
                {...(block.questionRequest ? { questionRequest: block.questionRequest } : {})}
                {...(block.questionSkipped !== undefined
                  ? { questionSkipped: block.questionSkipped }
                  : {})}
              />
            ) : null}
            {block.type === "activity-group" ? (
              <ActivityGroup
                active={block.active}
                items={block.items}
                kind={block.kind}
                summary={block.summary}
              />
            ) : null}
            {block.type === "thought" ? (
              <ThoughtRow streaming={block.streaming ?? false} text={block.text} />
            ) : null}
            {block.type === "run" ? (
              <TurnStatusFooter block={block} {...(botColor ? { botColor } : {})} />
            ) : null}
            {block.type === "notice" ? <Notice {...block} /> : null}
            {block.type === "todos" ? (
              <TodosCard todos={block.todos} updating={block.updating} />
            ) : null}
            {block.type === "subagent" ? (
              <SubagentCard block={block} {...(onOpenSubagent ? { onOpenSubagent } : {})} />
            ) : null}
            {block.type === "changes" ? (
              <TurnChangesCard
                {...(block.checkpointId !== undefined ? { checkpointId: block.checkpointId } : {})}
                {...(onRestoreCheckpoint
                  ? { onUndo: (checkpointId) => onRestoreCheckpoint(checkpointId) }
                  : {})}
                {...(cwd
                  ? {
                      onOpenFile: (path: string) =>
                        void window.modus.file.open({ cwd, path }).catch(() => {}),
                    }
                  : {})}
                stats={block.stats}
              />
            ) : null}
          </m.div>
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
      className="flex min-w-0 w-full items-start gap-3 rounded-lg border border-hairline-soft bg-panel px-3 py-2.5 text-left transition-colors hover:bg-hover"
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

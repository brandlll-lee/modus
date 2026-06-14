import { IconAlertCircle, IconChevronRight } from "@tabler/icons-react";
import { m } from "motion/react";
import { useEffect, useMemo, useReducer } from "react";
import type {
  AgentEvent,
  MessageContextChip,
  PromptImageAttachment,
  TodoItem,
  WorkingChangeStats,
} from "../../../../shared/contracts";
import { BROWSER_TOOL_NAMES } from "../../../../shared/tools";
import { ModusBot } from "../../components/ui/ModusBot";
import { ActivityGroup, ThoughtRow } from "./ActivityGroup";
import { TurnChangesCard } from "./changes/ChangeStats";
import { MessageBlock } from "./MessageBlock";
import { TodosCard } from "./TodosCard";
import { ToolCard } from "./ToolCard";

type TimelineProps = {
  agentEvents: Array<{ id: string; event: AgentEvent; createdAt?: string }>;
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
  ): Promise<void>;
};

export type MessageBlockItem = {
  id: string;
  type: "message";
  role: "assistant" | "user";
  content: string;
  streaming?: boolean;
  /** Epoch ms — user send time, or assistant completion time. */
  createdAt?: number;
  /**
   * Set ONLY on the last assistant message of a completed turn. Carries the
   * whole turn's aggregated markdown + completion time so the turn shows a
   * single copy/timestamp footer at its bottom (not one per message segment).
   */
  actions?: { content: string; createdAt?: number };
  /** User only: pre-run snapshot this message can roll the files back to. */
  checkpointId?: string;
  /** User only: images attached to the prompt. */
  attachments?: PromptImageAttachment[];
  /** User only: context chips attached to the prompt (shown in the bubble). */
  contextChips?: MessageContextChip[];
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
export type ActivityItem = ThoughtBlockItem | ToolBlockItem | MessageBlockItem;

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

type ActivityGroupBlockItem = {
  id: string;
  type: "activity-group";
  /** Read-only exploration vs. in-app browser control — drives label + summary. */
  kind: "explore" | "browser";
  /** Still streaming → forced open, fixed-height fade viewport, shimmering label. */
  active: boolean;
  /** Sealed digest of the folded run, e.g. "Explored 4 files, 6 searches". */
  summary: string;
  /** Interleaved members in stream order: thoughts, intermediate text, tools. */
  items: ActivityItem[];
  isError?: boolean;
};

type TimelineBlock =
  | MessageBlockItem
  | ToolBlockItem
  | ThoughtBlockItem
  | RunBlockItem
  | NoticeBlockItem
  | ActivityGroupBlockItem
  | ChangesBlockItem
  | TodosBlockItem;

export function buildBlocks(agentEvents: TimelineProps["agentEvents"]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  const blockById = new Map<string, TimelineBlock>();
  const checkpointByRun = new Map<string, string>();
  /** todo_write tool calls render through the TodosCard, not as tool rows. */
  const todoToolCallIds = new Set<string>();
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
  let activeThoughtId: string | undefined;

  function appendMessageBlock(block: MessageBlockItem): MessageBlockItem {
    blocks.push(block);
    blockById.set(block.id, block);
    if (block.role === "assistant") {
      activeAssistantMessageId = block.id;
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

    if (event.type === "tool.started") {
      // todo_write surfaces through TodosCard snapshots instead of a tool row.
      if (event.toolName === "todo_write") {
        todoToolCallIds.add(event.toolCallId);
        todoUpdatesInFlight += 1;
        continue;
      }
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
      if (todoToolCallIds.has(event.toolCallId)) {
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
      const block = blockById.get(event.toolCallId);
      if (block?.type === "tool") {
        block.isComplete = true;
        block.isError = event.isError;
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
 * Read-only exploration tools fold into one Cursor-style "Exploring" group
 * (mixed names welcome). Tools with side effects or first-class output
 * (edit/write/bash/terminal_run/terminal_read/web_fetch/MCP/todo) always stand
 * alone; in-app browser control gets its own "Browser using" fold.
 */
const EXPLORE_TOOLS = new Set(["read", "grep", "find", "ls", "terminal_list", "web_search"]);
const BROWSER_TOOLS = new Set<string>(BROWSER_TOOL_NAMES);

/** Which fold a tool joins, or undefined when it always stands alone. */
function activityKind(name: string): "explore" | "browser" | undefined {
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
  let pages = 0;
  let clicks = 0;
  let shots = 0;
  let inputs = 0;
  let other = 0;

  for (const tool of tools) {
    switch (tool.name) {
      case "browser_navigate":
      case "browser_navigate_back":
        pages += 1;
        break;
      case "browser_click":
      case "browser_click_xy":
        clicks += 1;
        break;
      case "browser_take_screenshot":
      case "browser_snapshot":
        shots += 1;
        break;
      case "browser_type":
      case "browser_fill":
      case "browser_fill_form":
      case "browser_press_key":
        inputs += 1;
        break;
      default:
        other += 1;
        break;
    }
  }

  const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
    `${count} ${count === 1 ? singular : pluralForm}`;
  const parts: string[] = [];
  if (pages > 0) parts.push(plural(pages, "page"));
  if (clicks > 0) parts.push(plural(clicks, "click"));
  if (shots > 0) parts.push(plural(shots, "capture"));
  if (inputs > 0) parts.push(plural(inputs, "input"));
  if (other > 0) parts.push(plural(other, "action"));
  return parts.length > 0
    ? `Browser used ${parts.join(", ")}`
    : `Browser used ${tools.length} steps`;
}

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

/** Thoughts and intermediate assistant text can ride inside an activity fold. */
function isFoldableFiller(block: TimelineBlock): block is ThoughtBlockItem | MessageBlockItem {
  return block.type === "thought" || (block.type === "message" && block.role === "assistant");
}

/**
 * Collapse contiguous read-only exploration (or browser-control) activity into a
 * single Cursor-style fold. A fold absorbs its same-kind tools plus the thoughts
 * and intermediate assistant text interleaved with them; the trailing final
 * answer stays OUTSIDE, rendered full-width. While the run is live the fold is
 * left `active` (the component forces it open with a fading viewport); once
 * sealed — all members complete AND (something follows OR no run is active) — it
 * collapses to a one-line digest. Single tools fold too, so any read-only call
 * surfaces as an "Exploring" group.
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

    // Pull back leading thoughts / intermediate text already emitted so they
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

    // Scan forward over same-kind tools and the fillers interleaved with them.
    const window: TimelineBlock[] = [...leading];
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
      } else if (isFoldableFiller(candidate)) {
        window.push(candidate);
        cursor += 1;
      } else {
        break;
      }
    }

    // Keep trailing thoughts in the fold; the first trailing assistant message
    // begins the final answer and stays outside.
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
    const movedOn = cursor < blocks.length || trailing.length > 0;
    const sealed = allComplete && (movedOn || !hasActiveRun);

    if (firstTool) {
      result.push({
        id: `activity-group:${firstTool.id}`,
        type: "activity-group",
        kind: startKind,
        active: !sealed,
        summary: startKind === "browser" ? buildBrowserSummary(tools) : buildExploreSummary(tools),
        items: groupItems as ActivityItem[],
        isError: tools.some((tool) => tool.isError),
      });
    } else {
      result.push(...groupItems);
    }
    result.push(...trailing);
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

export function Timeline({ agentEvents, cwd, onRestoreCheckpoint, onEditResend }: TimelineProps) {
  const blocks = useMemo(
    () => groupActivity(attachTurnActions(buildBlocks(agentEvents))),
    [agentEvents],
  );
  const visibleBlocks = useMemo(
    () =>
      blocks.filter((block) => {
        if (block.type === "thought") {
          return block.text.trim().length > 0;
        }
        if (block.type !== "message") {
          return true;
        }
        return block.content.trim().length > 0;
      }),
    [blocks],
  );
  const renderKeys = useMemo(() => blockRenderKeys(visibleBlocks), [visibleBlocks]);

  if (visibleBlocks.length === 0) {
    return (
      <div className="flex min-h-full min-w-0 w-full max-w-full flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
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
    <div className="relative mx-auto min-w-0 w-full max-w-5xl px-6 pt-8 pb-24">
      <div className="min-w-0 w-full max-w-full space-y-4">
        {visibleBlocks.map((block, index) => (
          <m.div
            animate={{ opacity: 1 }}
            className="min-w-0 w-full max-w-full"
            initial={{ opacity: 0 }}
            key={renderKeys[index]}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {block.type === "message" ? (
              <MessageBlock
                {...(block.actions ? { actions: block.actions } : {})}
                {...(block.attachments ? { attachments: block.attachments } : {})}
                {...(block.contextChips ? { contextChips: block.contextChips } : {})}
                {...(block.checkpointId !== undefined ? { checkpointId: block.checkpointId } : {})}
                {...(onRestoreCheckpoint ? { onRestoreCheckpoint } : {})}
                content={block.content}
                {...(block.createdAt !== undefined ? { createdAt: block.createdAt } : {})}
                editable={block.editable ?? false}
                messageId={block.id}
                {...(onEditResend ? { onEditResend } : {})}
                messageRole={block.role}
                streaming={block.streaming ?? false}
              />
            ) : null}
            {block.type === "tool" ? (
              <ToolCard
                args={block.args}
                cwd={cwd}
                isComplete={block.isComplete ?? false}
                isError={block.isError ?? false}
                name={block.name}
                output={block.output}
              />
            ) : null}
            {block.type === "activity-group" ? (
              <ActivityGroup
                active={block.active}
                isError={block.isError ?? false}
                items={block.items}
                kind={block.kind}
                summary={block.summary}
              />
            ) : null}
            {block.type === "thought" ? (
              <ThoughtRow streaming={block.streaming ?? false} text={block.text} />
            ) : null}
            {block.type === "run" ? <RunRow block={block} /> : null}
            {block.type === "notice" ? <Notice {...block} /> : null}
            {block.type === "todos" ? (
              <TodosCard todos={block.todos} updating={block.updating} />
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

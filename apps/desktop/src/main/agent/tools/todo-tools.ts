import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { TodoItem, TodoStatus } from "../../../shared/contracts";
import { TODO_TOOL_NAME, TODO_TOOL_UI } from "../../../shared/tools";
import { getLatestSessionTodos } from "../agent-event-store";
import { toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

/**
 * Agent to-dos (Cursor-style live task list).
 *
 * The agent calls `todo_write` to create and maintain a session-level task
 * list while it works. Every update is persisted as a `todos.updated` agent
 * event, which the timeline renders as a single live TodosCard — so the list
 * survives restarts and replays exactly like the rest of the conversation.
 */

const MAX_TODOS = 30;
const MAX_CONTENT_CHARS = 240;

const todoItemSchema = Type.Object({
  id: Type.Optional(
    Type.String({
      description: "Stable item id from a previous call. Omit for new items.",
    }),
  ),
  content: Type.String({
    minLength: 1,
    description: "Short, action-oriented description of the step.",
  }),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("cancelled"),
  ]),
});

const todoParams = Type.Object({
  todos: Type.Array(todoItemSchema, {
    minItems: 1,
    maxItems: MAX_TODOS,
    description: "The task items to write.",
  }),
  merge: Type.Optional(
    Type.Boolean({
      description:
        "true: update only the listed items by id (append unknown ids). false/omitted: replace the whole list.",
    }),
  ),
});

/** In-memory list per session; rehydrated from the event store after restarts. */
const todosBySession = new Map<string, TodoItem[]>();

function currentTodos(sessionId: string): TodoItem[] {
  const cached = todosBySession.get(sessionId);
  if (cached) {
    return cached;
  }
  const persisted = getLatestSessionTodos(sessionId) ?? [];
  todosBySession.set(sessionId, persisted);
  return persisted;
}

function nextTodoId(existing: TodoItem[]): string {
  let max = 0;
  for (const item of existing) {
    const numeric = Number.parseInt(item.id.replace(/^todo-/, ""), 10);
    if (Number.isFinite(numeric) && numeric > max) {
      max = numeric;
    }
  }
  return `todo-${max + 1}`;
}

function sanitizeContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > MAX_CONTENT_CHARS
    ? `${trimmed.slice(0, MAX_CONTENT_CHARS - 1)}…`
    : trimmed;
}

/**
 * Apply one `todo_write` call to the current list. Exported for tests.
 * Replace mode rebuilds the list (ids preserved when provided); merge mode
 * patches items by id and appends unknown/new ones at the end.
 */
export function applyTodoWrite(current: TodoItem[], input: Static<typeof todoParams>): TodoItem[] {
  const next: TodoItem[] = input.merge ? current.map((item) => ({ ...item })) : [];

  for (const incoming of input.todos) {
    const content = sanitizeContent(incoming.content);
    const status = incoming.status as TodoStatus;
    if (!content) {
      continue;
    }
    if (input.merge && incoming.id) {
      const existing = next.find((item) => item.id === incoming.id);
      if (existing) {
        existing.content = content;
        existing.status = status;
        continue;
      }
    }
    next.push({
      id: incoming.id?.trim() || nextTodoId(next),
      content,
      status,
    });
  }

  return next.slice(0, MAX_TODOS);
}

/** Model-facing rendering of the list, returned as the tool result. */
export function formatTodosForModel(todos: TodoItem[]): string {
  const done = todos.filter((item) => item.status === "completed").length;
  const marker = (status: TodoStatus): string =>
    status === "completed"
      ? "[x]"
      : status === "in_progress"
        ? "[>]"
        : status === "cancelled"
          ? "[-]"
          : "[ ]";
  const lines = todos.map((item) => `${marker(item.status)} ${item.id}: ${item.content}`);
  return `To-dos (${done} of ${todos.length} done):\n${lines.join("\n")}`;
}

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

const todoTool: ToolDefinition = defineTool({
  name: TODO_TOOL_NAME,
  label: "Update to-dos",
  description:
    "Create and maintain a live task list for the current coding session, shown to the user " +
    "beside the conversation. Use it for multi-step work (3+ steps): write the plan once, then " +
    "update item statuses as you progress. Keep exactly one item in_progress at a time, mark " +
    "items completed immediately after finishing them, and cancel items that became irrelevant. " +
    "Skip it for trivial single-step tasks.",
  promptSnippet:
    "todo_write(todos, merge?) — create/update the session task list; one in_progress item, update right after finishing a step.",
  promptGuidelines: [
    "For multi-step tasks, call todo_write first with the full plan (first item in_progress), then again after each step to update statuses.",
    "Use merge:true with item ids for status updates; omit merge to rewrite the whole list when the plan changes.",
  ],
  parameters: todoParams,
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.sessionId) {
      throw new Error("No active Modus session for this to-do update.");
    }

    const next = applyTodoWrite(currentTodos(context.sessionId), params);
    todosBySession.set(context.sessionId, next);
    context.emit?.({ type: "todos.updated", sessionId: context.sessionId, todos: next });
    return toResult(formatTodosForModel(next), { todos: next });
  },
});

let registered = false;

/** Register the to-do tool into the shared registry (idempotent). */
export function registerTodoTools(): void {
  if (registered) {
    return;
  }
  registered = true;

  toolRegistry.registerTool({
    entry: {
      name: TODO_TOOL_NAME,
      profiles: ["chat"],
      permission: { danger: "safe" },
      ui: TODO_TOOL_UI,
    },
    definition: todoTool,
  });
}

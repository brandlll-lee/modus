import {
  IconChevronRight,
  IconCircleArrowRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconListCheck,
} from "@tabler/icons-react";
import { useState } from "react";
import type { TodoItem, TodoStatus } from "../../../../shared/contracts";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { cn } from "../../lib/cn";
import { ShinyText } from "./TextEffects";

/**
 * Agent task-list snapshot (Cursor-style To-dos card). The timeline renders one
 * card when the agent creates the list and another when all items are completed.
 * While the displayed `todo_write` call is in flight, the header shows a
 * shimmering "Updating to-dos…" hint.
 */
export function TodosCard({ todos, updating }: { todos: TodoItem[]; updating: boolean }) {
  const [open, setOpen] = useState(true);
  const done = todos.filter((todo) => todo.status === "completed").length;
  const headline = done > 0 ? `${done} of ${todos.length} Done` : `To-dos ${todos.length}`;

  return (
    <section className="overflow-hidden rounded-lg border border-hairline-soft bg-panel">
      <button
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-hover"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <IconListCheck className="shrink-0 text-fg-subtle" size={14} stroke={1.7} />
        <span className="shrink-0 text-sm text-fg-muted">{headline}</span>
        {updating ? (
          <span className="min-w-0 truncate text-xs">
            <ShinyText>Updating to-dos…</ShinyText>
          </span>
        ) : null}
        <span className="min-w-0 flex-1" />
        <IconChevronRight
          className={cn(
            "shrink-0 text-fg-faint transition-transform duration-150",
            open && "rotate-90",
          )}
          size={13}
          stroke={1.7}
        />
      </button>
      <CollapsibleMotion open={open} preset="timeline">
        <ul className="border-hairline-soft border-t px-3 py-2">
          {todos.map((todo) => (
            <TodoRow key={todo.id} todo={todo} />
          ))}
        </ul>
      </CollapsibleMotion>
    </section>
  );
}

function statusIcon(status: TodoStatus) {
  if (status === "completed") {
    return <IconCircleCheck className="text-fg-faint" size={15} stroke={1.7} />;
  }
  if (status === "in_progress") {
    return <IconCircleArrowRight className="text-focus-ring-soft" size={15} stroke={1.8} />;
  }
  if (status === "cancelled") {
    return <IconCircleX className="text-fg-faint" size={15} stroke={1.7} />;
  }
  return <IconCircleDashed className="text-fg-faint" size={15} stroke={1.6} />;
}

function TodoRow({ todo }: { todo: TodoItem }) {
  const struck = todo.status === "completed" || todo.status === "cancelled";
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0">{statusIcon(todo.status)}</span>
      <span
        className={cn(
          "min-w-0 flex-1 text-sm leading-snug",
          todo.status === "in_progress" ? "text-fg" : "text-fg-muted",
          struck && "text-fg-faint line-through decoration-hairline-strong",
        )}
      >
        {todo.content}
      </span>
    </li>
  );
}

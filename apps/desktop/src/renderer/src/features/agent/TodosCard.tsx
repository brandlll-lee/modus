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

/**
 * Per-status visual language for a to-do row. Centralizing icon + colour here
 * (instead of branching inline) keeps the hierarchy systematic and legible:
 * unfinished work stays prominent in `fg`, the active item gains weight + the
 * brand accent, and finished work recedes to a clearly struck, dimmed tone.
 * Every colour is a Modus token, so dark/light themes flip automatically.
 */
const TODO_ROW_STYLES: Record<
  TodoStatus,
  { Glyph: typeof IconCircleCheck; iconClass: string; iconStroke: number; textClass: string }
> = {
  pending: {
    Glyph: IconCircleDashed,
    iconClass: "text-fg-subtle",
    iconStroke: 1.6,
    textClass: "text-fg",
  },
  in_progress: {
    Glyph: IconCircleArrowRight,
    iconClass: "text-focus-ring-soft",
    iconStroke: 1.8,
    textClass: "text-fg font-medium",
  },
  completed: {
    Glyph: IconCircleCheck,
    iconClass: "text-fg-faint",
    iconStroke: 1.7,
    textClass: "text-fg-subtle line-through decoration-fg-faint",
  },
  cancelled: {
    Glyph: IconCircleX,
    iconClass: "text-fg-faint",
    iconStroke: 1.7,
    textClass: "text-fg-faint line-through decoration-fg-faint",
  },
};

function TodoRow({ todo }: { todo: TodoItem }) {
  const { Glyph, iconClass, iconStroke, textClass } = TODO_ROW_STYLES[todo.status];
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Glyph className={cn("mt-0.5 shrink-0", iconClass)} size={15} stroke={iconStroke} />
      <span className={cn("min-w-0 flex-1 text-sm leading-snug", textClass)}>{todo.content}</span>
    </li>
  );
}

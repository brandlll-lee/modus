import { describe, expect, it } from "vitest";
import { applyTodoWrite, formatTodosForModel } from "./todo-tools";

describe("applyTodoWrite", () => {
  it("replaces the whole list when merge is omitted", () => {
    const current = [{ id: "todo-1", content: "Old step", status: "pending" as const }];
    const next = applyTodoWrite(current, {
      todos: [{ content: "New step", status: "in_progress" }],
    });
    expect(next).toEqual([{ id: "todo-1", content: "New step", status: "in_progress" }]);
  });

  it("merges by id and appends unknown items", () => {
    const current = [
      { id: "todo-1", content: "Plan", status: "completed" as const },
      { id: "todo-2", content: "Implement", status: "in_progress" as const },
    ];
    const next = applyTodoWrite(current, {
      merge: true,
      todos: [
        { id: "todo-2", content: "Implement feature", status: "completed" },
        { content: "Verify", status: "in_progress" },
      ],
    });
    expect(next).toEqual([
      { id: "todo-1", content: "Plan", status: "completed" },
      { id: "todo-2", content: "Implement feature", status: "completed" },
      { id: "todo-3", content: "Verify", status: "in_progress" },
    ]);
  });

  it("truncates long content", () => {
    const long = "x".repeat(300);
    const next = applyTodoWrite([], { todos: [{ content: long, status: "pending" }] });
    expect(next[0]?.content.length).toBeLessThanOrEqual(240);
  });
});

describe("formatTodosForModel", () => {
  it("renders checklist markers and counts completed items", () => {
    const text = formatTodosForModel([
      { id: "todo-1", content: "Plan", status: "completed" },
      { id: "todo-2", content: "Build", status: "in_progress" },
    ]);
    expect(text).toContain("1 of 2 done");
    expect(text).toContain("[x] todo-1: Plan");
    expect(text).toContain("[>] todo-2: Build");
  });
});

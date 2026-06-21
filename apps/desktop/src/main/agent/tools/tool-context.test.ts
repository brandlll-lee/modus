import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../shared/contracts";
import { TODO_TOOL_NAME } from "../../../shared/tools";
import { toolRegistry } from "./registry";
import { registerTodoTools } from "./todo-tools";
import {
  type AgentToolContext,
  resolveAgentToolContext,
  runWithAgentToolContext,
  setAgentToolContext,
} from "./tool-context";

const testState = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => testState.userData,
  },
}));

beforeEach(async () => {
  testState.userData = await mkdtemp(join(tmpdir(), "modus-tool-context-test-"));
});

afterEach(async () => {
  await rm(testState.userData, { recursive: true, force: true }).catch(() => undefined);
});

function context(
  sessionId: string,
  cwd: string,
  emit?: (event: AgentEvent) => void,
): AgentToolContext {
  return { workspaceId: "workspace", cwd, sessionId, ...(emit ? { emit } : {}) };
}

describe("agent tool context", () => {
  it("keeps overlapping sessions with the same cwd isolated", async () => {
    const cwd = "same-cwd";
    const parent = context("parent-session", cwd);
    const child = context("child-session", cwd);

    await expect(
      Promise.all([
        runWithAgentToolContext(parent, async () => {
          setAgentToolContext(child);
          await Promise.resolve();
          return resolveAgentToolContext(cwd).sessionId;
        }),
        runWithAgentToolContext(child, async () => {
          await Promise.resolve();
          return resolveAgentToolContext(cwd).sessionId;
        }),
      ]),
    ).resolves.toEqual(["parent-session", "child-session"]);
  });

  it("emits todo updates to the active async session, not the cwd fallback", async () => {
    registerTodoTools();
    const todoTool = toolRegistry
      .getCustomToolDefinitions("chat")
      .find((definition) => definition.name === TODO_TOOL_NAME);
    if (!todoTool?.execute) {
      throw new Error("todo_write tool not registered");
    }

    const cwd = "shared-cwd";
    const events: AgentEvent[] = [];
    const parent = context("parent-session", cwd, (event) => events.push(event));
    const child = context("child-session", cwd);
    setAgentToolContext(child);

    await runWithAgentToolContext(parent, async () => {
      await todoTool.execute(
        "todo-call",
        { todos: [{ content: "Parent task", status: "in_progress" }] },
        new AbortController().signal,
        () => undefined,
        { cwd } as Parameters<NonNullable<typeof todoTool.execute>>[4],
      );
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "todos.updated",
        sessionId: "parent-session",
        todos: [expect.objectContaining({ content: "Parent task", status: "in_progress" })],
      }),
    ]);
  });
});

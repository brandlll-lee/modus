import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../shared/contracts";
import { PLAN_TOOL_NAME } from "../../../shared/tools";
import { readPlan } from "../../plan/plan-store";
import { registerPlanTools } from "./plan-tools";
import { toolRegistry } from "./registry";
import { type AgentToolContext, runWithAgentToolContext } from "./tool-context";

const testState = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => testState.userData,
  },
}));

beforeEach(async () => {
  testState.userData = await mkdtemp(join(tmpdir(), "modus-plan-tool-test-"));
  registerPlanTools();
});

afterEach(async () => {
  await rm(testState.userData, { recursive: true, force: true }).catch(() => undefined);
});

function planTool() {
  const tool = toolRegistry
    .getCustomToolDefinitions("plan")
    .find((definition) => definition.name === PLAN_TOOL_NAME);
  if (!tool?.execute) {
    throw new Error("plan_write tool not registered");
  }
  return tool;
}

describe("plan_write", () => {
  it("writes plan.md from write-like args and persists string todos as PlanTodo items", async () => {
    const cwd = "plan-cwd";
    const events: AgentEvent[] = [];
    const context: AgentToolContext = {
      workspaceId: "workspace",
      cwd,
      sessionId: "session",
      emit: (event) => events.push(event),
    };

    const result = await runWithAgentToolContext(context, () =>
      planTool().execute(
        "plan-call",
        {
          title: "Plan Tool",
          overview: "Use constrained write semantics.",
          todos: ["Update the schema", "Reuse the diff card"],
          blocks: [
            {
              type: "markdown",
              content: '# Plan Tool\n\n```ts\nconst path = "C:\\\\Users\\\\ASUS";\n```\n',
            },
            {
              type: "visual",
              title: "请求流程",
              kind: "svg",
              content: "<svg><path /></svg>",
              fallback: "浏览器请求 POST /api/realtime/token；server.ts 保留 OPENAI_API_KEY。",
            },
          ],
        },
        new AbortController().signal,
        undefined,
        { cwd } as Parameters<ReturnType<typeof planTool>["execute"]>[4],
      ),
    );

    expect(result.content[0]?.type).toBe("text");
    const plan = readPlan(join(testState.userData, "plans"), "session");
    expect(await readFile(plan?.path ?? "", "utf8")).toContain(
      'const path = "C:\\\\Users\\\\ASUS"',
    );
    expect(plan?.todos.map((todo) => todo.content)).toEqual([
      "Update the schema",
      "Reuse the diff card",
    ]);
    expect(plan?.blocks[1]).toEqual({
      type: "visual",
      title: "请求流程",
      kind: "svg",
      content: "<svg><path /></svg>",
      fallback: "浏览器请求 POST /api/realtime/token；server.ts 保留 OPENAI_API_KEY。",
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "plan.updated",
        sessionId: "session",
        toolCallId: "plan-call",
        plan: expect.objectContaining({ title: "Plan Tool" }),
      }),
    ]);
  });

  it("keeps the tool schema strict so malformed extra fields do not validate", () => {
    const schema = planTool().parameters;
    expect(
      Value.Check(schema, {
        title: "Plan Tool",
        overview: "Use constrained write semantics.",
        todos: ["Update the schema"],
        blocks: [{ type: "markdown", content: "# Plan\n" }],
      }),
    ).toBe(true);
    expect(
      Value.Check(schema, {
        title: "Plan Tool",
        overview: "Use constrained write semantics.",
        todos: ["Update the schema"],
        blocks: [{ type: "markdown", content: "# Plan\n" }],
        unexpected: "extra data",
      }),
    ).toBe(false);
  });
});

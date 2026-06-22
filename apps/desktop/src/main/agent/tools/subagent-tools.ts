import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { SUBAGENT_TOOL_UI } from "../../../shared/tools";
import type { AgentRuntime } from "../runtime";
import { resolveSubagent } from "../subagents-config";
import { toolRegistry } from "./registry";
import { type AgentToolContext, resolveAgentToolContext } from "./tool-context";

type SubagentToolOps = Pick<AgentRuntime, "spawnSubagent" | "waitSubagent">;

let ops: SubagentToolOps | undefined;
let registered = false;

function currentOps(): SubagentToolOps {
  if (!ops) {
    throw new Error("Subagent tools are not ready yet.");
  }
  return ops;
}

function ownerSessionId(context: AgentToolContext): string {
  return context.parentSessionId ?? context.sessionId;
}

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

function renderTaskStarted(sessionId: string, summary: string): string {
  return [
    `<task id="${sessionId}" state="running">`,
    `<summary>${summary}</summary>`,
    "<task_result>",
    "Subagent is running in the background. Its status will appear in <subagent_runs>.",
    "</task_result>",
    "</task>",
  ].join("\n");
}

function renderWaitResult(result: Awaited<ReturnType<SubagentToolOps["waitSubagent"]>>): string {
  return [
    result.timedOut ? "Wait timed out." : "Wait completed.",
    ...result.agents.map((agent) =>
      [
        `<task id="${agent.id}" state="${agent.status}">`,
        `<summary>${agent.subagentTask ?? agent.title}</summary>`,
        "<task_result>",
        agent.output ?? (result.timedOut ? "Subagent is still running." : "No assistant output."),
        "</task_result>",
        "</task>",
      ].join("\n"),
    ),
  ].join("\n");
}

const taskParams = Type.Object({
  description: Type.String({
    minLength: 1,
    maxLength: 160,
    description: "A short 3-8 word label for the subagent task.",
  }),
  prompt: Type.String({
    minLength: 1,
    description: "The full task prompt to give the subagent.",
  }),
  subagent: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 80,
      description: "Configured subagent name from the workspace agents manifest.",
    }),
  ),
});

const taskTool: ToolDefinition = defineTool({
  name: "task",
  label: "Start subagent",
  description:
    "Start a child subagent with its own context window. Use a configured subagent when its description matches; otherwise use only when the user explicitly asks for subagents, parallel work, or isolated exploration.",
  promptSnippet:
    "task(description, prompt, subagent?) — delegate a bounded task to a child subagent.",
  promptGuidelines: [
    "Use subagents for bounded, parallel, noisy work; keep simple work in this main conversation.",
    "If the user invokes `/name` and `name` is an available subagent, call task with subagent set to that name.",
    "Give each subagent a clear prompt and expected return format.",
    "Background subagent status is reported in <subagent_runs>; do not try to manage child sessions yourself.",
  ],
  parameters: taskParams,
  execute: async (_toolCallId, params: Static<typeof taskParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.window || !context.sessionId) {
      throw new Error("No active Modus session for this subagent task.");
    }
    const subagent = params.subagent ? resolveSubagent(ctx.cwd, params.subagent) : undefined;
    if (params.subagent && !subagent) {
      throw new Error(`Unknown subagent: ${params.subagent}`);
    }
    const result = await currentOps().spawnSubagent(context.window, {
      parentSessionId: ownerSessionId(context),
      task: params.description.trim(),
      prompt: params.prompt,
      subagentType: subagent?.name ?? "task",
      ...(subagent
        ? {
            subagent: {
              name: subagent.name,
              body: subagent.body,
              model: subagent.model,
              readOnly: subagent.readOnly,
              isBackground: subagent.isBackground,
              ...(subagent.tools ? { tools: subagent.tools } : {}),
              ...(subagent.disallowedTools ? { disallowedTools: subagent.disallowedTools } : {}),
              isolation: subagent.isolation,
            },
          }
        : {}),
    });
    if (subagent && !subagent.isBackground) {
      const waitResult = await currentOps().waitSubagent(ownerSessionId(context), {
        target: result.session.id,
      });
      return toResult(renderWaitResult(waitResult), waitResult);
    }
    const summary = `Subagent started: ${params.description.trim()}`;
    return toResult(renderTaskStarted(result.session.id, summary), result);
  },
});

export function registerSubagentTools(nextOps: SubagentToolOps): void {
  ops = nextOps;
  if (registered) {
    return;
  }
  registered = true;
  for (const definition of [taskTool]) {
    toolRegistry.registerTool({
      entry: {
        name: definition.name,
        profiles: ["chat"],
        permission: { danger: "safe" },
        capabilities: ["process"],
        ui: SUBAGENT_TOOL_UI.task,
      },
      definition,
    });
  }
}

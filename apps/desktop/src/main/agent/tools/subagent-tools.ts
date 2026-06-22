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

function renderTaskStarted(): string {
  return "Started background subagent. No result is available yet.";
}

function renderWaitResult(result: Awaited<ReturnType<SubagentToolOps["waitSubagent"]>>): string {
  if (result.timedOut) {
    return "Subagent is still running.";
  }
  return result.agents
    .map((agent) => agent.output ?? "Subagent finished without assistant output.")
    .join("\n\n");
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
      description: "Exact configured subagent name from the available subagents list.",
    }),
  ),
  background: Type.Optional(
    Type.Boolean({
      description:
        "Run in the background and return immediately. Defaults to the configured subagent setting, otherwise false.",
    }),
  ),
});

const taskTool: ToolDefinition = defineTool({
  name: "task",
  label: "Start subagent",
  description:
    "Start a child subagent with its own context window. Use a configured subagent when its description matches; otherwise use only when the user explicitly asks for subagents, parallel work, or isolated exploration.",
  promptSnippet:
    "task(description, prompt, subagent?, background?) — delegate a bounded task to a child subagent.",
  promptGuidelines: [
    "Use subagents for bounded, parallel, noisy work; keep simple work in this main conversation.",
    "Set subagent only to an exact available subagent name; for generic delegation, omit subagent.",
    "If the user invokes `/name` and `name` is an available subagent, call task with subagent set to that name.",
    "Give each subagent a clear prompt and expected return format.",
    "Leave background false when you need the subagent answer before replying.",
    "Use background true only for long-running or parallel work; no result is available until the user opens that subagent session.",
  ],
  parameters: taskParams,
  execute: async (_toolCallId, params: Static<typeof taskParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.window || !context.sessionId) {
      throw new Error("No active Modus session for this subagent task.");
    }
    const subagentName = params.subagent?.trim();
    const subagent = subagentName ? resolveSubagent(ctx.cwd, subagentName) : undefined;
    const background = params.background ?? subagent?.isBackground ?? false;
    const result = await currentOps().spawnSubagent(context.window, {
      parentSessionId: ownerSessionId(context),
      task: params.description.trim(),
      prompt: params.prompt,
      subagentType: subagent?.name ?? "task",
      background,
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
    if (!background) {
      const waitResult = await currentOps().waitSubagent(ownerSessionId(context), {
        target: result.session.id,
      });
      return toResult(renderWaitResult(waitResult), waitResult);
    }
    return toResult(renderTaskStarted(), result);
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

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

type SubagentToolOps = Pick<AgentRuntime, "runSubagent">;

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
});

const taskTool: ToolDefinition = defineTool({
  name: "task",
  label: "Start subagent",
  description:
    "Start a bounded child subagent with its own context window and return immediately. " +
    "Collect results later with wait() in the same turn.",
  promptSnippet:
    "task(description, prompt, subagent?) — spawn a child subagent (returns immediately); " +
    "call wait() in the same turn to collect results.",
  promptGuidelines: [
    "Use subagents for bounded, parallel, noisy work; keep simple work in this main conversation.",
    "task always returns immediately. Launch all independent tasks first, do useful main-thread work, then call wait() once to collect ALL results in the SAME turn.",
    "Results are ONLY available through wait() — never assume auto-delivery. DO NOT sleep or poll.",
    "Set subagent only to an exact available subagent name; for generic delegation, omit subagent.",
    "If the user invokes `/name` and `name` is an available subagent, call task with subagent set to that name.",
    "Give each subagent a clear prompt and expected return format.",
  ],
  parameters: taskParams,
  execute: async (_toolCallId, params: Static<typeof taskParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.window || !context.sessionId) {
      throw new Error("No active Modus session for this subagent task.");
    }
    const subagentName = params.subagent?.trim();
    const subagent = subagentName ? resolveSubagent(ctx.cwd, subagentName) : undefined;
    const result = await currentOps().runSubagent(context.window, {
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
              ...(subagent.tools ? { tools: subagent.tools } : {}),
              ...(subagent.disallowedTools ? { disallowedTools: subagent.disallowedTools } : {}),
              isolation: subagent.isolation,
            },
          }
        : {}),
    });
    return toResult(
      [
        `Background task started (id=${result.session.id}): ${params.description.trim()}`,
        "Continue non-overlapping work, then call wait() in this same turn to collect the result.",
        "DO NOT sleep, poll for progress, duplicate this work, or expect a new turn.",
      ].join("\n"),
      result,
    );
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

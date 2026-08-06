import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { SUBAGENT_TOOL_UI } from "../../../shared/tools";
import { listModels } from "../model-service";
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

/** Composer-catalog id for `task.model`; omit/`inherit` → undefined. */
export function resolveTaskModelId(
  requested: string | undefined,
  available: ReadonlyArray<{ id: string }> = listModels(),
): string | undefined {
  const raw = requested?.trim();
  if (!raw || raw === "inherit") return undefined;
  if (!available.some((model) => model.id === raw)) {
    throw new Error(`Model is not available: ${raw}. Use an exact catalog id from the available models list.`);
  }
  return raw;
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
  model: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 160,
      description: 'Exact composer catalog id (provider/id). Omit or "inherit" for the parent model.',
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
    "task(description, prompt, subagent?, model?) — spawn a child (returns immediately); " +
    "model is an optional composer catalog id; call wait() in the same turn to collect results.",
  promptGuidelines: [
    "Use subagents for bounded, parallel, noisy work; keep simple work in this main conversation.",
    "task always returns immediately. Launch all independent tasks first, do useful main-thread work, then call wait() once to collect ALL results in the SAME turn.",
    "Results are ONLY available through wait() — never assume auto-delivery. DO NOT sleep or poll.",
    "Set subagent only to an exact available subagent name; for generic delegation, omit subagent.",
    "Set model to an exact available-models catalog id when the user names a model; omit to inherit the parent.",
    "If the user invokes `/name` and `name` is an available subagent, call task with subagent set to that name.",
    "Give each subagent a clear prompt and expected return format.",
  ],
  parameters: taskParams,
  execute: async (_toolCallId, params: Static<typeof taskParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.window || !context.sessionId) {
      throw new Error("No active Modus session for this subagent task.");
    }
    const configured = params.subagent?.trim()
      ? resolveSubagent(ctx.cwd, params.subagent.trim())
      : undefined;
    const modelId = resolveTaskModelId(params.model);
    const model = modelId ?? configured?.model ?? "inherit";
    const result = await currentOps().runSubagent(context.window, {
      parentSessionId: ownerSessionId(context),
      task: params.description.trim(),
      prompt: params.prompt,
      subagentType: configured?.name ?? "task",
      ...(configured || modelId
        ? {
            subagent: {
              name: configured?.name ?? "task",
              body: configured?.body ?? "",
              model,
              readOnly: configured?.readOnly ?? false,
              ...(configured?.tools ? { tools: configured.tools } : {}),
              ...(configured?.disallowedTools ? { disallowedTools: configured.disallowedTools } : {}),
              isolation: configured?.isolation ?? "shared",
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

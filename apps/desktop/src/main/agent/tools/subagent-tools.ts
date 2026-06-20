import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { SUBAGENT_TOOL_UI, type SubagentToolName } from "../../../shared/tools";
import type { AgentRuntime } from "../runtime";
import { toolRegistry } from "./registry";
import { type AgentToolContext, resolveAgentToolContext } from "./tool-context";

type SubagentToolOps = Pick<
  AgentRuntime,
  "spawnSubagent" | "listSubagents" | "sendSubagentMessage" | "waitSubagent" | "closeSubagent"
>;

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
    "Subagent is running. Use wait_agent when you need its result.",
    "</task_result>",
    "</task>",
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
  subagent_type: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 80,
      description: "Specialized agent type label, such as explorer, worker, reviewer.",
    }),
  ),
});

const targetParams = Type.Object({
  target: Type.String({
    minLength: 1,
    description: "Child subagent session id returned by task/list_agents.",
  }),
});
const targetSchema = targetParams.properties.target;

const sendParams = Type.Object({
  target: targetSchema,
  message: Type.String({ minLength: 1, description: "Follow-up message for the subagent." }),
});

const waitParams = Type.Object({
  target: Type.Optional(targetSchema),
  timeout_ms: Type.Optional(Type.Number({ minimum: 250, maximum: 300_000 })),
});

const taskTool: ToolDefinition = defineTool({
  name: "task",
  label: "Start subagent",
  description:
    "Start a child subagent with its own context window. Use only when the user explicitly asks for subagents, parallel work, or isolated exploration. Returns immediately; call wait_agent when you need results.",
  promptSnippet: "task(description, prompt, subagent_type?) — start an isolated child subagent.",
  promptGuidelines: [
    "Use subagents for bounded, parallel, noisy work; keep simple work in this main conversation.",
    "Give each subagent a clear prompt and expected return format.",
    "Continue useful parent-side work after spawning; call wait_agent only when the child result is needed.",
  ],
  parameters: taskParams,
  execute: async (_toolCallId, params: Static<typeof taskParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.window || !context.sessionId) {
      throw new Error("No active Modus session for this subagent task.");
    }
    const result = await currentOps().spawnSubagent(context.window, {
      parentSessionId: ownerSessionId(context),
      task: params.description.trim(),
      prompt: params.prompt,
      subagentType: params.subagent_type?.trim() || "worker",
    });
    const summary = `Subagent started: ${params.description.trim()}`;
    return toResult(renderTaskStarted(result.session.id, summary), result);
  },
});

const listAgentsTool: ToolDefinition = defineTool({
  name: "list_agents",
  label: "List subagents",
  description: "List child subagents spawned by this session.",
  parameters: Type.Object({}),
  execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    const agents = currentOps().listSubagents(ownerSessionId(context));
    const text = agents.length
      ? agents
          .map((agent) =>
            [
              `- ${agent.id}: ${agent.subagentTask ?? agent.title}`,
              `[${agent.status}]`,
              agent.model ?? "",
            ]
              .filter(Boolean)
              .join(" "),
          )
          .join("\n")
      : "No subagents.";
    return toResult(text, { agents });
  },
});

const sendMessageTool: ToolDefinition = defineTool({
  name: "send_message",
  label: "Message subagent",
  description: "Send a follow-up instruction to a child subagent session.",
  parameters: sendParams,
  execute: async (_toolCallId, params: Static<typeof sendParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.window || !context.sessionId) {
      throw new Error("No active Modus session for this subagent message.");
    }
    await currentOps().sendSubagentMessage(context.window, {
      parentSessionId: ownerSessionId(context),
      target: params.target,
      message: params.message,
    });
    return toResult("Message sent.", { target: params.target });
  },
});

const waitAgentTool: ToolDefinition = defineTool({
  name: "wait_agent",
  label: "Wait for subagent",
  description: "Wait until one child subagent, or all child subagents, have no running turn.",
  parameters: waitParams,
  execute: async (_toolCallId, params: Static<typeof waitParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    const result = await currentOps().waitSubagent(ownerSessionId(context), {
      ...(params.target ? { target: params.target } : {}),
      ...(params.timeout_ms !== undefined ? { timeoutMs: params.timeout_ms } : {}),
    });
    return toResult(result.timedOut ? "Wait timed out." : "Wait completed.", result);
  },
});

const closeAgentTool: ToolDefinition = defineTool({
  name: "close_agent",
  label: "Close subagent",
  description: "Stop and close a child subagent session.",
  parameters: targetParams,
  execute: async (_toolCallId, params: Static<typeof targetParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    const session = await currentOps().closeSubagent(ownerSessionId(context), params.target);
    if (!session) {
      throw new Error(`Unknown subagent: ${params.target}`);
    }
    context.emit?.({
      type: "subagent.updated",
      sessionId: ownerSessionId(context),
      childSessionId: params.target,
      status: "cancelled",
    });
    return toResult(`Closed ${session.id}.`, { session });
  },
});

export function registerSubagentTools(nextOps: SubagentToolOps): void {
  ops = nextOps;
  if (registered) {
    return;
  }
  registered = true;
  for (const definition of [
    taskTool,
    listAgentsTool,
    sendMessageTool,
    waitAgentTool,
    closeAgentTool,
  ]) {
    toolRegistry.registerTool({
      entry: {
        name: definition.name,
        profiles: ["chat"],
        permission: { danger: "safe" },
        ui: SUBAGENT_TOOL_UI[definition.name as SubagentToolName],
      },
      definition,
    });
  }
}

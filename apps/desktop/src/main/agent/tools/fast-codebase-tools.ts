import { join } from "node:path";
import {
  type AgentToolResult,
  type AgentToolUpdateCallback,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import { type Static, Type } from "typebox";
import { FAST_CODEBASE_TOOL_UI } from "../../../shared/tools";
import {
  type FastCodebaseResult,
  runFastCodebase,
} from "../../fast-codebase/fast-codebase-service";
import { toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

function toResult(result: FastCodebaseResult): AgentToolResult<FastCodebaseResult["details"]> {
  return { content: [{ type: "text", text: result.text }], details: result.details };
}

function toErrorResult(
  message: string,
  details: Partial<FastCodebaseResult["details"]>,
): AgentToolResult<Partial<FastCodebaseResult["details"]>> {
  return {
    content: [
      {
        type: "text",
        text:
          `${message}\n\n` +
          "Fast Codebase is unavailable for this turn. Fall back to read/grep/find and keep going.",
      },
    ],
    details,
  };
}

const fastCodebaseParams = Type.Object({
  query: Type.String({
    description:
      "Natural-language task, symbol, file, or subsystem to locate in the current workspace.",
  }),
  include_code: Type.Optional(
    Type.Boolean({
      description:
        "Include small source snippets for the top matches. Default false to save tokens.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum search results to return, from 1 to 50. Default 12.",
    }),
  ),
});

const fastCodebaseTool: ToolDefinition<typeof fastCodebaseParams> = defineTool({
  name: "fast_codebase",
  label: "Fast Codebase",
  description:
    "Explore the current workspace's local codebase index before broad file reading. " +
    "Use it to find relevant files, symbols, architecture entry points, and a few code snippets " +
    "with far fewer tokens than grep/read exploration. It is read-only and local; read the live " +
    "file before editing because the index is a navigation snapshot.",
  promptSnippet:
    "fast_codebase(query, include_code?, limit?) — use the local codebase index to locate relevant files, symbols, and small snippets.",
  promptGuidelines: [
    "Use fast_codebase before broad grep/read sweeps when you need to understand where code lives in the current workspace.",
    "Treat Fast Codebase as navigation, not the source of truth: read the specific current file before editing.",
    "Keep queries focused on the task or symbol you need; ask for include_code only when coordinates are not enough.",
  ],
  parameters: fastCodebaseParams,
  execute: async (
    _toolCallId,
    params: Static<typeof fastCodebaseParams>,
    signal,
    onUpdate,
    ctx,
  ) => {
    const context = resolveAgentToolContext(ctx.cwd);
    const cacheDir = join(app.getPath("userData"), "fast-codebase");
    const update = onUpdate as
      | AgentToolUpdateCallback<Partial<FastCodebaseResult["details"]>>
      | undefined;
    const progressDetails = {
      cacheDir,
      indexed: false,
      project: "",
      query: params.query,
      workspace: context.cwd || ctx.cwd,
    };
    try {
      const result = await runFastCodebase({
        cacheDir,
        cwd: context.cwd || ctx.cwd,
        includeCode: params.include_code,
        limit: params.limit,
        query: params.query,
        signal,
        onProgress: (progress) => {
          update?.({
            content: [{ type: "text", text: `${progress.phase}: ${progress.message}` }],
            details: progressDetails,
          });
        },
      });
      return toResult(result);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return toErrorResult(message, progressDetails);
    }
  },
});

let registered = false;

/** Register the Fast Codebase tool into the shared registry (idempotent). */
export function registerFastCodebaseTools(): void {
  if (registered) {
    return;
  }
  registered = true;
  toolRegistry.registerTool({
    entry: {
      name: "fast_codebase",
      profiles: ["chat", "plan"],
      permission: { danger: "safe" },
      capabilities: ["read"],
      ui: FAST_CODEBASE_TOOL_UI,
    },
    definition: fastCodebaseTool,
  });
}

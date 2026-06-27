import {
  type AgentToolResult,
  type AgentToolUpdateCallback,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
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
      description: "Maximum search results to return, from 1 to 12. Default 8.",
    }),
  ),
  workspace_path: Type.Optional(
    Type.String({
      description: "Optional subdirectory inside the current workspace to index and query.",
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
    "fast_codebase(query, include_code=false, limit=8) — locate relevant files and symbols before reading source.",
  promptGuidelines: [
    "Use fast_codebase before broad grep/read sweeps when you need to understand where code lives in the current workspace.",
    "Treat Fast Codebase as navigation, not the source of truth: read the specific current file before editing.",
    "Keep include_code false by default; set it true only for a specific function/class implementation, not broad project discovery.",
    "Keep limit between 8 and 12; use a narrower query instead of a larger limit.",
    "Use workspace_path only when you need to focus on a subdirectory inside the current workspace.",
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
    const update = onUpdate as
      | AgentToolUpdateCallback<Partial<FastCodebaseResult["details"]>>
      | undefined;
    const progressDetails = {
      indexed: false,
      project: "",
      query: params.query,
      workspace: context.cwd || ctx.cwd,
    };
    try {
      const result = await runFastCodebase({
        cwd: context.cwd || ctx.cwd,
        includeCode: params.include_code,
        limit: params.limit,
        query: params.query,
        signal,
        workspacePath: params.workspace_path,
        onProgress: (progress) => {
          update?.({
            content: [{ type: "text", text: `${progress.phase}: ${progress.message}` }],
            details: progressDetails,
          });
        },
      });
      const final = toResult(result);
      update?.(final);
      return final;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}\n\nFast Codebase is unavailable for this turn. Fall back to read/grep/find and keep going.`,
      );
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
